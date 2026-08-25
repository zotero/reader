import { PDFPositionMapper } from '../common/sdt/pdf-position-mapper.ts';
import {
	LazyPDFSDTDocument,
	SDTValidationError,
	validatePDFSDTDocument,
} from './semantic-overlays.mjs';
import {
	createReaderSDTSearchData,
	createSDTSearchData,
} from './sdt-search.mjs';

const SEARCH_RUN_DATA_CACHE_WEIGHT = 20_000;

/** Coordinates optional SDT document and search data for one PDF view. */
export class PDFSDTIntegration {
	constructor({
		session,
		documentData,
		search,
	} = {}) {
		this._session = session;
		this._documentData = documentData;
		this._search = search;
		this._documentPromise = null;
		this._searchPromise = null;
		this._searchData = null;
		this._searchValidationFailed = false;
		this._documentAbortController = new AbortController();
		this._searchAbortController = null;
		this._destroyed = false;
	}

	start() {
		if (this._destroyed) {
			return null;
		}
		if (!this._documentPromise) {
			let signal = this._documentAbortController.signal;
			let committed = false;
			let retryable = true;
			let promise = (async () => {
				let validation = await this._documentData.firstPageReadyPromise;
				if (!validation || signal.aborted || this._destroyed) {
					return null;
				}
				let reader = await this._session.getReader();
				if (!reader || signal.aborted || this._destroyed) {
					return null;
				}
				let document = await LazyPDFSDTDocument.open(reader, validation, {
					createMapper: structure => new PDFPositionMapper(structure),
					signal,
				});
				if (!document || signal.aborted || this._destroyed) {
					return null;
				}
				this._documentData.setSemanticDocument(document);
				committed = true;
				return document;
			})().catch((error) => {
				if (error instanceof SDTValidationError) {
					retryable = false;
				}
				if (error.name !== 'AbortError' && !signal.aborted && !this._destroyed) {
					console.warn('Failed to integrate PDF SDT', error);
				}
				return null;
			}).finally(() => {
				if (this._documentPromise === promise
						&& !committed
						&& retryable
						&& !this._destroyed) {
					this._documentPromise = null;
				}
			});
			this._documentPromise = promise;
		}
		return this._documentPromise;
	}

	prepareSearch() {
		this.start();
		if (this._destroyed || this._searchValidationFailed) {
			return Promise.resolve(null);
		}
		if (this._searchData) {
			return Promise.resolve(this._searchData);
		}
		if (!this._searchPromise) {
			let controller = new AbortController();
			let signal = controller.signal;
			this._searchAbortController = controller;
			let promise = (async () => {
				let validation = await this._documentData.firstPageReadyPromise;
				if (!validation || signal.aborted || this._destroyed) {
					return null;
				}
				let loaded = this._session.getLoadedDocument();
				let data;
				if (loaded?.structure) {
					data = createSDTSearchData(loaded.structure, { signal });
				}
				else {
					let reader = await this._session.getReader();
					if (!reader || signal.aborted || this._destroyed) {
						return null;
					}
					data = await createReaderSDTSearchData(reader, { signal });
				}
				let searchData = {
					structure: data.structure,
					mapper: new PDFPositionMapper(data.structure, {
						maxRunDataCacheWeight: SEARCH_RUN_DATA_CACHE_WEIGHT,
					}),
					searchIndex: data.searchIndex,
				};
				this._validateSearchData(searchData);
				await data.searchIndex.prepare();
				if (signal.aborted || this._destroyed || this._searchPromise !== promise) {
					return null;
				}
				this._searchData = searchData;
				this._search.setEligibleSDT(searchData);
				return searchData;
			})().catch((error) => {
				if (error.name !== 'AbortError' && !signal.aborted && !this._destroyed) {
					if (error instanceof SDTValidationError) {
						this._searchValidationFailed = true;
						console.warn('Failed to validate PDF SDT search', error);
					}
					else {
						console.warn('Failed to prepare PDF SDT search', error);
					}
				}
				return null;
			}).finally(() => {
				if (this._searchAbortController === controller) {
					this._searchAbortController = null;
				}
				if (this._searchPromise === promise
						&& !this._searchData
						&& !this._searchValidationFailed
						&& !this._destroyed) {
					this._searchPromise = null;
				}
			});
			this._searchPromise = promise;
		}
		return this._searchPromise;
	}

	trimMemory() {
		this._clearSearch();
	}

	destroy() {
		if (this._destroyed) {
			return;
		}
		this._destroyed = true;
		this._documentAbortController.abort();
		this._searchAbortController?.abort();
		this._searchAbortController = null;
		this._searchPromise = null;
		this._searchData = null;
		this._search.setEligibleSDT(null);
	}

	_validateSearchData(searchData) {
		let validation = this._documentData.getValidation();
		if (!validation) {
			throw new SDTValidationError('PDF view is not ready for SDT validation');
		}
		validatePDFSDTDocument(searchData.structure, validation);
	}

	_clearSearch() {
		this._searchAbortController?.abort();
		this._searchAbortController = null;
		this._searchPromise = null;
		this._searchData = null;
		this._search.setEligibleSDT(null);
	}
}
