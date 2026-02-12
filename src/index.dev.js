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
		title: 'Demo',
		loggedIn: true,
		// platform: 'web',
		// password: 'test',
		onOpenContextMenu(params) {
			return reader.openContextMenu(params);
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
		onSetReadAloudVoice(lang, region, voice, speed) {
			console.log('Set read aloud voice', voice, 'with region', region, 'for lang', lang, 'with speed', speed);
		},
		onSetReadAloudStatus(status) {
			console.log('Set read aloud status', status);
		},
		enableReadAloud: true,
		readAloudRemoteInterface: ZOTERO_API_KEY && {
			async getVoices() {
				let response;
				try {
					response = await fetch('https://api.zotero.org/tts/voices', {
						headers: {
							'Zotero-API-Key': ZOTERO_API_KEY,
						},
					});
				}
				catch (e) {
					console.error('Failed to fetch voices from API');
					return {
						voices: [],
						creditsRemaining: null,
					};
				}

				if (!response.ok) {
					console.error('Failed to fetch voices from API', response.status, await response.text());
					return {
						voices: [],
						creditsRemaining: null,
					};
				}

				let creditsRemaining = response.headers.has('Zotero-TTS-Credits-Remaining')
					? parseInt(response.headers.get('Zotero-TTS-Credits-Remaining'))
					: null;
				return {
					voices: await response.json(),
					creditsRemaining,
				};
			},

			async getCreditsRemaining() {
				let response;
				try {
					response = await fetch('https://api.zotero.org/tts/credits', {
						headers: {
							'Zotero-API-Key': ZOTERO_API_KEY,
						},
					});
				}
				catch (e) {
					console.error('Failed to fetch creditsRemaining from API');
					return null;
				}

				if (!response.ok) {
					console.error('Failed to fetch creditsRemaining from API', response.status, await response.text());
					return null;
				}

				return (await response.json()).creditsRemaining;
			},

			async getAudio(segment, voice, lang) {
				let url;
				let params = new URLSearchParams();
				if (segment === 'sample') {
					url = 'https://api.zotero.org/tts/sample';
				}
				else {
					url = 'https://api.zotero.org/tts/speak';
					params.set('text', segment.text);
				}
				params.set('voice', voice.id);
				params.set('lang', lang);
				let response;
				try {
					response = await fetch(url + '?' + params, {
						headers: {
							'Zotero-API-Key': ZOTERO_API_KEY,
						},
					});
				}
				catch {
					return {
						audio: null,
						error: 'network',
					};
				}

				if (response.status === 402) {
					return {
						audio: null,
						error: 'quota-exceeded',
					};
				}
				else if (!response.ok) {
					return {
						audio: null,
						error: 'unknown',
					};
				}

				return { audio: await response.blob() };
			},
		},
		onLogIn() {
			setTimeout(() => {
				reader.setLoggedIn(true);
			}, 200);
		}
	});
	reader.enableAddToNote(true);
	window._reader = reader;
	await reader.initializedPromise;
}

createReader();
