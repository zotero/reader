import {
	SDT_PACK_VERSION,
	SDT_SCHEMA_VERSION,
} from '../structured-document-text/src/read.js';

const CONTENT_TYPES = {
	pdf: 'application/pdf',
	epub: 'application/epub+zip',
	snapshot: 'text/html',
};

// Dummy hash
const DEV_SOURCE_HASH = '0'.repeat(32);

// Served by webpack-dev-server from ../document-worker/build/ (see devServer.static
// in webpack.config.js). If document-worker hasn't been built, the worker fails
// to load and getSDTPack() reports failure.
const DOCUMENT_WORKER_BASE = 'document-worker/';

let documentWorker = null;
let documentWorkerFailed = false;
let lastWorkerPromiseID = 0;
// id -> { resolve, reject }.
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
		if (message.progressID) {
			let pending = workerPromises[message.progressID];
			pending?.onProgress?.(message.data.progress);
			return;
		}
		if (message.responseID) {
			let pending = workerPromises[message.responseID];
			if (!pending) return;
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

function queryDocumentWorker(action, data, transfer, onProgress) {
	let worker = initDocumentWorker();
	if (!worker) {
		return Promise.reject(new Error('Document worker unavailable'));
	}
	return new Promise((resolve, reject) => {
		lastWorkerPromiseID++;
		workerPromises[lastWorkerPromiseID] = { resolve, reject, onProgress };
		worker.postMessage({ id: lastWorkerPromiseID, action, data }, transfer || []);
	});
}

/**
 * Generate an SDT pack with the document worker and return it in the shape
 * the reader's getSDTPack option expects (matching Zotero.SDT.getPack()).
 *
 * @param {string} type
 * @param {string} fileName
 * @param {Object} [options]
 * @param {function(number)} [options.onProgress] - Called with a 0-100 completion
 *   percentage as the document worker extracts the document, matching the real
 *   host (Zotero.SDT.getPack())
 */
export async function getSDTPack(type, fileName, { onProgress } = {}) {
	let contentType = CONTENT_TYPES[type];
	if (!contentType) {
		return { ok: false, reason: 'unavailable' };
	}
	try {
		let res = await fetch(fileName);
		let buf = await res.arrayBuffer();
		let result = await queryDocumentWorker(
			'getStructuredDocumentText',
			// reportProgress opts into the worker's progress messages
			{ buf, contentType, sourceHash: DEV_SOURCE_HASH, reportProgress: !!onProgress },
			[buf],
			onProgress
		);
		if (!result?.buf) {
			return { ok: false, reason: 'failed' };
		}
		return {
			ok: true,
			bytes: result.buf,
			packVersion: SDT_PACK_VERSION,
			schemaMajorVersion: Number(SDT_SCHEMA_VERSION.split('.')[0]),
		};
	}
	catch (e) {
		console.warn('Failed to generate SDT:', e);
		return { ok: false, reason: 'failed' };
	}
}

