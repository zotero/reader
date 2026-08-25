import { FindState, PDFFindController } from './pdf-find-controller.js';
import { getSelectionRanges, getSortIndex } from './selection.js';
import { PDFSearchSession } from './search-session.mjs';

/** Owns one PDF view's native or semantic find session. */
export class PDFSearchController {
	constructor({
		initialState,
		pages,
		ensurePage,
		getPageLabel,
		getCurrentPageIndex,
		onState,
		onNavigate,
		onChange,
		onPrepareSDT,
		getSource,
	} = {}) {
		this._state = initialState;
		this._pages = pages;
		this._ensurePage = ensurePage;
		this._getPageLabel = getPageLabel;
		this._getCurrentPageIndex = getCurrentPageIndex;
		this._onState = onState;
		this._onNavigate = onNavigate;
		this._onChange = onChange;
		this._onPrepareSDT = onPrepareSDT;
		this._getSource = getSource;
		this._sessions = new PDFSearchSession();
		this._pdfController = null;
		this._pdfFindState = null;
		this._pendingPDFStart = null;
		this._sdtAbortController = null;
		this._sdtResults = [];
		this._sdtResultsByPage = new Map();
		this._sdtIndex = null;
		this._revision = 0;
		this._destroyed = false;
	}

	get state() {
		return this._state;
	}

	get revision() {
		return this._revision;
	}

	initializePDF(linkService) {
		if (this._destroyed || this._pdfController) {
			return;
		}
		this._pdfController = new PDFFindController({
			linkService,
			onNavigate: (pageIndex, matchIndex) => this._navigatePDFMatch(pageIndex, matchIndex),
			onUpdateMatches: ({ matchesCount }) => {
				this._handlePDFUpdate(
					matchesCount,
					this._pdfController.state?._readerGeneration
				);
			},
			onUpdateState: ({ matchesCount, state, rawQuery }) => {
				this._pdfFindState = state;
				this._handlePDFUpdate(
					matchesCount,
					this._pdfController.state?._readerGeneration,
					rawQuery
				);
			},
		});
		let pending = this._pendingPDFStart;
		this._pendingPDFStart = null;
		if (pending && this._sessions.isCurrent(pending.session)) {
			this._startPDF(pending.session, pending.state);
		}
	}

	setDocument(pdfDocument) {
		this._pdfController?.setDocument(pdfDocument);
		if (this._state.active && !this._sessions.current) {
			this.setState(this._state);
		}
	}

	setEligibleSDT(sdt) {
		this._sessions.setEligibleSDT(sdt);
	}

	setState(state) {
		if (this._destroyed) {
			return;
		}
		let previousState = this._state;
		let previousBackend = this._sessions.current?.backend;
		let transition = this._sessions.transition(state);
		this._state = state;

		if (transition.type === 'close') {
			this._retireBackend(previousBackend);
			this._publish(state);
			return;
		}
		if (transition.type === 'start') {
			this._onPrepareSDT?.();
			this._retireBackend(previousBackend, transition.session.backend);
			if (transition.session.backend === 'sdt') {
				this._startSDT(transition.session, state);
			}
			else {
				this._startPDF(transition.session, state);
			}
			return;
		}
		if (!transition.session) {
			return;
		}
		if (state.result === undefined && previousState?.result) {
			this._publish({ ...state, result: previousState.result });
		}

		if (previousState?.highlightAll !== state.highlightAll) {
			if (transition.session.backend === 'pdf') {
				if (this._pdfController) {
					this._pdfController.find(this._getPDFParams(
						transition.session,
						'highlightallchange'
					));
				}
				else {
					this._pendingPDFStart = { session: transition.session, state };
				}
			}
			else {
				this._publishSDTResult(transition.session);
			}
			this._onChange?.();
		}
		if (transition.session.backend === 'sdt'
				&& state.index !== null
				&& previousState?.index !== state.index) {
			this._setSDTIndex(transition.session, state.index, true);
		}
	}

	next() {
		let session = this._sessions.current;
		if (!session || !this._state.active) {
			return;
		}
		if (session.backend === 'sdt') {
			this._setSDTIndex(session, (this._sdtIndex ?? -1) + 1, true);
			return;
		}
		this._pdfController?.find({
			...this._getPDFParams(session, 'again'),
			findPrevious: false,
		});
	}

	previous() {
		let session = this._sessions.current;
		if (!session || !this._state.active) {
			return;
		}
		if (session.backend === 'sdt') {
			this._setSDTIndex(session, (this._sdtIndex ?? 0) - 1, true);
			return;
		}
		this._pdfController?.find({
			...this._getPDFParams(session, 'again'),
			source: this._getSource?.(),
			findPrevious: true,
		});
	}

