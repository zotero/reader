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

// Read Aloud annotation preview: while a highlight session is active the previewed annotation is rendered in the reader
// but its saves are withheld from the app, so nothing is written to the database until the session is confirmed.
let readAloudPreviewAnnotation = null;
const readAloudPreviewIds = new Set();

// Serialize preview create/resize/confirm/cancel. Each is async (awaits the reader), so without a queue a rapid second
// call would read a stale `readAloudPreviewAnnotation` (still null / the previous one) and create a duplicate preview
// annotation — leaving an orphan and making the highlight jump or disappear as the session moves it.
let readAloudPreviewQueue = Promise.resolve();
function enqueueReadAloudPreview(task) {
	readAloudPreviewQueue = readAloudPreviewQueue.then(task).catch((error) => {
		log("Read Aloud preview operation failed: " + error);
	});
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
			// Withhold read-aloud preview annotations (not yet confirmed) so they aren't persisted mid-session.
			const saved = annotations.filter(annotation => !readAloudPreviewIds.has(annotation.id));
			if (!saved.length) {
				return;
			}
			postMessage('onSaveAnnotations', { annotations: saved });

			if (saved[0].type == "note") {
				window._view.selectAnnotations([saved[0].id]);
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
	// The structured-document-text block index currently in view, so playback can start where the reader is. Read at
	// play time (not load) so it reflects the current scroll position.
	let blockIndex = null;
	try {
		const sdt = await window._view._loadSDT();
		if (sdt) {
			blockIndex = window._view._view.getVisibleBlockIndex?.(sdt.structure) ?? null;
		}
	}
	catch (error) {
		log("Read Aloud start block index unavailable: " + error);
	}
	postMessage('onReadAloudStartBlockIndex', { requestID: options.requestID, blockIndex });
};

window.setReadAloudAnnotation = (options) => {
	// Creates or resizes the highlight-session PREVIEW annotation. It renders in the reader but is withheld from the
	// app (see readAloudPreviewIds) until `confirmReadAloudAnnotation`. Resizes the current preview if one exists.
	// Queued so concurrent move/extend calls resize the single preview instead of racing to create duplicates.
	enqueueReadAloudPreview(async () => {
		const params = JSON.parse(decodeBase64(options.params));
		if (readAloudPreviewAnnotation) {
			params.id = readAloudPreviewAnnotation.id;
		}
		log("Set Read Aloud annotation preview: " + params.type);
		const annotation = await window._view.setReadAloudAnnotation(params);
		if (annotation) {
			readAloudPreviewAnnotation = annotation;
			readAloudPreviewIds.add(annotation.id);
		}
		postMessage('onReadAloudAnnotation', { requestID: options.requestID, annotation });
	});
};

window.confirmReadAloudAnnotation = () => {
	// Confirm the session: stop withholding the preview annotation and report it as a normal save so it is persisted.
	enqueueReadAloudPreview(async () => {
		if (!readAloudPreviewAnnotation) {
			return;
		}
		const annotation = readAloudPreviewAnnotation;
		readAloudPreviewIds.delete(annotation.id);
		readAloudPreviewAnnotation = null;
		log("Confirm Read Aloud annotation");
		postMessage('onSaveAnnotations', { annotations: [annotation] });
	});
};

window.cancelReadAloudAnnotation = () => {
	// Discard the session: remove the preview annotation from the reader. onDelete is a no-op on iOS, so nothing is
	// persisted (it was never saved). Safe no-op if already confirmed.
	enqueueReadAloudPreview(async () => {
		if (!readAloudPreviewAnnotation) {
			return;
		}
		const id = readAloudPreviewAnnotation.id;
		readAloudPreviewIds.delete(id);
		readAloudPreviewAnnotation = null;
		log("Cancel Read Aloud annotation");
		window._view.unsetAnnotations([id]);
	});
};

window.setReadAloudSpotlight = async (options) => {
	// Spotlight the currently-read segment. `anchor` is an SDT position ({ start, end }); omit it (or pass null) to clear.
	const anchor = options.anchor ? JSON.parse(decodeBase64(options.anchor)) : null;
	log("Set Read Aloud spotlight: " + (anchor ? JSON.stringify(anchor) : "clear"));
	const position = anchor ? await window._view.sdtAnchorToPosition(anchor) : null;
	try {
		window._view.setReadAloudSpotlight(position);
	}
	catch (error) {
		log("Read Aloud spotlight failed: " + error);
	}
	// Follow the reading position: scroll/turn to the current segment. `navigateToSelector` moves the view to a raw
	// selector; the reader's own read-aloud follow (read-aloud.ts) uses it the same way. (The built-in spotlight
	// navigate instead passes the selector to `navigate`, which only acts on `{ position }` / `{ annotationID }`
	// locations and is therefore a no-op — that's why the view never moved.) Options mirror desktop: `ifNeeded` skips
	// the move when already visible, `block: 'center'` keeps the read text centered.
	if (position) {
		try {
			window._view._view.navigateToSelector(position, { ifNeeded: true, block: 'center', behavior: 'smooth' });
		}
		catch (error) {
			log("Read Aloud follow navigate failed: " + error);
		}
	}
};

// Notify when iframe is loaded
postMessage('onInitialized');
