import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type LocalCitationPageJumpPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface LocalCitationPageJumpSettings {
	referenceFolder: string;
	citekeyProperty: string;
	pdfProperty: string;
	offsetProperty: string;
}
export const DEFAULT_SETTINGS: LocalCitationPageJumpSettings = {
	referenceFolder: '', citekeyProperty: 'citekey', pdfProperty: 'pdf', offsetProperty: 'page-offset',
};
export function normalizeSettings(saved: Partial<LocalCitationPageJumpSettings> | null | undefined): LocalCitationPageJumpSettings {
	const s = saved ?? {};
	const property = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
	return {
		referenceFolder: typeof s.referenceFolder === 'string' ? s.referenceFolder.trim().replace(/^\/+|\/+$/g, '') : '',
		citekeyProperty: property(s.citekeyProperty, 'citekey'),
		pdfProperty: property(s.pdfProperty, 'pdf'),
		offsetProperty: property(s.offsetProperty, 'page-offset'),
	};
}
export class LocalCitationPageJumpSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: LocalCitationPageJumpPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Reference folder', desc: 'One vault folder, with its subfolders. Leave empty to use the vault.', control: { type: 'text', key: 'referenceFolder', defaultValue: '' } },
			{ name: 'Citekey property', desc: 'Text property with one key. Case must match the citation.', control: { type: 'text', key: 'citekeyProperty', defaultValue: 'citekey' } },
			{ name: 'PDF property', desc: 'Exact vault path to a PDF, with the .pdf extension. Web URLs are refused.', control: { type: 'text', key: 'pdfProperty', defaultValue: 'pdf' } },
			{ name: 'Page offset property', desc: 'Number property with an integer offset. A missing offset is zero.', control: { type: 'text', key: 'offsetProperty', defaultValue: 'page-offset' } },
			{ name: 'Free v1', desc: 'The jump and preview commands are free. Folder maps and folder checks are planned. This version has no paid features. Do not sponsor to get those planned features.' },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!(key in DEFAULT_SETTINGS)) return;
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveSettings();
	}
}
