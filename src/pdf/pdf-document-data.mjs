import {
	buildAnnotationLinkOverlays,
	loadPDFPageSources,
} from './pdf-page-data.mjs';

const MAX_CONCURRENT_PAGE_PROJECTIONS = 2;

/**
 * Owns the effective native and semantic document data for one PDF view.
 * The native PDF.js data is always authoritative; an optional semantic
 * document enriches the currently retained pages without replacing it.
 */
export class PDFDocumentData {
	constructor({
		resolveDestination,
		isInteractionActive = () => false,
		onPageData,
		onMetadata,
		preview = false,
	} = {}) {
		this.pages = {};
		this.firstPageReadyPromise = preview
			? Promise.resolve(null)
			: new Promise(resolve => this._resolveFirstPageReady = resolve);
		this._resolveDestination = resolveDestination;
		this._isInteractionActive = isInteractionActive;
		this._onPageData = onPageData;
		this._onMetadata = onMetadata;
		this._pdfDocument = null;
		this._basicPages = {};
		this._pagePromises = new Map();
		this._pageRevisions = new Map();
		this._documentValidation = null;
		this._pageValidation = new Map();
		this._nativePageLabels = [];
		this._nativeOutline = null;
		this._outlineActive = false;
		this._outlineAbortController = null;
		this._outlinePromise = null;
		this._semanticDocument = null;
		this._semanticPages = {};
		this._semanticEntries = new Map();
		this._semanticQueue = new Set();
		this._activePageProjections = 0;
		this._semanticRevision = 0;
		this._destroyed = false;
	}

	setDocument(pdfDocument, { loadPageLabels = true } = {}) {
		this._pdfDocument = pdfDocument;
		if (loadPageLabels) {
			this._loadNativePageLabels();
		}
		if (this._outlineActive) {
			this._resolveOutline();
		}
	}

	registerPage(pageIndex, pdfPage) {
		if (this._destroyed || !this._pdfDocument) {
			return;
		}
		this._documentValidation ??= {
			pageCount: this._pdfDocument.numPages,
		};
		this._pageValidation.set(pageIndex, {
			pageIndex,
			viewRect: pdfPage.view.slice(),
			rotation: pdfPage.rotate ?? 0,
			userUnit: pdfPage.userUnit ?? 1,
		});
		this._resolveFirstPageReady?.(this.getValidation());
		this._resolveFirstPageReady = null;
	}

	async ensurePage(pageIndex, pdfPage) {
		let existingPromise = this._pagePromises.get(pageIndex);
		if (existingPromise) {
			return existingPromise;
		}
		if (this.pages[pageIndex]) {
			this.ensureSemanticPage(pageIndex);
			return this.pages[pageIndex];
		}

		let revision = this._pageRevisions.get(pageIndex) || 0;
		let promise = (async () => {
			if (!pdfPage) {
				pdfPage = await this._pdfDocument.getPage(pageIndex + 1);
			}
			let {
				pageData: pageDataPromise,
				annotations: annotationsPromise,
			} = loadPDFPageSources(this._pdfDocument, pdfPage, pageIndex);
			let isCurrent = () => this._isPageCurrent(pageIndex, revision);
			let publish = (changes) => {
				if (!isCurrent()) {
					return null;
				}
				let pageData = {
					chars: [],
					viewBox: pdfPage.view,
					overlays: [],
					...this._basicPages[pageIndex],
					...changes,
				};
				this._basicPages[pageIndex] = pageData;
				this.pages[pageIndex] = this._composePage(pageIndex, pageData);
				this._onPageData?.(pageIndex, this.pages[pageIndex], {
					semanticChanged: false,
				});
				return this.pages[pageIndex];
			};

			(async () => {
				let annotationsResult = await annotationsPromise;
				if (!isCurrent()) {
					return;
				}
				if (annotationsResult.status === 'rejected') {
					console.warn(
						`Failed to load PDF link annotations for page ${pageIndex + 1}`,
						annotationsResult.reason
					);
				}
				let overlays = annotationsResult.status === 'fulfilled'
					? await buildAnnotationLinkOverlays(
						annotationsResult.value,
						pageIndex,
						this._resolveDestination
					)
					: [];
				if (isCurrent()) {
					publish({ overlays });
				}
			})().catch((error) => {
				if (isCurrent()) {
					console.warn(
						`Failed to prepare PDF link annotations for page ${pageIndex + 1}`,
						error
					);
					publish({ overlays: [] });
				}
			});

			let pageDataResult = await pageDataPromise;
			if (!isCurrent()) {
				return null;
			}
			if (pageDataResult.status === 'rejected') {
				console.warn(
					`Failed to load PDF page data for page ${pageIndex + 1}`,
					pageDataResult.reason
				);
			}
			let rawPageData = pageDataResult.status === 'fulfilled'
				? pageDataResult.value
				: null;
			return publish({
				chars: Array.isArray(rawPageData?.chars) ? rawPageData.chars : [],
				viewBox: Array.isArray(rawPageData?.viewBox) ? rawPageData.viewBox : pdfPage.view,
			});
		})();
		this._pagePromises.set(pageIndex, promise);
		try {
			let pageData = await promise;
			if (pageData) {
				this.ensureSemanticPage(pageIndex);
			}
			return pageData;
		}
		finally {
			if (this._pagePromises.get(pageIndex) === promise) {
				this._pagePromises.delete(pageIndex);
			}
		}
	}

