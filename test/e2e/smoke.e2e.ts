import { browser, expect } from '@wdio/globals';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} load`, function () {
	it('is enabled and reloads with no errors', async function () {
		console.log('Obsidian API version', await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion));
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});
});
