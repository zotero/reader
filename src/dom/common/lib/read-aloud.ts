import {
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
	 * Map from base-view block elements to their paragraph-start segment.
	 * Built once when segments change; used by the jump button.
	 * An empty map means "built successfully, no blocks resolved" (prevents re-trigger).
	 * Null means "never built" or "segments cleared".
	 */
	blockSegmentMap: Map<Element, ReadAloudSegment> | null = null;

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

		// Rebuild block -> segment map when segments change,
		// or when the view just became ready (map was null because DOM wasn't available)
		if (state.segments !== previousState?.segments) {
			this._buildBlockSegmentMap(state.segments);
		}
		else if (state.segments && !this.blockSegmentMap) {
			this._buildBlockSegmentMap(state.segments);
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

			// Navigate first so the section is mounted (important for EPUB),
			// then set spotlights
			if (!state.annotationPopup && this.positionLocked) {
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

			// Now that the section is mounted, resolve and set spotlights
			let paragraphSelector = this._resolveParagraphSelector(state);
			this._view.setSpotlight(SpotlightKey.ReadAloudActiveSegment, paragraphSelector, null);

			if (state.lastSkipGranularity === 'sentence' && state.activeSegment) {
				this._view.setSpotlight(SpotlightKey.ReadAloudActiveSentence, segmentSelector, 2000);
			}
			else {
				this._view.setSpotlight(SpotlightKey.ReadAloudActiveSentence, null);
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

	private _collapseToStart(selector: Selector): Selector | null {
		let range = this._view.toDisplayedRange(selector);
		if (!range) return null;
		range.collapse(true);
		return this._view.toSelector(range);
	}

	private _resolveActiveSegmentRange(state: ReadAloudStateSnapshot): Range | null {
		let selector = this._resolveSegmentSelector(state);
		if (!selector) return null;
		return this._view.toDisplayedRange(selector);
	}

	/**
	 * Build a map from base-view block elements to their paragraph-start segment.
	 * Each segment's containing block is mapped to the paragraph's start segment,
	 * so the jump button works even when a paragraph spans multiple sub-blocks.
	 */
	private _buildBlockSegmentMap(segments: ReadAloudSegment[] | null) {
		this.blockSegmentMap = null;
		if (!segments) return;

		let map = new Map<Element, ReadAloudSegment>();
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
			if (block && !map.has(block)) {
				map.set(block, currentParagraphStart);
			}
		}
		// Always set a Map (even empty) so we don't re-trigger on every setState
		this.blockSegmentMap = map;
	}
}
