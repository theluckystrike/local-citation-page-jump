import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { type Editor, TFile } from 'obsidian';
import LocalCitationPageJumpPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { resolveCitation, unsupportedContext } from '../src/citation';
import manifest from '../manifest.json';

afterEach(() => resetPro());
const reference = { path: 'References/Lee.md', citekey: 'Lee2020', pdf: 'Papers/Lee.pdf', offset: -43 };
function setup(line = '[@Lee2020, p. 44]') {
	const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: 'Papers/Lee.pdf', extension: 'pdf' });
	const app = App.createConfigured__({ files: { 'References/Lee.md': '---\ncitekey: Lee2020\npdf: Papers/Lee.pdf\npage-offset: -43\n---\n', 'Other/Skip.md': '---\ncitekey: Skip\n---\n' } });
	const plugin = new LocalCitationPageJumpPlugin(app as never, manifest);
	const openLinkText = vi.fn(async () => undefined);
	const workspace = { openLinkText };
	Object.assign(plugin, { app: { vault: { getAbstractFileByPath: () => file }, metadataCache: { getFirstLinkpathDest: () => file }, workspace } });
	vi.spyOn(plugin, 'references').mockReturnValue([{ ...reference }]);
	const show = vi.spyOn(plugin, 'showResult').mockImplementation(() => undefined);
	const write = vi.fn();
	const editor = { getCursor: () => ({ line: 0, ch: line.indexOf('@') + 2 }), getLine: () => line, replaceRange: write, setValue: write } as unknown as Editor;
	return { plugin, openLinkText, show, editor, write };
}

describe('host adapter', () => {
	it('opens the exact local target in a new tab and does not write', async () => {
		const t = setup();
		await t.plugin.runCitation(t.editor, false);
		expect(t.openLinkText).toHaveBeenCalledWith('Papers/Lee.pdf#page=1', '', 'tab');
		expect(t.write).not.toHaveBeenCalled();
	});
	it('previews without opening or writing', async () => {
		const t = setup();
		await t.plugin.runCitation(t.editor, true);
		expect(t.show).toHaveBeenCalledWith(expect.objectContaining({ ok: true, page: 1 }));
		expect(t.openLinkText).not.toHaveBeenCalled();
		expect(t.write).not.toHaveBeenCalled();
	});
	it('refuses an absent PDF without calling the workspace', async () => {
		const t = setup();
		t.plugin.app.vault.getAbstractFileByPath = () => null;
		await t.plugin.runCitation(t.editor, false);
		expect(t.show).toHaveBeenCalledWith({ ok: false, code: 'invalid-pdf', paths: ['References/Lee.md'] });
		expect(t.openLinkText).not.toHaveBeenCalled();
	});
	it('refuses web targets before resolving a link or opening a file', async () => {
		const t = setup();
		vi.spyOn(t.plugin, 'references').mockReturnValue([{ ...reference, pdf: 'https://example.org/Lee.pdf' }]);
		const lookup = vi.spyOn(t.plugin.app.metadataCache, 'getFirstLinkpathDest');
		await t.plugin.runCitation(t.editor, false);
		expect(lookup).not.toHaveBeenCalled();
		expect(t.openLinkText).not.toHaveBeenCalled();
	});
	it('reports both duplicate reference paths without opening or writing', async () => {
		const t = setup();
		vi.spyOn(t.plugin, 'references').mockReturnValue([reference, { ...reference, path: 'References/Copy.md' }]);
		await t.plugin.runCitation(t.editor, false);
		expect(t.show).toHaveBeenCalledWith({ ok: false, code: 'ambiguous-reference', paths: ['References/Copy.md', 'References/Lee.md'] });
		expect(t.openLinkText).not.toHaveBeenCalled();
		expect(t.write).not.toHaveBeenCalled();
	});
	it('checks existence again when a preview target is opened', async () => {
		const t = setup();
		const result = await t.plugin.runCitation(t.editor, true);
		t.plugin.app.vault.getAbstractFileByPath = () => null;
		if (!result.ok) throw new Error('Fixture should resolve');
		await t.plugin.openTarget(result);
		expect(t.openLinkText).not.toHaveBeenCalled();
		expect(t.show).toHaveBeenLastCalledWith({ ok: false, code: 'invalid-pdf', paths: ['References/Lee.md'] });
	});
	it('reports unsupported inline code without opening or writing', async () => {
		const t = setup('`[@Lee2020, 44]`');
		await t.plugin.runCitation(t.editor, false);
		expect(t.show).toHaveBeenCalledWith({ ok: false, code: 'unsupported-citation', paths: [] });
		expect(t.openLinkText).not.toHaveBeenCalled();
		expect(t.write).not.toHaveBeenCalled();
	});
	it('loads defaults in the mock vault', async () => {
		const app = App.createConfigured__({ files: { 'Hello.md': 'Hello' } });
		const plugin = new LocalCitationPageJumpPlugin(app as never, manifest);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});
	it('reads only the chosen folder and the configured property names', () => {
		const app = App.createConfigured__({ files: { 'Refs/a.md': '', 'Refs/sub/b.md': '', 'Refs-other/c.md': '' } });
		const plugin = new LocalCitationPageJumpPlugin(app as never, manifest);
		plugin.settings = { referenceFolder: 'Refs', citekeyProperty: 'key', pdfProperty: 'attachment', offsetProperty: 'offset' };
		vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue({ frontmatter: { key: 'Lee2020', attachment: 'Papers/Lee.pdf', offset: 2 } } as never);
		expect(plugin.references().map((r) => r.path).sort()).toEqual(['Refs/a.md', 'Refs/sub/b.md']);
		expect(plugin.references()[0]).toMatchObject({ citekey: 'Lee2020', pdf: 'Papers/Lee.pdf', offset: 2 });
	});
	it('repairs saved property names and strips folder slashes', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ citekeyProperty: 5 as never, pdfProperty: ' ' })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ referenceFolder: '/Refs/', offsetProperty: ' shift ' })).toMatchObject({ referenceFolder: 'Refs', offsetProperty: 'shift' });
	});
});