	getResultsForPage(pageIndex) {
		if (!this._state.active) {
			return [];
		}
		let backend = this._sessions.current?.backend;
		if (backend === 'sdt') {
			return (this._sdtResultsByPage.get(pageIndex) || []).flatMap((entry) => {
				let current = entry.index === this._sdtIndex;
				return current || this._state.highlightAll
					? [{ position: entry.position, current }]
					: [];
			});
		}
		let pageData = this._pages[pageIndex];
		if (backend !== 'pdf'
				|| !this._pdfController?.highlightMatches
				|| !this._pdfController._matchesCountTotal
				|| !pageData) {
			return [];
		}
		let positions = this._pdfController.getMatchPositions(pageIndex, pageData);
		return (positions || []).flatMap((position, index) => {
			let current = this._pdfController.selected.pageIdx === pageIndex
				&& index === this._pdfController.selected.matchIdx;
			return current || this._pdfController.state.highlightAll
				? [{ position, current }]
				: [];
		});
	}

	isRevisionCurrent(revision) {
		return !this._destroyed && revision === this._revision;
	}

	destroy() {
		if (this._destroyed) {
			return;
		}
		this._destroyed = true;
		this._retireBackend(this._sessions.current?.backend);
		this._sessions.destroy();
	}

	async _navigatePDFMatch(pageIndex, matchIndex) {
		let generation = this._pdfController.state?._readerGeneration;
		let session = this._sessions.current;
		if (session?.backend !== 'pdf' || session.generation !== generation) {
			return;
		}
		let pageData = await this._ensurePage(pageIndex);
		let positions = pageData
			? this._pdfController.getMatchPositions(pageIndex, pageData)
			: [];
		let selected = this._pdfController.selected;
		if (this._sessions.isCurrent(session)
				&& selected.pageIdx === pageIndex
				&& selected.matchIdx === matchIndex
				&& positions[matchIndex]) {
			this._onNavigate?.(positions[matchIndex]);
		}
	}

	async _handlePDFUpdate(matchesCount, generation, rawQuery = this._state.query) {
		let session = this._sessions.current;
		if (session?.backend !== 'pdf'
				|| session.generation !== generation
				|| this._destroyed) {
			return;
		}
		let revision = ++this._revision;
		if (this._pdfFindState === FindState.PENDING || !rawQuery?.length) {
			this._publish({ ...this._state, result: null });
			return;
		}
		let result = {
			total: matchesCount.total,
			index: matchesCount.current - 1,
			snippets: matchesCount.snippets,
		};
		if (matchesCount.current) {
			await this._ensurePage(matchesCount.currentPageIndex);
			if (!this._sessions.isCurrent(session)
					|| revision !== this._revision
					|| this._destroyed) {
				return;
			}
			let selectionRanges = getSelectionRanges(
				this._pages,
				{ pageIndex: matchesCount.currentPageIndex, offset: matchesCount.currentOffsetStart },
				{ pageIndex: matchesCount.currentPageIndex, offset: matchesCount.currentOffsetEnd + 1 }
			);
			let annotation = createAnnotation(selectionRanges, this._getPageLabel);
			if (annotation) {
				result = {
					...result,
					annotation,
					currentPageLabel: annotation.pageLabel,
					currentSnippet: result.snippets[matchesCount.current - 1],
				};
			}
		}
		this._publish({ ...this._state, result });
	}

	_startPDF(session, state) {
		if (!this._pdfController) {
			this._pendingPDFStart = { session, state };
			return;
		}
		this._pdfController.find({
			...this._getPDFParams(session, 'find'),
			query: state.query,
			caseSensitive: state.caseSensitive,
			entireWord: state.entireWord,
			highlightAll: state.highlightAll,
		});
	}

	_getPDFParams(session, type) {
		return {
			type,
			query: this._state.query,
			phraseSearch: true,
			caseSensitive: this._state.caseSensitive,
			entireWord: this._state.entireWord,
			highlightAll: this._state.highlightAll,
			findPrevious: false,
			_readerGeneration: session.generation,
		};
	}

	async _startSDT(session, state) {
		let abortController = new AbortController();
		this._sdtAbortController = abortController;
		this._sdtResults = [];
		this._sdtResultsByPage = new Map();
		this._sdtIndex = null;
		this._publish({ ...state, result: null });
		try {
			let results;
			try {
				results = await session.sdt.searchIndex.search(state.query, {
					caseSensitive: state.caseSensitive,
					entireWord: state.entireWord,
					signal: abortController.signal,
					mapResult: result => this._mapSDTResult(session, abortController, result),
				});
			}
			finally {
				session.sdt.mapper.clearCache();
			}
			if (!this._sessions.isCurrent(session) || abortController.signal.aborted) {
				return;
			}
			this._sdtResults = results;
			this._indexSDTResults(results);
			this._sdtIndex = this._getInitialSDTIndex(results);
			await this._publishSDTResult(session, true);
		}
		catch (error) {
			if (error.name !== 'AbortError' && this._sessions.isCurrent(session)) {
				console.warn('Failed to search SDT', error);
				let fallback = this._sessions.fallbackToPDF(session);
				if (fallback) {
					this._retireBackend('sdt', 'pdf');
					this._startPDF(fallback, this._state);
				}
			}
		}
	}

