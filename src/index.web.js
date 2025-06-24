import Reader from './common/reader';

window.createReader = (options) => {
	if (window._reader) {
		throw new Error('Reader is already initialized');
	}
	options.platform = 'web';
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
