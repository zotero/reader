import {
	ReadAloudGranularity,
	ReadAloudSegment,
	ReadAloudStateSnapshot,
	ReadAloudStateDelta,
	Position,
} from "../../../common/types";
import { isSelector, Selector } from "./selector";
import DOMView, { SpotlightKey } from "../dom-view";
import { getBoundingPageRect } from "./range";
import { isPageRectVisible } from "./rect";
import { closestElement } from "./nodes";
import { debounceUntilScrollFinishes } from "../../../common/lib/utilities";
import { getBaseLanguage } from '../../../common/read-aloud/lang';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ReadAloud<View extends DOMView<any, any>> {
	state: ReadAloudStateSnapshot | null = null;

	positionLocked = true;

	scrolling = false;

	/**
	 * Cache from base-view block elements to their paragraph-start segment,
	 * used by the jump button. Populated lazily by getSegmentForBlock(),
	 * and invalidated when segments change.
	 */
	private _blockSegmentCache = new Map<Element, ReadAloudSegment | null>();

	private _lastCachedSegments: ReadAloudSegment[] | null = null;

	private _view: View;

	constructor(view: View) {
		this._view = view;
	}

	setState(state: ReadAloudStateSnapshot): ReadAloudStateDelta | null {
		let previousState = this.state;
		this.state = state;

		// Initialize lock state when Read Aloud starts
		if (state.active && !previousState?.active) {
			this.positionLocked = true;
		}

		if (!this._view.initialized) {
			return null;
		}

		if (!state.popupOpen) {
			this._view.setSpotlight(SpotlightKey.ReadAloudActiveSegment, null);
			this._view.setSpotlight(SpotlightKey.ReadAloudActiveSentence, null);
			return null;
		}

		// After resuming playback, re-lock position if the current segment is visible
		if (state.active && previousState?.paused && !state.paused) {
			let range = this._resolveActiveSegmentRange(state);
			if (range && isPageRectVisible(getBoundingPageRect(range), this._view.iframeWindow)) {
				this.positionLocked = true;
			}
		}

		// Highlight and scroll to active segment
		if (state.activeSegment?.position) {
			let segmentSelector = this._resolveSegmentSelector(state);
			if (!segmentSelector) return null;

			let segmentChanged = state.activeSegment !== previousState?.activeSegment;

			// Navigate first so the section is mounted (important for EPUB),
			// then set spotlights
			if (segmentChanged && !state.annotationPopup && this.positionLocked) {
				this.scrolling = true;

				let startSelector = this._collapseToStart(segmentSelector);
				this._view.navigateToSelector(startSelector || segmentSelector, {
					ifNeeded: true,
					visibilityMargin: -this._view.iframeWindow.innerHeight / 4,
					block: 'center',
					behavior: 'smooth'
				});

				debounceUntilScrollFinishes(this._view.iframeDocument).then(() => {
					this.scrolling = false;
				});
			}

			// The primary highlight tracks the user's chosen granularity; it falls
			// back to a coarser level when finer-grained data isn't available
			// (e.g. paragraph-granularity segments have no sentence/word data)
			let primarySelector = this._resolvePrimarySelector(state, segmentSelector);
			this._view.setSpotlight(SpotlightKey.ReadAloudActiveSegment, primarySelector, null);

			// After a skip whose granularity differs from the primary highlight,
			// briefly flash the unit at the skip granularity so it's clear what
			// the skip moved by. Only retrigger when the active segment changes
			// so word-level updates don't keep resetting the spotlight.
			if (segmentChanged) {
				let spotlightSelector = this._resolveSkipSpotlightSelector(state, segmentSelector);
				this._view.setSpotlight(
					SpotlightKey.ReadAloudActiveSentence,
					spotlightSelector,
					spotlightSelector ? 2000 : null,
				);
			}
		}

		if (!state.lang && this._view.lang) {
			return {
				lang: getBaseLanguage(this._view.lang),
			};
		}

		return null;
	}

	setPositionLocked(locked: boolean) {
		if (this.state?.active) {
			this.positionLocked = locked;
		}
	}

	get hasTarget(): boolean {
		return !!this._view.iframeDocument.getSelection() && !this._view.iframeDocument.getSelection()!.isCollapsed;
	}

	private _positionToSelector(position: Position | null | undefined): Selector | null {
		if (!position) return null;

		if (isSelector(position)) {
			return position as Selector;
		}

		// SDTPosition or other non-Selector: try resolving through the view
		let range = this._view.toDisplayedRange(position);
		if (range) {
			return this._view.toSelector(range);
		}

		return null;
	}

	private _resolveSegmentSelector(state: ReadAloudStateSnapshot): Selector | null {
		let seg = state.activeSegment;
		if (!seg) return null;
		// Prefer source position (works in base views), fall back to SDT position (works in SDTView)
		return this._positionToSelector(seg.sourcePosition)
			|| this._positionToSelector(seg.position);
	}

	private _resolveParagraphSelector(state: ReadAloudStateSnapshot): Selector | null {
		let seg = state.activeSegment;
		if (!seg) return null;
		return this._positionToSelector(seg.paragraphSourcePosition);
	}

	/**
	 * Resolve the primary highlight for the user's chosen granularity. Falls
	 * back coarser when finer-grained data isn't available (e.g. the segment
	 * is a paragraph because the voice supplies paragraph-granularity audio).
	 */
	private _resolvePrimarySelector(
		state: ReadAloudStateSnapshot,
		segmentSelector: Selector,
	): Selector | null {
		switch (this._effectivePrimaryGranularity(state)) {
			case 'word':
				return this._positionToSelector(state.activeWordSourcePosition);
			case 'sentence':
				return segmentSelector;
			case 'paragraph':
			default:
				return this._resolveParagraphSelector(state);
		}
	}

	/**
	 * Resolve the brief flash highlight that should appear after a skip
	 * whose granularity isn't already shown by the primary highlight.
	 * Returns null when the skip granularity matches the primary, or there's
	 * no recent skip to acknowledge.
	 */
	private _resolveSkipSpotlightSelector(
		state: ReadAloudStateSnapshot,
		segmentSelector: Selector,
	): Selector | null {
		if (!state.lastSkipGranularity || !state.activeSegment) {
			return null;
		}
		if (state.lastSkipGranularity === this._effectivePrimaryGranularity(state)) {
			return null;
		}
		switch (state.lastSkipGranularity) {
			case 'sentence':
				return segmentSelector;
			case 'paragraph':
				return this._resolveParagraphSelector(state);
			default:
				return null;
		}
	}

	private _effectivePrimaryGranularity(state: ReadAloudStateSnapshot): ReadAloudGranularity {
		if (state.highlightGranularity === 'word' && state.segmentGranularity === 'sentence') {
			return 'word';
		}
		if (state.highlightGranularity === 'sentence' && state.segmentGranularity === 'sentence') {
			return 'sentence';
		}
		return 'paragraph';
	}

	private _collapseToStart(selector: Selector): Selector | null {
		let range = this._view.toDisplayedRange(selector);
		if (!range) return null;
		range.collapse(true);
		// A start that falls in unrendered content (e.g. collapsed whitespace)
		// has no rects and can't be navigated to; let the caller fall back to
		// the full range
		if (!range.getClientRects().length) return null;
		return this._view.toSelector(range);
	}

	private _resolveActiveSegmentRange(state: ReadAloudStateSnapshot): Range | null {
		let selector = this._resolveSegmentSelector(state);
		if (!selector) return null;
		return this._view.toDisplayedRange(selector);
	}

	/**
	 * Resolve the paragraph-start segment for a hovered block, or null if the
	 * block doesn't contain any read-aloud text. Used by the jump button.
	 *
	 * The cache is populated lazily by scanning all segments on a miss, so
	 * blocks become resolvable as sections mount, without needing the host
	 * view to invalidate anything explicitly.
	 */
	getSegmentForBlock(block: Element): ReadAloudSegment | null {
		// Drop stale entries when the segment list itself changes (e.g.,
		// segmentGranularity changed). Section mounts don't change the list,
		// just which positions can resolve.
		if (this.state?.segments !== this._lastCachedSegments) {
			this._blockSegmentCache = new Map();
			this._lastCachedSegments = this.state?.segments ?? null;
		}
		if (this._blockSegmentCache.has(block)) {
			return this._blockSegmentCache.get(block) ?? null;
		}
		this._populateBlockSegmentCache();
		// If population didn't add this block, mark it as a known miss so we
		// don't re-scan on every subsequent hover of the same non-segment block.
		if (!this._blockSegmentCache.has(block)) {
			this._blockSegmentCache.set(block, null);
		}
		return this._blockSegmentCache.get(block) ?? null;
	}

	/**
	 * Walk the segment list once and add any newly resolvable blocks to the
	 * cache. Each leaf block is mapped to its paragraph's first segment, so
	 * the jump button still works when a paragraph spans multiple sub-blocks.
	 */
	private _populateBlockSegmentCache() {
		let segments = this.state?.segments;
		if (!segments) return;

		let currentParagraphStart: ReadAloudSegment | null = null;
		for (let s of segments) {
			if (s.anchor === 'paragraphStart') {
				currentParagraphStart = s;
			}
			if (!currentParagraphStart) continue;

			let pos = s.sourcePosition ?? s.position;
			let selector = this._positionToSelector(pos);
			if (!selector) continue;
			let range = this._view.toDisplayedRange(selector);
			if (!range) continue;
			let el = closestElement(range.startContainer);
			if (!el) continue;
			let block = this._view.getReadAloudBlock(el);
			if (block && !this._blockSegmentCache.has(block)) {
				this._blockSegmentCache.set(block, currentParagraphStart);
			}
		}
	}
}
