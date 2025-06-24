import { FluentBundle, FluentResource } from '@fluent/bundle';

import zotero from '../locales/en-US/zotero.ftl';
import reader from '../locales/en-US/reader.ftl';

export let bundle = new FluentBundle('en-US', {
	functions: {
		PLATFORM: () => 'web',
	},
});

function isString(x) {
	return typeof x === 'string' && x.trim().length > 0;
}

if (isString(zotero) && isString(reader)) {
	bundle.addResource(new FluentResource(zotero));
	bundle.addResource(new FluentResource(reader));
}

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
	bundle.addResource(new FluentResource(ftl));
}
