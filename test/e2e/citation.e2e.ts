import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

interface EditorHandle { getValue(): string; setCursor(pos: { line: number; ch: number }): void }
interface PluginHandle { settings: { referenceFolder: string; citekeyProperty: string; pdfProperty: string; offsetProperty: string } }
interface TestWindow extends Window { citationCalls?: string[]; restoreCitationOpen?: () => void; citationEditor?: EditorHandle }
const pdf = 'Local Citation Page Jump/Papers/Lee.pdf';

async function reference(offset = '-43', target = pdf): Promise<void> {
	await obsidianPage.write('E2ERefs/Lee.md', `---\ncitekey: Lee2020\npdf: "${target}"\npage-offset: ${offset}\n---\n# Source\n`);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, values) => {
		const fm = app.metadataCache.getCache('E2ERefs/Lee.md')?.frontmatter;
		return fm?.citekey === 'Lee2020' && fm?.pdf === values.target && JSON.stringify(fm?.['page-offset']) === values.offset;
	}, { target, offset }), { timeout: 15000, timeoutMsg: 'Reference cache not ready' });
}
async function prepare(text: string, cursor = text.indexOf('@') + 2): Promise<void> {
	await obsidianPage.write('Citation manuscript.md', text);
	await browser.executeObsidian(async ({ app, obsidian }, id) => {
		const plugins = (app as unknown as { plugins: { plugins: Record<string, PluginHandle> } }).plugins.plugins;
		plugins[id]!.settings = { referenceFolder: 'E2ERefs', citekeyProperty: 'citekey', pdfProperty: 'pdf', offsetProperty: 'page-offset' };
		const file = app.vault.getAbstractFileByPath('Citation manuscript.md');
		if (!(file instanceof obsidian.TFile)) throw new Error('No manuscript file');
		const leaf = app.workspace.getLeaf('tab');
		await leaf.openFile(file, { active: true, state: { mode: 'source' } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
	}, pluginId);
	await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }, value) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return view?.file?.path === 'Citation manuscript.md' && view.editor.getValue() === value;
	}, text), { timeout: 15000, timeoutMsg: 'Source editor not ready' });
	await browser.executeObsidian(({ app, obsidian }, ch) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error('The source view lost focus');
		view.editor.setCursor({ line: 0, ch });
		view.editor.focus();
		const w = window as TestWindow;
		w.citationEditor = view.editor;
		w.citationCalls = [];
		const original = app.workspace.openLinkText;
		app.workspace.openLinkText = async function (...args: Parameters<typeof original>) {
			w.citationCalls!.push(args[0]);
			await original.apply(this, args);
		};
		w.restoreCitationOpen = () => { app.workspace.openLinkText = original; };
	}, cursor);
}
async function calls(): Promise<string[]> { return browser.execute(() => (window as TestWindow).citationCalls ?? []); }
async function unchanged(text: string): Promise<void> {
	expect(await obsidianPage.read('Citation manuscript.md')).toBe(text);
	expect(await browser.execute(() => (window as TestWindow).citationEditor?.getValue())).toBe(text);
}
async function errorCase(text: string, fragment: string): Promise<void> {
	await prepare(text);
	await browser.executeObsidianCommand(`${pluginId}:open-citation`);
	await expect(browser.$('.citation-page-jump')).toHaveText(expect.stringContaining(fragment));
	expect(await calls()).toEqual([]);
	await unchanged(text);
}

describe('local citation commands', function () {
	beforeEach(async function () { await reference(); });
	afterEach(async function () {
		await browser.execute(() => {
			const w = window as TestWindow;
			w.restoreCitationOpen?.();
			delete w.restoreCitationOpen;
			document.querySelectorAll<HTMLButtonElement>('.citation-page-jump button').forEach((b) => { if (b.textContent === 'Close') b.click(); });
		});
		await browser.waitUntil(async () => browser.execute(() => document.querySelector('.citation-page-jump') === null), { timeout: 10000, timeoutMsg: 'Citation modal did not close' });
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getAbstractFileByPath('E2ERefs/Copy.md');
			if (f) await app.vault.delete(f);
		});
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.vault.getAbstractFileByPath('E2ERefs/Copy.md') === null), { timeout: 10000 });
	});
	for (const [text, page, offset] of [
		['[@Lee2020, p. 44]', 1, '-43'],
		['[@Lee2020, pp. 46-48]', 3, '-43'],
		['[-@Lee2020, 5]', 7, '2'],
		['@Lee2020', 1, '-43'],
	] as const) {
		it(`opens ${text} at physical page ${page} without edits`, async function () {
			await reference(offset);
			await prepare(text);
			await browser.executeObsidianCommand(`${pluginId}:open-citation`);
			await browser.waitUntil(async () => (await calls()).length === 1, { timeout: 15000 });
			expect(await calls()).toEqual([`${pdf}#page=${page}`]);
			await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }, path) => app.workspace.getActiveFile()?.path === path && app.workspace.getActiveViewOfType(obsidian.View)?.getViewType() === 'pdf', pdf), { timeout: 15000, timeoutMsg: 'PDF viewer did not open' });
			await browser.waitUntil(async () => browser.executeObsidian(({ app, obsidian }, number) => app.workspace.getActiveViewOfType(obsidian.View)?.containerEl.querySelector<HTMLInputElement>('.pdf-page-input')?.value === String(number), page), { timeout: 15000, timeoutMsg: 'The PDF viewer did not reach the requested physical page' });
			await unchanged(text);
		});
	}
	it('previews the target without opening a PDF', async function () {
		const text = '[@Lee2020, pp. 46-48]';
		await prepare(text);
		await browser.executeObsidianCommand(`${pluginId}:preview-citation`);
		await expect(browser.$('.citation-physical-page')).toHaveText('Physical page 3');
		expect(await calls()).toEqual([]);
		await unchanged(text);
	});
	it('reports both duplicate reference paths', async function () {
		await obsidianPage.write('E2ERefs/Copy.md', `---\ncitekey: Lee2020\npdf: ${pdf}\npage-offset: -43\n---\n`);
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.metadataCache.getCache('E2ERefs/Copy.md')?.frontmatter?.citekey === 'Lee2020'), { timeout: 15000 });
		await errorCase('[@Lee2020, 44]', 'More than one reference');
		await expect(browser.$('.citation-page-jump')).toHaveText(expect.stringContaining('E2ERefs/Copy.md'));
		await expect(browser.$('.citation-page-jump')).toHaveText(expect.stringContaining('E2ERefs/Lee.md'));
	});
	it('rejects an absent PDF', async function () { await reference('-43', 'Papers/Absent.pdf'); await errorCase('[@Lee2020, 44]', 'Invalid PDF target'); });
	it('rejects a web PDF', async function () { await reference('-43', 'https://example.org/Lee.pdf'); await errorCase('[@Lee2020, 44]', 'Invalid PDF target'); });
	it('rejects a fractional offset', async function () { await reference('1.5'); await errorCase('[@Lee2020, 44]', 'Invalid page'); });
	it('rejects a physical page of zero', async function () { await errorCase('[@Lee2020, 43]', 'Invalid page'); });
	for (const text of ['`[@Lee2020, 44]`', 'person@Lee2020', '[@Lee2020, 44; @Chen2021, 8]']) {
		it(`rejects unsupported input ${text}`, async function () { await errorCase(text, 'Unsupported citation'); });
	}
});
