const CONTENT_TYPES = {
	pdf: 'application/pdf',
	epub: 'application/epub+zip',
	snapshot: 'text/html',
};

// Served by webpack-dev-server from ../document-worker/build/ (see devServer.static
// in webpack.config.js). If document-worker hasn't been built, the worker fails
// to load and getSDT() resolves to null.
const DOCUMENT_WORKER_BASE = 'document-worker/';

let documentWorker = null;
let documentWorkerFailed = false;
let lastWorkerPromiseID = 0;
// id -> { resolve, reject, onPartial? }. onPartial is set for streaming queries.
let workerPromises = {};

function failAllPending(error) {
	for (let id of Object.keys(workerPromises)) {
		workerPromises[id].reject(error);
		delete workerPromises[id];
	}
}

function initDocumentWorker() {
	if (documentWorker || documentWorkerFailed) {
		return documentWorker;
	}
	documentWorker = new Worker(DOCUMENT_WORKER_BASE + 'worker.js');
	documentWorker.addEventListener('error', (event) => {
		console.warn(`Document worker failed to load from ${DOCUMENT_WORKER_BASE}:`, event.message || event);
		documentWorkerFailed = true;
		failAllPending(new Error('Document worker unavailable'));
		documentWorker = null;
	});
	documentWorker.addEventListener('message', async (event) => {
		let message = event.data;
		if (message.responseID) {
			let pending = workerPromises[message.responseID];
			if (!pending) return;
			if (message.isPartial) {
				if (pending.onPartial) {
					try {
						pending.onPartial(message.data);
					}
					catch (e) {
						console.warn('onPartial handler threw:', e);
					}
				}
				return;
			}
			delete workerPromises[message.responseID];
			if ('error' in message) {
				pending.reject(new Error(JSON.stringify(message.error)));
			}
			else {
				pending.resolve(message.data);
			}
			return;
		}
		if (message.id) {
			let respData = null;
			try {
				if (message.action === 'FetchBuiltInCMap') {
					let res = await fetch(DOCUMENT_WORKER_BASE + 'cmaps/' + message.data + '.bcmap');
					respData = { isCompressed: true, cMapData: new Uint8Array(await res.arrayBuffer()) };
				}
				else if (message.action === 'FetchStandardFontData') {
					let res = await fetch(DOCUMENT_WORKER_BASE + 'standard_fonts/' + message.data);
					respData = new Uint8Array(await res.arrayBuffer());
				}
				else if (message.action === 'FetchWasm') {
					let res = await fetch(DOCUMENT_WORKER_BASE + 'wasm/' + message.data);
					respData = new Uint8Array(await res.arrayBuffer());
				}
				else if (message.action === 'FetchData') {
					let res = await fetch(DOCUMENT_WORKER_BASE + message.data);
					respData = new Uint8Array(await res.arrayBuffer());
				}
			}
			catch (e) {
				console.warn(`Document worker ${message.action} failed:`, e);
			}
			documentWorker.postMessage({ responseID: message.id, data: respData });
		}
	});
	return documentWorker;
}

function queryDocumentWorker(action, data, transfer) {
	let worker = initDocumentWorker();
	if (!worker) {
		return Promise.reject(new Error('Document worker unavailable'));
	}
	return new Promise((resolve, reject) => {
		lastWorkerPromiseID++;
		workerPromises[lastWorkerPromiseID] = { resolve, reject };
		worker.postMessage({ id: lastWorkerPromiseID, action, data }, transfer || []);
	});
}

function streamingQueryDocumentWorker(action, data, transfer, onPartial) {
	let worker = initDocumentWorker();
	if (!worker) {
		return {
			id: null,
			promise: Promise.reject(new Error('Document worker unavailable')),
			abort: () => {},
		};
	}
	lastWorkerPromiseID++;
	let id = lastWorkerPromiseID;
	let promise = new Promise((resolve, reject) => {
		workerPromises[id] = { resolve, reject, onPartial };
		worker.postMessage({ id, action, data }, transfer || []);
	});
	let abort = () => {
		if (workerPromises[id]) {
			worker.postMessage({ action: 'abort', id });
		}
	};
	return { id, promise, abort };
}

export async function generateSDT(type, fileName, password) {
	let contentType = CONTENT_TYPES[type];
	if (!contentType) return null;
	try {
		let res = await fetch(fileName);
		let buf = await res.arrayBuffer();
		return await queryDocumentWorker(
			'getStructuredDocumentText',
			{ buf, contentType, password },
			[buf]
		);
	}
	catch (e) {
		console.warn('Failed to generate SDT:', e);
		return null;
	}
}

export async function streamSDT(type, fileName, password, onChunk, onStart) {
	let contentType = CONTENT_TYPES[type];
	if (!contentType) return;
	let res = await fetch(fileName);
	let buf = await res.arrayBuffer();
	let { promise, abort } = streamingQueryDocumentWorker(
		'getStructuredDocumentText',
		{ buf, contentType, password, streaming: true },
		[buf],
		(chunk) => {
			try {
				onChunk(chunk);
			}
			catch (e) {
				console.warn('getSDTStream onChunk threw:', e);
			}
		},
	);
	if (onStart) {
		try {
			onStart(abort);
		}
		catch (e) {
			console.warn('getSDTStream onStart threw:', e);
		}
	}
	await promise;
}
