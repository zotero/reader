import View from './common/view';

function postMessage(event, params = {}) {
	window.webkit.messageHandlers.textHandler.postMessage({ event, params });
}

function log(data) {
	window.webkit.messageHandlers.logHandler.postMessage(data);
}

function base64ToBytes(base64) {
	const text = atob(base64);
	const length = text.length;
	const bytes = new Uint8Array(length);
	for (let i = 0; i < length; i++) {
		bytes[i] = text.charCodeAt(i);
	}
	return bytes;
}

function decodeBase64(base64) {
	const decoder = new TextDecoder();
	return decoder.decode(base64ToBytes(base64));
}

window.createView = (options) => {
	log("Create " + options.type + " view");
	const annotations = JSON.parse(decodeBase64(options.annotations));
	log("Loaded " + annotations.length + " annotations");

	let url = new URL(options.url).toString();
	delete options.annotations;
	delete options.url;
	window._view = new View({
		...options,
		platform: 'ios',
		annotations: annotations,
		container: document.getElementById('view'),
		penActive: false,
		data: { url },
		onInitialized: () => {
			postMessage('onViewContentInitialized');
		},
		onSaveAnnotations: (annotations) => {
			postMessage('onSaveAnnotations', { annotations });

			if (annotations[0].type == "note") {
				window._view.selectAnnotations([annotations[0].id]);
			}
		},
		onSetOutline: (outline) => {
			postMessage('onSetOutline', { outline });
		},
		onSelectAnnotations: (ids) => {
			postMessage('onSelectAnnotations', { ids });
			window._view.selectAnnotations(ids);
		},
		onSetSelectionPopup: (params) => {
			postMessage('onSetSelectionPopup', params);
		},
		onSetAnnotationPopup: (params) => {
			postMessage('onSetAnnotationPopup', params);
		},
		onOpenLink: (url) => {
			postMessage('onOpenLink', { url });
		},
		onFindResult: (result) => {
			postMessage('onFindResult', result);
		},
		onChangeViewState: (state) => {
			postMessage('onChangeViewState', { state });
		},
		onChangeViewStats: (stats) => {
			postMessage('onChangeViewStats', { stats });
		},
		onBackdropTap: () => {
			postMessage('onBackdropTap');
		}
	});
};

window.setContainerInsets = (options) => {
	log("Set container insets: " + JSON.stringify(options));
	const style = document.documentElement.style;
	style.setProperty('--safe-area-inset-top', (options.top || 0) + 'px');
	style.setProperty('--safe-area-inset-right', (options.right || 0) + 'px');
	style.setProperty('--safe-area-inset-bottom', (options.bottom || 0) + 'px');
	style.setProperty('--safe-area-inset-left', (options.left || 0) + 'px');
};

window.setTool = (options) => {
	log("Set tool: " + options.type + "; color: " + options.color);
	window._view.setTool(options);
};

window.clearTool = () => {
	log("Clear tool");
	window._view.setTool();
};

window.updateAnnotations = (options) => {
	const deletions = JSON.parse(decodeBase64(options.deletions));
	const insertions = JSON.parse(decodeBase64(options.insertions));
	const modifications = JSON.parse(decodeBase64(options.modifications));

	if (deletions.length > 0) {
		log("Delete: " + JSON.stringify(deletions));
		window._view.unsetAnnotations(deletions);
	}
	let updates = [...insertions, ...modifications];
	if (updates.length > 0) {
		log("Add/Update: " + JSON.stringify(updates));
		window._view.setAnnotations(updates);
	}
};

window.search = (options) => {
	const term = decodeBase64(options.term);
	log("Search document: " + term);
	window._view.find({ query: term, highlightAll: true, caseSensitive: false, entireWord: false });
};

window.select = (options) => {
	log("Select: " + options.key);
	window._view.selectAnnotations([options.key]);
	window._view.navigate({ annotationID: options.key });
};

window.navigate = (options) => {
	const decodedLocation = JSON.parse(decodeBase64(options.location));
	log("Show location: " + JSON.stringify(decodedLocation));
	window._view.navigate(decodedLocation);
};

window.setSDTPack = (options) => {
	log("Set SDT pack: v" + options.packVersion + " schema " + options.schemaMajorVersion);
	window._view.setSDTPack({
		bytes: base64ToBytes(options.bytes),
		packVersion: options.packVersion,
		schemaMajorVersion: options.schemaMajorVersion,
	});
};

window.sdtAnchorToPosition = async (options) => {
	const anchor = JSON.parse(decodeBase64(options.anchor));
	const position = await window._view.sdtAnchorToPosition(anchor);
	postMessage('onSDTPosition', { requestID: options.requestID, position });
};

window.createAnnotationFromSDT = async (options) => {
	const params = JSON.parse(decodeBase64(options.params));
	log("Create annotation from SDT: " + params.type);
	const annotation = await window._view.createAnnotationFromSDT(params);
	postMessage('onCreateAnnotationFromSDT', { requestID: options.requestID, annotation });
};

window.getReadAloudSegments = async (options) => {
	log("Get Read Aloud segments: " + options.granularity);
	const segments = await window._view.getReadAloudSegments(options.granularity);
	postMessage('onReadAloudSegments', { requestID: options.requestID, segments });
};

window.getReadAloudStartBlockIndex = async (options) => {
	let blockIndex = null;
	try {
		blockIndex = await window._view.getVisibleBlockIndex();
	}
	catch (error) {
		log("Read Aloud start block index unavailable: " + error);
	}
	postMessage('onReadAloudStartBlockIndex', { requestID: options.requestID, blockIndex });
};

// Creates the Read Aloud highlight session annotation, or resizes/restyles it when `params.id` is provided. The app
// keeps the session state (including the annotation id) and stores the annotation only when the session ends, so the
// resulting annotation is reported back to it.
window.setReadAloudAnnotation = async (options) => {
	const params = JSON.parse(decodeBase64(options.params));
	log("Set Read Aloud annotation: " + params.type);
	let annotation = null;
	try {
		annotation = await window._view.setReadAloudAnnotation(params);
	}
	catch (error) {
		log("Read Aloud annotation unavailable: " + error);
	}
	// Always respond, the app waits for the response to keep track of the session.
	postMessage('onReadAloudAnnotation', { requestID: options.requestID, annotation });
};

// Removes the Read Aloud highlight session annotation from the document (discarded session).
window.unsetReadAloudAnnotation = (options) => {
	log("Unset Read Aloud annotation: " + options.key);
	window._view.unsetAnnotations([options.key]);
};

window.setReadAloudSpotlight = async (options) => {
	const anchor = options.anchor ? JSON.parse(decodeBase64(options.anchor)) : null;
	log("Set Read Aloud spotlight: " + (anchor ? JSON.stringify(anchor) : "clear"));
	const position = anchor ? await window._view.sdtAnchorToPosition(anchor) : null;
	window._view.setReadAloudSpotlight(position);
};

// Notify when iframe is loaded
postMessage('onInitialized');
