import Reader from './common/reader';

window.createReader = (options) => {
	if (window._reader) {
		throw new Error('Reader is already initialized');
	}
	options.platform = 'web';
	let reader = new Reader({
		onOpenContextMenu: (params) => {
			reader.openContextMenu(params);
		},
		...options,
	});
	window._reader = reader;
	return reader;
};