	_mapSDTResult(session, abortController, result) {
		if (abortController.signal.aborted || !this._sessions.isCurrent(session)) {
			let error = new Error('Search cancelled');
			error.name = 'AbortError';
			throw error;
		}
		let sourcePosition = session.sdt.mapper.textNodeSpansToSourcePosition(result.spans);
		if (!sourcePosition) {
			return null;
		}
		return {
			sourcePosition,
			text: result.text,
			snippet: result.snippet,
		};
	}

	_getInitialSDTIndex(results) {
		if (!results.length) {
			return null;
		}
		let pageIndex = this._getCurrentPageIndex?.() ?? 0;
		let index = results.findIndex(result => result.sourcePosition.pageIndex >= pageIndex);
		return index >= 0 ? index : 0;
	}

	_indexSDTResults(results) {
		let byPage = new Map();
		let add = (pageIndex, index, rects) => {
			if (!rects?.length) {
				return;
			}
			let entries = byPage.get(pageIndex) || [];
			if (!byPage.has(pageIndex)) {
				byPage.set(pageIndex, entries);
			}
			entries.push({ index, position: { pageIndex, rects } });
		};
		for (let i = 0; i < results.length; i++) {
			let position = results[i].sourcePosition;
			add(position.pageIndex, i, position.rects);
			add(position.pageIndex + 1, i, position.nextPageRects);
		}
		this._sdtResultsByPage = byPage;
	}

	async _publishSDTResult(session, navigate = false) {
		if (!this._sessions.isCurrent(session)) {
			return;
		}
		let revision = ++this._revision;
		let current = this._sdtIndex === null ? null : this._sdtResults[this._sdtIndex] ?? null;
		let result = {
			total: this._sdtResults.length,
			index: this._sdtIndex ?? 0,
			snippets: this._sdtResults.map(item => item.snippet),
			currentSnippet: current?.snippet ?? '',
			currentPageLabel: null,
		};
		if (current) {
			await this._ensurePage(current.sourcePosition.pageIndex);
			if (!this._sessions.isCurrent(session) || revision !== this._revision) {
				return;
			}
			let pageLabel = this._getPageLabel(current.sourcePosition.pageIndex, true);
			result = {
				...result,
				annotation: {
					type: 'highlight',
					sortIndex: getSortIndex(this._pages, current.sourcePosition),
					pageLabel,
					position: current.sourcePosition,
					text: current.text,
				},
				currentPageLabel: pageLabel,
			};
		}
		this._publish({ ...this._state, result });
		if (navigate && current) {
			this._onNavigate?.(current.sourcePosition);
		}
	}

	_setSDTIndex(session, index, navigate) {
		let count = this._sdtResults.length;
		if (!count || !Number.isInteger(index)) {
			return;
		}
		this._sdtIndex = (index % count + count) % count;
		this._publishSDTResult(session, navigate);
	}

	_retireBackend(backend, nextBackend = null) {
		this._revision++;
		this._sdtAbortController?.abort();
		this._sdtAbortController = null;
		this._sdtResults = [];
		this._sdtResultsByPage = new Map();
		this._sdtIndex = null;
		this._pendingPDFStart = null;
		if (backend === 'pdf' && nextBackend !== 'pdf') {
			this._pdfController?.onClose();
		}
	}

	_publish(state) {
		this._state = state;
		this._onState?.(state);
		this._onChange?.();
	}
}

function createAnnotation(selectionRanges, getPageLabel) {
	if (!selectionRanges.length || selectionRanges[0].collapsed) {
		return null;
	}
	selectionRanges = selectionRanges.slice().sort((a, b) => a.pageIndex - b.pageIndex).slice(0, 2);
	let first = selectionRanges[0];
	let annotation = {
		type: 'highlight',
		sortIndex: first.sortIndex,
		pageLabel: getPageLabel(first.position.pageIndex, true),
		position: first.position,
		text: first.text,
	};
	if (selectionRanges.length === 2) {
		annotation.position.nextPageRects = selectionRanges[1].position.rects;
		annotation.text += ' ' + selectionRanges[1].text;
	}
	return annotation;
}
