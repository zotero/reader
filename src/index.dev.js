import Reader from './common/reader';
import pdf from '../demo/pdf';
import epub from '../demo/epub';
import snapshot from '../demo/snapshot';
import zoteroFTL from '../locales/en-US/zotero.ftl';
import readerFTL from '../locales/en-US/reader.ftl';
import brandFTL from '../locales/en-US/brand.ftl';

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
		ftl: [zoteroFTL, readerFTL, brandFTL],
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
		onSetReadAloudVoice(options) {
			console.log('Set read aloud voice', options);
		},
		onSetReadAloudStatus(status) {
			console.log('Set read aloud status', status);
		},
		enableReadAloud: true,
		readAloudRemoteInterface: ZOTERO_API_KEY && {
			async getVoices() {
				let url = 'https://api.zotero.org/tts/voices';
				let params = new URLSearchParams();
				params.set('lang', navigator.language);
				params.set('version', '1');
				let response;
				try {
					response = await fetch(url + '?' + params, {
						headers: {
							'Zotero-API-Key': ZOTERO_API_KEY,
						},
					});
				}
				catch (e) {
					console.error('Failed to fetch voices from API');
					return {
						error: 'network',
						standardCreditsRemaining: null,
						premiumCreditsRemaining: null,
					};
				}

				if (!response.ok) {
					console.error('Failed to fetch voices from API', response.status, await response.text());
					return {
						error: 'unknown',
						standardCreditsRemaining: null,
						premiumCreditsRemaining: null,
					};
				}

				let standardCreditsRemaining = response.headers.has('Zotero-TTS-Standard-Credits-Remaining')
					? parseInt(response.headers.get('Zotero-TTS-Standard-Credits-Remaining'))
					: null;
				let premiumCreditsRemaining = response.headers.has('Zotero-TTS-Premium-Credits-Remaining')
					? parseInt(response.headers.get('Zotero-TTS-Premium-Credits-Remaining'))
					: null;
				let devMode = response.headers.get('Zotero-TTS-Dev') === '1';
				return {
					voices: await response.json(),
					standardCreditsRemaining,
					premiumCreditsRemaining,
					devMode,
				};
			},

			async resetCredits() {
				let response;
				try {
					response = await fetch('https://api.zotero.org/tts/reset', {
						method: 'POST',
						headers: {
							'Zotero-API-Key': ZOTERO_API_KEY,
						},
					});
				}
				catch (e) {
					console.error('Failed to reset credits');
					return { standardCreditsRemaining: null, premiumCreditsRemaining: null };
				}

				if (!response.ok) {
					console.error('Failed to reset credits', response.status, await response.text());
					return { standardCreditsRemaining: null, premiumCreditsRemaining: null };
				}

				let json = await response.json();
				return {
					standardCreditsRemaining: json.standardCreditsRemaining ?? null,
					premiumCreditsRemaining: json.premiumCreditsRemaining ?? null,
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
					console.error('Failed to fetch credits from API');
					return { standardCreditsRemaining: null, premiumCreditsRemaining: null };
				}

				if (!response.ok) {
					console.error('Failed to fetch credits from API', response.status, await response.text());
					return { standardCreditsRemaining: null, premiumCreditsRemaining: null };
				}

				let json = await response.json();
				return {
					standardCreditsRemaining: json.standardCreditsRemaining ?? null,
					premiumCreditsRemaining: json.premiumCreditsRemaining ?? null,
				};
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
					let body = await response.text();
					return {
						audio: null,
						error: body === 'daily_limit_exceeded' ? 'daily-limit-exceeded' : 'quota-exceeded',
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
		},
	});
	reader.enableAddToNote(true);
	window._reader = reader;
	await reader.initializedPromise;
}

createReader();
