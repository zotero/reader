import View from './common/view';
import epub from '../demo/epub';
import snapshot from '../demo/snapshot';

window.dev = true;

window.createView = (options) => {
	let view = new View({
		...options,
		container: document.getElementById('view'),
		onSaveAnnotations: (annotations) => {
			// New annotation was created or existing was modified. Although, view, probably, won't need
			// to modify existing annotations for now
			console.log('Save annotations', annotations);
		},
		// We could have 'onDeleteAnnotations', but probably not needed, because on mobile app the deletion
		// will happen outside the view
		onSetOutline: (outline) => {
			console.log('Set outline', outline);
		},
		onSelectAnnotations: (ids) => {
			console.log('Select annotations', ids);
			view.selectAnnotations(ids);
		},
		onSetSelectionPopup: (params) => {
			// Can open or close selection popup.
			// 'params.rect' is a rectangle around which selection popup should be positioned.
			// 'params.annotation' is pre-created annotation that should actually be created by the app,
			// if user presses 'highlight' in the selection popup.
			// TODO: 'onSetSelectionPopup' will also be called when view is being scrolled, but it doesn't do that yet.
			// Selection popup should either change its position or stay hidden while scrolling is in progress
			console.log('Set selection popup', params);
		},
		onSetAnnotationPopup: (params) => {
			// Similar to 'onSetSelectionPopup'. Can open or close selection popup. Will also be
			// triggered by scroll. Although possibly this won't be needed for mobile app because
			// annotation popup can be opened (or annotation selected in sidebar) when
			// 'onSelectAnnotations' is fired
			console.log('Set annotation popup', params);
		},
		onOpenLink: (url) => {
			console.log('Open external link', url);
		},
		onFindResult: (result) => {
			// TODO: This is not currently called because onSetFindState is not called from EPUB and snapshot views.

			// 'result' example:
			// let result = {
			// 	total: 2
			// 	index: 0,
			// 	snippets: ['…first result snippet…', '…second result snippet…']
			// };

			// Once user picks a result, trigger the same search again, but with the snippet index
			// to focus specific result:
			// view.find({ …, index: 123 })
			console.log('Received find result', result);
		},
		onChangeViewState: (state) => {
			// Provides view state that can be later used to re-create the view at the same position, zoom, etc.
			// The current position (similar to attachmentLastPageIndex setting for PDF) will be taken from here
			console.log('View state changed', state);
		},
		onChangeViewStats: (stats) => {
			// Provides useful information about the view
			console.log('View stats changed', stats);
		},
		onBackdropTap: (event) => {
			console.log('Backdrop tap', event);
		},
	});

	window._view = view;
};

async function main() {
	if (window._view) {
		throw new Error('View is already initialized');
	}
	let queryString = window.location.search;
	let urlParams = new URLSearchParams(queryString);
	let type = urlParams.get('type') || 'snapshot';
	let demo;
	if (type === 'epub') {
		demo = epub;
	}
	else if (type === 'snapshot') {
		demo = snapshot;
	}
	let res = await fetch(demo.fileName);
	window.createView({
		type,
		data: {
			buf: new Uint8Array(await res.arrayBuffer()),
		},
		annotations: demo.annotations,
		// location: {
		// 	annotationID: 123
		// },
		// viewState: {
		// 	scale: 2
		// },
	});

	// It seems EPUB view isn't fully functioning for 10 or more seconds. TODO: Fix

	// Examples:
	// // Initiate search
	// window._view.find({
	// 	query: 'the',
	// 	highlightAll: false,
	// 	caseSensitive: false,
	// 	entireWord: false,
	// });
	// // Cancel search
	// window._view.find(null);
	// window._view.zoomIn();
	// window._view.zoomIn();
	// window._view.zoomReset();
	// // Set annotation tool and color (currently doesn't work on snapshots TODO: Fix)
	// window._view.setTool({ type: 'highlight', color: '#ffd400' });
	// Clear annotation tool
	// window._view.setTool();

	// Add/replace annotation in the view. See complete annotation examples in
	// demo/epub/annotations.js and demo/snapshot/annotations.js
	// window._view.setAnnotations([
	// 	{
	// 		id: "FZMV3CF6",
	// 		type: "highlight",
	// 		color: "#a28ae5",
	// 		position: {
	// 			…
	// 		}
	// 		…
	// 	}
	// ]);

	// Remove annotation from the view
	// window._view.unsetAnnotations(['FZMV3CF6']);
}

main();
