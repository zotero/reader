import View from './common/view';

function postMessage(event, params = {}) {
	window.webkit.messageHandlers.textHandler.postMessage({event, params});
}

function log(data) {
	window.webkit.messageHandlers.logHandler.postMessage(data);
}

function decodeBase64(base64) {
    const text = atob(base64);
    const length = text.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = text.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
}

window.createView = options => {
    log("Create " + options.type + " view");
	const annotations = JSON.parse(decodeBase64(options.annotations));
    log("Loaded " + annotations.length + " annotations");
    window._view = new View({
		type: options.type,
		annotations: annotations,
		viewState: options.viewState,
		container: document.getElementById('view'),
		data: {
			url: new URL(options.url)
		},
		onSaveAnnotations: annotations => {
			postMessage('onSaveAnnotations', {annotations});

			if (annotations[0].type == "note") {
				window._view.selectAnnotations([annotations[0].id]);
			}
		},
		onSetOutline: outline => {
			postMessage('onSetOutline', {outline});
		},
		onSelectAnnotations: ids => {
			postMessage('onSelectAnnotations', {ids});
			window._view.selectAnnotations(ids);
		},
		onSetSelectionPopup: params => {
			postMessage('onSetSelectionPopup', params);
		},
		onSetAnnotationPopup: params => {
			postMessage('onSetAnnotationPopup', params);
		},
		onOpenLink: url => {
			postMessage('onOpenLink', {url});
		},
		onFindResult: result => {
			postMessage('onFindResult', result);
		},
		onChangeViewState: state => {
			postMessage('onChangeViewState', {state});
		},
		onChangeViewStats: stats => {
			postMessage('onChangeViewStats', {stats});
		}
	});
}

window.setTool = options => {
	log("Set tool: " + options.type + "; color: " + options.color);
	window._view.setTool(options);
}

window.clearTool = () => {
	log("Clear tool");
	window._view.setTool();
}

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
}

window.search = options => {
	const term = decodeBase64(options.term);
    log("Search document: " + term);
    window._view.find({ query: term, highlightAll: true, caseSensitive: false, entireWord: false });
}

window.select = options => {
	log("Select: " + options.key);
	window._view.selectAnnotations([options.key])
	window._view.navigate({annotationID: options.key});
}

window.navigate = options => {
	const decodedLocation = JSON.parse(decodeBase64(options.location));
	log("Show location: " + JSON.stringify(decodedLocation));
	window._view.navigate(decodedLocation);
}

// Notify when iframe is loaded
postMessage('onInitialized');