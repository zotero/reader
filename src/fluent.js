import { FluentBundle, FluentResource } from '@fluent/bundle';

import zoteroFTL from '../locales/en-US/zotero.ftl';
import readerFTL from '../locales/en-US/reader.ftl';

export let bundle = new FluentBundle('en-US', {
	functions: {
		PLATFORM: () => 'web',
	},
});

bundle.addResource(new FluentResource(zoteroFTL));
bundle.addResource(new FluentResource(readerFTL));

export function getLocalizedString(key, args = {}) {
	const message = bundle.getMessage(key);
	if (message && message.value) {
		return bundle.formatPattern(message.value, args);
	} else {
		console.warn(`Localization key '${key}' not found`);
		return key;
	}
}

export function addFTL(ftl) {
	bundle.addResource(new FluentResource(ftl), { allowOverrides: true });
}
