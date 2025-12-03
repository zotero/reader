import Reader from './common/reader';
import pdf from '../demo/pdf';
import epub from '../demo/epub';
import snapshot from '../demo/snapshot';

// Injected by Webpack in dev builds
// eslint-disable-next-line no-process-env
const ZOTERO_API_KEY = process.env.ZOTERO_API_KEY;

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
		readOnly: false,
		data: {
			buf: new Uint8Array(await res.arrayBuffer()),
			url: new URL('/', window.location).toString()
		},
		// rtl: true,
		annotations: demo.annotations,
		primaryViewState: demo.state,
		sidebarWidth: 240,
		sidebarView: 'annotations', //thumbnails, outline
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
			window.open(url, /^(https?|file):\/\//.test(url) ? '_blank' : '_self');
		},
		onToggleSidebar: (open) => {
			console.log('Sidebar toggled', open);
		},
		onChangeSidebarWidth(width) {
			console.log('Sidebar width changed', width);
		},
		onChangeSidebarView(view) {
			console.log('Sidebar view changed', view);
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
		onSetReadAloudVoice(lang, voice, speed) {
			console.log('Set read aloud voice', voice, 'for lang', lang, 'with speed', speed);
		},
		onSetReadAloudStatus(status) {
			console.log('Set read aloud status', status);
		},
		readAloudRemoteInterface: ZOTERO_API_KEY && {
			async getVoices() {
				return fetch('https://api.zotero.org/tts/voices', {
					headers: {
						'Zotero-API-Key': ZOTERO_API_KEY,
					},
				}).then(r => r.json());
			},

			async getAudio(segment, voice) {
				let params = new URLSearchParams();
				params.set('text', segment.text);
				params.set('voice', voice.id);
				let response = await fetch('https://api.zotero.org/tts/speak?' + params, {
					headers: {
						'Zotero-API-Key': ZOTERO_API_KEY,
					},
				});
				return {
					audio: await response.blob(),
					secondsRemaining: parseInt(response.headers.get('Zotero-TTS-Seconds-Remaining')),
				};
			}
		},
	});
	reader.enableAddToNote(true);
	window._reader = reader;
	await reader.initializedPromise;
}

createReader();