	releasePage(pageIndex) {
		this._pageRevisions.set(pageIndex, (this._pageRevisions.get(pageIndex) || 0) + 1);
		this._pagePromises.delete(pageIndex);
		this._cancelSemanticEntry(pageIndex);
		this._pageValidation.delete(pageIndex);
		delete this._basicPages[pageIndex];
		delete this._semanticPages[pageIndex];
		delete this.pages[pageIndex];
	}

	setSemanticDocument(document) {
		if (!document
				|| typeof document.composePage !== 'function'
				|| !Array.isArray(document.pageLabels)
				|| document.pageLabels.length !== document.pageCount
				|| !Array.isArray(document.outline)
				|| (this._pdfDocument && document.pageCount !== this._pdfDocument.numPages)) {
			throw new Error('SDT document does not match PDF view');
		}
		this._cancelOutline();
		this._resetSemanticPages();
		this._semanticDocument = document;
		this._onMetadata?.({
			pageLabels: document.pageLabels,
			outline: document.outline,
		});
		if (this._outlineActive) {
			this._resolveOutline();
		}
		for (let pageIndex of Object.keys(this._basicPages).map(Number)) {
			this.ensureSemanticPage(pageIndex);
		}
	}

	async ensureSemanticPage(pageIndex) {
		if (this._destroyed
				|| !this._semanticDocument
				|| !this._basicPages[pageIndex]) {
			return null;
		}
		if (this._semanticPages[pageIndex]) {
			return this._semanticPages[pageIndex];
		}
		let existing = this._semanticEntries.get(pageIndex);
		if (existing) {
			return existing.promise;
		}
		let expectedDocument = this._getExpectedDocument(pageIndex);
		if (!expectedDocument) {
			return null;
		}

		let resolve;
		let promise = new Promise(res => resolve = res);
		let entry = {
			pageIndex,
			document: this._semanticDocument,
			revision: this._semanticRevision,
			expectedDocument,
			controller: null,
			resolve,
			promise,
		};
		this._semanticEntries.set(pageIndex, entry);
		this._semanticQueue.add(entry);
		this._drainSemanticQueue();
		return promise;
	}

	setOutlineActive(active) {
		this._outlineActive = !!active;
		if (!this._outlineActive) {
			this._cancelOutline();
			return;
		}
		this._resolveOutline();
	}

	getValidation() {
		if (this._destroyed
				|| !this._pdfDocument
				|| this._documentValidation?.pageCount !== this._pdfDocument.numPages) {
			return null;
		}
		return {
			pageCount: this._documentValidation.pageCount,
			pages: [...this._pageValidation.values()],
		};
	}

