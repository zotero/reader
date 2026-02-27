import Reader from './common/reader';
import zoteroFTL from '../locales/en-US/zotero.ftl';
import readerFTL from '../locales/en-US/reader.ftl';
import brandFTL from '../locales/en-US/brand.ftl';

window.createReader = (options) => {
	if (window._reader) {
		throw new Error('Reader is already initialized');
	}
	options.platform = 'web';
	options.ftl = options.ftl || [zoteroFTL, readerFTL, brandFTL];
	if (window.frameElement) {
		// This fix is needed for epubs to work in web-library. Otherwise instanceof
		// inside epubjs code check fails (window.Uint8Array != window.top.Uint8Array)
		// and epubs are not loaded.
		window.ArrayBuffer = window.top.ArrayBuffer;
	}
	let reader = new Reader({
		onOpenContextMenu: (params) => {
			reader.openContextMenu(params);
		},
		...options,
	});
	window._reader = reader;
	return reader;
};
