import pako from 'pako';
import {
	openStructuredDocumentTextPack,
	SDT_PACK_VERSION,
	SDT_SCHEMA_VERSION,
} from '../../../structured-document-text/src/read.js';
import { createPositionMapper } from './create-position-mapper.ts';

function schemaMajor(version) {
	let major = Number(String(version || '').split('.')[0]);
	return Number.isInteger(major) ? major : null;
}

function abortError() {
	let error = new Error('SDT operation aborted');
	error.name = 'AbortError';
	return error;
}

function throwIfAborted(signal) {
	if (signal.aborted) {
		throw abortError();
	}
}

/** Owns the SDT pack reader and materialized data for one document. */
export class SDTDocumentSession {
	constructor({
		getPack = null,
		onProgress = null,
		documentType = null,
		retainReader = true,
	} = {}) {
		this._getPack = typeof getPack === 'function' ? getPack : null;
		this._onProgress = onProgress;
		this._documentType = documentType;
		this._retainReader = retainReader;
		this._pack = null;
		this._packAcquired = false;
		this._readerPromise = null;
		this._documentPromise = null;
		this._document = null;
		this._abortController = new AbortController();
		this._progress = null;
	}

	setPack(pack) {
		this._pack = pack ? { ...pack, ok: true } : null;
		this.reset();
	}

	reset() {
		this._abortController.abort();
		this._abortController = new AbortController();
		this._packAcquired = false;
		this._readerPromise = null;
		this._documentPromise = null;
		this._document = null;
		this._setProgress(null);
	}

	getLoadedDocument() {
		return this._document;
	}

	getDocument() {
		if (this._document) {
			return Promise.resolve(this._document);
		}
		if (!this._documentPromise) {
			let signal = this._abortController.signal;
			let promise = (async () => {
				let reader = await this.getReader();
				if (!reader || signal.aborted || this._documentPromise !== promise) {
					return null;
				}
				let structure = await reader.materialize();
				throwIfAborted(signal);
				if (this._documentPromise !== promise) {
					return null;
				}
				if (this._documentType
						&& structure?.metadata?.processor?.type !== this._documentType) {
					throw new Error(`Expected ${this._documentType} SDT`);
				}
				this._document = {
					structure,
					mapper: createPositionMapper(structure),
				};
				if (!this._retainReader) {
					this._readerPromise = null;
				}
				return this._document;
			})().catch((error) => {
				if (error.name !== 'AbortError' && !signal.aborted) {
					console.warn('Failed to materialize SDT document', error);
				}
				return null;
			}).finally(() => {
				// Retry only when the reader itself remained unavailable. Invalid
				// acquired packs stay failed until the session is reset.
				if (this._documentPromise === promise
						&& !this._document
						&& !this._readerPromise) {
					this._documentPromise = null;
				}
			});
			this._documentPromise = promise;
		}
		return this._documentPromise;
	}

	async getReader() {
		if (!this._readerPromise) {
			let signal = this._abortController.signal;
			let promise = this._openReader(signal)
				.catch((error) => {
					if (error.name !== 'AbortError'
							&& !signal.aborted) {
						console.warn('Failed to open SDT pack', error);
					}
					return null;
				})
				.then((reader) => {
					// Retry only pulls that did not produce bytes. Once acquired, retain
					// the result for this session, including invalid packs.
					if (!reader
							&& !signal.aborted
							&& !this._packAcquired) {
						this._readerPromise = null;
					}
					return reader;
				});
			this._readerPromise = promise;
		}
		return this._readerPromise;
	}

	async _openReader(signal) {
		let pack = await this._acquirePack(signal);
		if (!pack) {
			return null;
		}
		throwIfAborted(signal);
		this._validateEnvelope(pack);
		// Passing the owned byte buffer directly avoids copying the complete
		// compressed content during full-pack reads.
		let reader = await openStructuredDocumentTextPack(pack.bytes, {
			inflate: bytes => pako.inflateRaw(bytes),
		});
		throwIfAborted(signal);
		if (schemaMajor(reader.header.schemaVersion) !== schemaMajor(SDT_SCHEMA_VERSION)) {
			throw new Error(`Unsupported SDT schema version: ${reader.header.schemaVersion}`);
		}
		return reader;
	}

	async _acquirePack(signal) {
		throwIfAborted(signal);
		if (this._pack) {
			this._packAcquired = true;
			return this._pack;
		}
		if (!this._getPack) {
			return null;
		}

		try {
			let result = await this._getPack({
				signal,
				onProgress: (progress) => {
					if (!signal.aborted) {
						this._setProgress(progress);
					}
				},
			});
			throwIfAborted(signal);
			if (result?.ok) {
				this._packAcquired = true;
				this._setProgress(null);
				return result;
			}
			if (result?.reason) {
				console.warn('SDT pack unavailable:', result.reason);
			}
		}
		catch (error) {
			if (signal.aborted) {
				throw abortError();
			}
			if (error.name === 'AbortError') {
				throw error;
			}
			console.warn('Failed to acquire SDT pack', error);
		}
		this._setProgress(null);
		return null;
	}

	_validateEnvelope(pack) {
		if (!pack?.bytes) {
			throw new Error('SDT pack has no bytes');
		}
		if (pack.packVersion !== SDT_PACK_VERSION) {
			throw new Error(`Unsupported SDT pack version: ${pack.packVersion}`);
		}
		if (pack.schemaMajorVersion !== schemaMajor(SDT_SCHEMA_VERSION)) {
			throw new Error(`Unsupported SDT schema major version: ${pack.schemaMajorVersion}`);
		}
	}

	_setProgress(progress) {
		progress = Number.isFinite(progress) ? progress : null;
		if (this._progress === progress) {
			return;
		}
		this._progress = progress;
		this._onProgress?.(progress);
	}
}
