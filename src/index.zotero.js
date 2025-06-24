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

	let { onSaveAnnotations } = options;
	// Reader iframe doesn't have permissions to wait for onSaveAnnotations
	// promise, therefore using callback to inform when saving finishes
	options.onSaveAnnotations = async (annotations) => {
		return new Promise((resolve) => {
			onSaveAnnotations(annotations, resolve);
		});
	};

	let reader = new Reader(options);
	window._reader = reader;
	return reader;
};
