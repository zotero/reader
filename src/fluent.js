import { FluentBundle, FluentResource } from '@fluent/bundle';

export let bundle = new FluentBundle('en-US', {
	functions: {
		PLATFORM: () => 'web',
	},
});

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
