import Reader from './common/reader';
import strings from '../src/en-us.strings';
import pdf from '../demo/pdf';
import epub from '../demo/epub';
import snapshot from '../demo/snapshot';

window.dev = true;

async function createReader() {
	if (window._reader) {
		throw new Error('Reader is already initialized');
	}
	let queryString = window.location.search;
	let urlParams = new URLSearchParams(queryString);
	let type = urlParams.get('type') || 'pdf';
	let demo;
	if (type === 'pdf') {
		demo = pdf;
	}
	else if (type === 'epub') {
		demo = epub;
	}
	else if (type === 'snapshot') {
		demo = snapshot;
	}
	let res = await fetch(demo.fileName);
	let reader = new Reader({
		type,
		localizedStrings: strings,
		readOnly: false,
		data: {
			buf: new Uint8Array(await res.arrayBuffer()),
			url: new URL('/', window.location).toString()
		},
		// rtl: true,
		annotations: demo.annotations,
		primaryViewState: demo.state,
		sidebarWidth: 240,
		bottomPlaceholderHeight: null,
		toolbarPlaceholderWidth: 0,
		authorName: 'John',
		showAnnotations: true,
		// platform: 'web',
		// password: 'test',
		onOpenContextMenu(params) {
			reader.openContextMenu(params);
		},
		onAddToNote() {
			alert('Add annotations to the current note');
		},
		onSaveAnnotations: async function (annotations) {
			console.log('Save annotations', annotations);
		},
		onDeleteAnnotations: function (ids) {
			console.log('Delete annotations', JSON.stringify(ids));
		},
		onChangeViewState: function (state, primary) {
			console.log('Set state', state, primary);
		},
		onOpenTagsPopup(annotationID, left, top) {
			alert(`Opening Zotero tagbox popup for id: ${annotationID}, left: ${left}, top: ${top}`);
		},
		onClosePopup(data) {
			console.log('onClosePopup', data);
		},
		onOpenLink(url) {
			alert('Navigating to an external link: ' + url);
		},
		onToggleSidebar: (open) => {
			console.log('Sidebar toggled', open);
		},
		onChangeSidebarWidth(width) {
			console.log('Sidebar width changed', width);
		},
		onSetDataTransferAnnotations(dataTransfer, annotations, fromText) {
			console.log('Set formatted dataTransfer annotations', dataTransfer, annotations, fromText);
		},
		onConfirm(title, text, confirmationButtonTitle) {
			return window.confirm(text);
		},
		onRotatePages(pageIndexes, degrees) {
			console.log('Rotating pages', pageIndexes, degrees);
		},
		onDeletePages(pageIndexes, degrees) {
			console.log('Deleting pages', pageIndexes, degrees);
		},
		onToggleContextPane() {
			console.log('Toggle context pane');
		},
		onTextSelectionAnnotationModeChange(mode) {
			console.log(`Change text selection annotation mode to '${mode}'`);
		},
		onSaveCustomThemes(customThemes) {
			console.log('Save custom themes', customThemes);
		},
		onRecognizeReference(reference, type, callback) {
			console.log('Resolving reference', type, reference);

			if (type === 'match') {
				let object1 = {
					"status": null,
				};
				setTimeout(() => callback(object1), 0);

				let object2 = {
					"status": 'unmatched',
				};
				setTimeout(() => callback(object2), 2000);
			}
			else {
				let object1 = {
					"status": null,
				};

				setTimeout(() => callback(object1), 0);

// return;
				let object2 = {
					"status": "recognized",
					"title": "Plasma proteins present in osteoarthritic synovial fluid can stimulate cytokine production via Toll-like receptor 4",
					"creator": "Sohn et al.",
					"year": "2012",
					"url": "https://doi.org/10.1186/ar3555"
				};

				setTimeout(() => callback(object2), 2000);


				let object3 = {
					"status": "recognized",
					"title": "Plasma proteins present in osteoarthritic synovial fluid can stimulate cytokine production via Toll-like receptor 4",
					"creator": "Sohn et al.",
					"year": "2012",
					"url": "https://doi.org/10.1186/ar3555",
					"abstract": "Osteoarthritis (OA) is a degenerative disease characterized by cartilage breakdown in the synovial joints. The presence of low-grade inflammation in OA joints is receiving increasing attention, with synovitis shown to be present even in the early stages of the disease. How the synovial inflammation arises is unclear, but proteins in the synovial fluid of affected joints could conceivably contribute. We therefore surveyed the proteins present in OA synovial fluid and assessed their immunostimulatory properties."
				};
				// object = null;
				setTimeout(() => callback(object3), 4000);
			}
		},
		onAddToLibrary(url, callback) {
			let object = {
				"itemID": 55390,
				"title": "Plasma proteins present in osteoarthritic synovial fluid can stimulate cytokine production via Toll-like receptor 4",
				"creator": "Sohn et al.",
				"year": "2012",
				"url": "https://doi.org/10.1186/ar3555",
				"abstract": "Osteoarthritis (OA) is a degenerative disease characterized by cartilage breakdown in the synovial joints. The presence of low-grade inflammation in OA joints is receiving increasing attention, with synovitis shown to be present even in the early stages of the disease. How the synovial inflammation arises is unclear, but proteins in the synovial fluid of affected joints could conceivably contribute. We therefore surveyed the proteins present in OA synovial fluid and assessed their immunostimulatory properties."
			};
			setTimeout(() => callback(object), 1000);
		}
	});
	reader.enableAddToNote(true);
	window._reader = reader;
	await reader.initializedPromise;
}

createReader();