	destroy() {
		if (this._destroyed) {
			return;
		}
		this._destroyed = true;
		this._cancelOutline();
		this._resetSemanticPages();
		this._pagePromises.clear();
		this._resolveFirstPageReady?.(null);
		this._resolveFirstPageReady = null;
	}

	_composePage(pageIndex, pageData) {
		let semanticPage = this._semanticPages[pageIndex];
		if (!semanticPage) {
			return pageData;
		}
		return this._semanticDocument.composePage(
			pageData,
			semanticPage,
			this._semanticRevision
		);
	}

	_isPageCurrent(pageIndex, revision) {
		return !this._destroyed
			&& this._pdfDocument
			&& (this._pageRevisions.get(pageIndex) || 0) === revision;
	}

	_getExpectedDocument(pageIndex) {
		let page = this._pageValidation.get(pageIndex);
		return page && this._documentValidation
			? { pageCount: this._documentValidation.pageCount, pages: [page] }
			: null;
	}

	_drainSemanticQueue() {
		while (this._activePageProjections < MAX_CONCURRENT_PAGE_PROJECTIONS
				&& this._semanticQueue.size) {
			let entry = this._semanticQueue.values().next().value;
			this._semanticQueue.delete(entry);
			if (!this._isSemanticEntryCurrent(entry)) {
				entry.resolve(null);
				continue;
			}
			entry.controller = new AbortController();
			this._activePageProjections++;
			this._runSemanticEntry(entry);
		}
	}

	async _runSemanticEntry(entry) {
		let semanticPage = null;
		try {
			semanticPage = await entry.document.projectPage(
				entry.pageIndex,
				entry.expectedDocument,
				{ signal: entry.controller.signal }
			);
			if (semanticPage) {
				while (this._isSemanticEntryCurrent(entry)
						&& this._isInteractionActive()) {
					await new Promise(resolve => setTimeout(resolve, 16));
				}
			}
			if (semanticPage && this._isSemanticEntryCurrent(entry)) {
				this._semanticPages[entry.pageIndex] = semanticPage;
				this.pages[entry.pageIndex] = this._composePage(
					entry.pageIndex,
					this._basicPages[entry.pageIndex]
				);
				this._onPageData?.(entry.pageIndex, this.pages[entry.pageIndex], {
					semanticChanged: true,
				});
			}
		}
		catch (error) {
			if (error.name !== 'AbortError' && this._isSemanticEntryCurrent(entry)) {
				console.warn(
					`Failed to project PDF SDT page ${entry.pageIndex + 1}`,
					error
				);
			}
		}
		finally {
			this._activePageProjections--;
			if (this._semanticEntries.get(entry.pageIndex) === entry) {
				this._semanticEntries.delete(entry.pageIndex);
			}
			entry.resolve(semanticPage);
			this._drainSemanticQueue();
		}
	}

	_isSemanticEntryCurrent(entry) {
		return !this._destroyed
			&& entry.document === this._semanticDocument
			&& entry.revision === this._semanticRevision
			&& this._semanticEntries.get(entry.pageIndex) === entry
			&& !!this._basicPages[entry.pageIndex];
	}

	_cancelSemanticEntry(pageIndex) {
		let entry = this._semanticEntries.get(pageIndex);
		if (!entry) {
			return;
		}
		this._semanticEntries.delete(pageIndex);
		this._semanticQueue.delete(entry);
		entry.controller?.abort();
		entry.resolve(null);
	}

	_resetSemanticPages() {
		this._semanticRevision++;
		for (let entry of this._semanticEntries.values()) {
			entry.controller?.abort();
			entry.resolve(null);
		}
		this._semanticEntries.clear();
		this._semanticQueue.clear();
		this._semanticPages = {};
	}

