import Reader from './common/reader';

window.createReader = (options) => {
	if (window._reader) {
		throw new Error('Reader is already initialized');
	}
	options.platform = 'zotero';

	let { onOpenContextMenu } = options;
	options.onOpenContextMenu = (params) => {
		if (params.internal) {
			reader.openContextMenu(params);
			return;
		}
		window.contextMenuParams = params;
		onOpenContextMenu(params);
	};

	let reader = new Reader(options);
	window._reader = reader;
	return reader;
};
