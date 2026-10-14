import { type Editor, Modal, Notice, Plugin, TFile, type App } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { resolveCitation, unsupportedContext, type JumpResult, type Reference, type Target } from './citation';
import { SPONSORS, bindPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, LocalCitationPageJumpSettingTab, normalizeSettings, type LocalCitationPageJumpSettings } from './settings';

const MESSAGES = {
	'unsupported-citation': 'Unsupported citation. Use one key with an integer page or range. Code, email addresses and citation clusters are not supported.',
	'missing-reference': 'No reference note has this citekey. Check the key and the reference folder.',
	'ambiguous-reference': 'More than one reference note has this citekey. Set a unique key before you open a PDF.',
	'invalid-page': 'Invalid page. Use an integer offset and a positive integer physical page. Check the page range.',
	'invalid-pdf': 'Invalid PDF target. Use the exact path of an existing PDF in this vault. Web URLs and file fragments are not supported.',
};

export default class LocalCitationPageJumpPlugin extends Plugin {
	settings: LocalCitationPageJumpSettings = { ...DEFAULT_SETTINGS };
	pro: SponsorsManager | null = null;
	private settingTab: LocalCitationPageJumpSettingTab | null = null;
	private dialogs = new Set<CitationModal>();

	async onload(): Promise<void> {
		await this.loadSettings();
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new LocalCitationPageJumpSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommand({ id: 'open-citation', name: 'Open the PDF at the citation page', editorCallback: (editor) => void this.runCitation(editor, false) });
		this.addCommand({ id: 'preview-citation', name: 'Preview the citation target', editorCallback: (editor) => void this.runCitation(editor, true) });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void {
		for (const modal of [...this.dialogs]) modal.close();
		resetPro();
	}
	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<LocalCitationPageJumpSettings> | null);
	}
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }

	references(): Reference[] {
		const s = this.settings;
		return this.app.vault.getMarkdownFiles()
			.filter((f) => !s.referenceFolder || f.path.startsWith(s.referenceFolder + '/'))
			.map((f) => {
				const frontmatter: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter;
				const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter as Record<string, unknown> : undefined;
				return { path: f.path, citekey: fm?.[s.citekeyProperty], pdf: fm?.[s.pdfProperty], offset: fm?.[s.offsetProperty] };
			});
	}
	/** Both commands use this path. No note write API is called. */
	async runCitation(editor: Editor, preview: boolean): Promise<JumpResult> {
		const cursor = editor.getCursor();
		const lines = Array.from({ length: cursor.line + 1 }, (_, i) => editor.getLine(i));
		let result: JumpResult = unsupportedContext(lines, cursor.line)
			? { ok: false, code: 'unsupported-citation', paths: [] }
			: resolveCitation(editor.getLine(cursor.line), cursor.ch, this.references());
		if (result.ok && !this.targetExists(result)) result = { ok: false, code: 'invalid-pdf', paths: [result.reference] };
		if (!result.ok || preview) this.showResult(result);
		else await this.openTarget(result);
		return result;
	}
	private targetExists(target: Target): boolean {
		const file = this.app.vault.getAbstractFileByPath(target.pdf);
		const resolved = this.app.metadataCache.getFirstLinkpathDest(target.pdf, '');
		return file instanceof TFile && file.extension.toLowerCase() === 'pdf' && resolved?.path === file.path;
	}
	async openTarget(target: Target): Promise<void> {
		if (!this.targetExists(target)) {
			this.showResult({ ok: false, code: 'invalid-pdf', paths: [target.reference] });
			return;
		}
		try {
			await this.app.workspace.openLinkText(`${target.pdf}#page=${target.page}`, '', 'tab');
			new Notice(`Opened ${target.pdf} at physical page ${target.page}.`);
		} catch {
			new Notice('The PDF could not open. Check the file and try the command again.');
		}
	}
	showResult(result: JumpResult): void {
		const modal = new CitationModal(this.app, result, (t) => this.openTarget(t), () => this.dialogs.delete(modal));
		this.dialogs.add(modal);
		modal.open();
	}
}

export class CitationModal extends Modal {
	constructor(app: App, private result: JumpResult, private openPdf: (t: Target) => Promise<void>, private closed: () => void) { super(app); }
	onOpen(): void {
		this.contentEl.addClass('citation-page-jump');
		const r = this.result;
		this.titleEl.setText(r.ok ? 'Citation target' : 'Citation needs a check');
		if (!r.ok) {
			this.contentEl.createEl('p', { text: MESSAGES[r.code], cls: 'citation-error' });
			if (r.paths.length) {
				this.contentEl.createEl('h3', { text: 'Reference notes' });
				const list = this.contentEl.createEl('ul');
				for (const path of r.paths) list.createEl('li', { text: path });
			}
		} else {
			this.contentEl.createEl('p', { text: `@${r.key}`, cls: 'citation-key' });
			this.contentEl.createDiv({ text: `Physical page ${r.page}`, cls: 'citation-physical-page' });
			this.contentEl.createEl('p', { text: r.printedPage === null ? 'No page locator. Open the first physical page.' : `Printed page ${r.printedPage} + offset ${r.offset} = physical page ${r.page}.` });
			const rows = this.contentEl.createEl('dl');
			rows.createEl('dt', { text: 'Local PDF' });
			rows.createEl('dd', { text: r.pdf });
			rows.createEl('dt', { text: 'Reference note' });
			rows.createEl('dd', { text: r.reference });
			this.contentEl.createEl('p', { text: 'The manuscript text stays unchanged. This command does not check the PDF page count.', cls: 'citation-muted' });
			const open = this.contentEl.createEl('button', { text: 'Open PDF', cls: 'mod-cta' });
			open.addEventListener('click', () => { this.close(); void this.openPdf(r); });
		}
		const close = this.contentEl.createEl('button', { text: 'Close' });
		close.addEventListener('click', () => this.close());
	}
	onClose(): void { this.contentEl.empty(); this.closed(); }
}