	async _loadNativePageLabels() {
		let pdfDocument = this._pdfDocument;
		let pageLabels;
		try {
			pageLabels = await pdfDocument.getPageLabels();
		}
		catch (error) {
			console.warn('Failed to load native PDF page labels', error);
		}
		if (this._destroyed || pdfDocument !== this._pdfDocument) {
			return;
		}
		this._nativePageLabels = Array.isArray(pageLabels)
				&& pageLabels.length === pdfDocument.numPages
			? pageLabels
			: Array.from({ length: pdfDocument.numPages }, (_, index) => String(index + 1));
		this._onMetadata?.({
			pageLabels: this._semanticDocument?.pageLabels ?? this._nativePageLabels,
		});
	}

	_resolveOutline() {
		if (!this._outlineActive || this._destroyed || !this._pdfDocument) {
			return null;
		}
		if (this._semanticDocument?.resolveOutline) {
			return this._resolveSemanticOutline(this._semanticDocument);
		}
		if (this._nativeOutline !== null) {
			this._onMetadata?.({ outline: this._nativeOutline });
			return Promise.resolve(this._nativeOutline);
		}
		return this._resolveNativeOutline();
	}

	_resolveSemanticOutline(document) {
		if (this._outlinePromise) {
			return this._outlinePromise;
		}
		this._cancelOutline();
		let controller = new AbortController();
		let promise = document.resolveOutline({ signal: controller.signal })
			.then((outline) => {
				if (this._outlineActive
						&& !this._destroyed
						&& this._semanticDocument === document) {
					this._onMetadata?.({ outline });
				}
				return outline;
			})
			.catch((error) => {
				if (error.name !== 'AbortError'
						&& !this._destroyed
						&& this._semanticDocument === document) {
					console.warn('Failed to resolve PDF SDT outline', error);
				}
				return null;
			})
			.finally(() => this._finishOutlineRequest(promise, controller));
		this._outlineAbortController = controller;
		this._outlinePromise = promise;
		return promise;
	}

	_resolveNativeOutline() {
		if (this._outlinePromise) {
			return this._outlinePromise;
		}
		let pdfDocument = this._pdfDocument;
		let controller = new AbortController();
		let promise = pdfDocument.getOutline()
			.then(outline => this._transformNativeOutline(outline || [], controller.signal))
			.then((outline) => {
				if (controller.signal.aborted
						|| this._destroyed
						|| pdfDocument !== this._pdfDocument) {
					return null;
				}
				this._nativeOutline = outline;
				if (!this._semanticDocument && this._outlineActive) {
					this._onMetadata?.({ outline });
				}
				return outline;
			})
			.catch((error) => {
				if (error.name !== 'AbortError' && !this._destroyed) {
					console.warn('Failed to load native PDF outline', error);
				}
				return null;
			})
			.finally(() => this._finishOutlineRequest(promise, controller));
		this._outlineAbortController = controller;
		this._outlinePromise = promise;
		return promise;
	}

	async _transformNativeOutline(items, signal) {
		let outline = [];
		for (let item of items) {
			if (signal.aborted) {
				let error = new Error('Outline resolution aborted');
				error.name = 'AbortError';
				throw error;
			}
			let newItem = {
				title: item.title,
				items: await this._transformNativeOutline(item.items || [], signal),
			};
			if (item.dest) {
				try {
					let position = await this._resolveDestination(item.dest);
					if (position) {
						newItem.location = { position };
					}
				}
				catch (error) {
					if (error.name === 'AbortError') {
						throw error;
					}
					console.warn('Failed to resolve PDF outline destination', error);
				}
			}
			else if (item.unsafeUrl) {
				// Preserve the link value previously returned by the PDF.js
				// document-worker outline implementation.
				newItem.url = item.unsafeUrl;
			}
			outline.push(newItem);
		}
		return outline.length === 1 && outline[0].items.length > 1
			? outline[0].items
			: outline;
	}

	_finishOutlineRequest(promise, controller) {
		if (this._outlinePromise === promise) {
			this._outlinePromise = null;
		}
		if (this._outlineAbortController === controller) {
			this._outlineAbortController = null;
		}
	}

	_cancelOutline() {
		this._outlineAbortController?.abort();
		this._outlineAbortController = null;
		this._outlinePromise = null;
	}
}