describe('code context', () => {
	it.each([
		[['```md', '[@Lee2020, 44]'], 1, true],
		[['~~~', '[@Lee2020, 44]', '~~~', '[@Lee2020, 44]'], 3, false],
		[['---', 'citekey: "@Lee2020"', '---'], 1, true],
		[['---', 'title: Hello', '---', '[@Lee2020, 44]'], 3, false],
		[['    [@Lee2020, 44]'], 0, true],
		[['````', '```', '[@Lee2020, 44]'], 2, true],
	] as [string[], number, boolean][])('checks %j line %i', (lines, cursor, expected) => expect(unsupportedContext(lines, cursor)).toBe(expected));
});

describe('Sponsors wiring for a later Pro version', () => {
	it('defaults to free and follows the cached manager state', () => {
		expect(isPro()).toBe(false);
		const unbind = vi.fn();
		bindPro({ isPro: () => true, onChange: () => unbind } as never);
		expect(isPro()).toBe(true);
		resetPro();
		expect(unbind).toHaveBeenCalledOnce();
	});
	it('has the reference terms and client id', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
});

describe('review defects', () => {
	const refs = [{ ...reference }];
	it.each([
		[['- Parent', '\t- Child [@Lee2020, 44]'], 1, false],
		[['- Parent', '    - Child [@Lee2020, 44]'], 1, false],
		[['1. Parent', '', '\tContinued [@Lee2020, 44]'], 2, false],
		[['A paragraph', '    continues [@Lee2020, 44]'], 1, false],
		[['A paragraph', '', '    [@Lee2020, 44]'], 2, true],
		[['# Heading', '', '\t[@Lee2020, 44]', '', '\t[@Lee2020, 44]'], 4, true],
		[['# Heading', '    [@Lee2020, 44]'], 1, true],
		[['- a', '\t- b', '\t\t- c [@Lee2020, 44]'], 2, false],
	] as [string[], number, boolean][])('treats list and paragraph indents as text %j line %i', (lines, cursor, expected) => expect(unsupportedContext(lines, cursor)).toBe(expected));
	it('drops trailing punctuation from a bare key', () => {
		expect(resolveCitation('As @Lee2020: shows', 5, refs)).toMatchObject({ ok: true, key: 'Lee2020' });
		expect(resolveCitation('As @Lee2020, p. 4 shows', 5, [])).toMatchObject({ ok: false, code: 'unsupported-citation' });
	});
	it('accepts the cursor just after the closing bracket', () => {
		expect(resolveCitation('See [@Lee2020, p. 44] here.', 21, refs)).toMatchObject({ ok: true, page: 1 });
	});
});
