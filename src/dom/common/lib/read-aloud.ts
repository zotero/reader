import {
	NewAnnotation,
	ReadAloudGranularity,
	ReadAloudSegment,
	ReadAloudState,
	RangeRef,
	WADMAnnotation,
} from "../../../common/types";
import { exceedsSegmentMaxLength, splitTextToChunks } from "../../../common/read-aloud/segment-split";
import { Selector } from "./selector";
import DOMView, { SpotlightKey } from "../dom-view";
import {
	createRangeWalker, getBoundingPageRect,
	makeRangeSpanning,
	PersistentRange, splitRanges,
	splitRangeToSentences,
	splitRangeToTextNodes,
} from "./range";
import {
	isPageRectFullyVisible,
	isPageRectVisible,
	isErrorRect,
} from "./rect";
import { getContainingBlock, closestElement, iterateWalker } from "./nodes";
import { debounceUntilScrollFinishes } from "../../../common/lib/utilities";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ReadAloud<View extends DOMView<any, any>> {
	state: ReadAloudState | null = null;

	positionLocked = true;

	scrolling = false;

	private _view: View;

	constructor(view: View) {
		this._view = view;
	}

	setState(state: ReadAloudState): ReadAloudState | null {
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
			return null;
		}

		// After resuming playback, re-lock position if the current segment is visible
		if (state.active && previousState?.paused && !state.paused && state.activeSegment?.position) {
			let { range } = state.activeSegment.position as RangeRef;
			if (isPageRectVisible(getBoundingPageRect(range), this._view.iframeWindow)) {
				this.positionLocked = true;
			}
		}

		if (state.activeSegment?.position) {
			let { range } = state.activeSegment.position as RangeRef;
			let segments = state.segments!;
			// Highlight the whole paragraph
			let firstRangeInParagraph: PersistentRange | null = null;
			for (let i = segments.indexOf(state.activeSegment); i >= 0; i--) {
				firstRangeInParagraph = (segments[i].position as RangeRef).range;
				if (segments[i].anchor === 'paragraphStart') {
					break;
				}
			}
			let lastRangeInParagraph: PersistentRange | null = null;
			for (let i = segments.indexOf(state.activeSegment) + 1; i < segments.length; i++) {
				if (segments[i].anchor === 'paragraphStart') {
					break;
				}
				lastRangeInParagraph = (segments[i].position as RangeRef).range;
			}
			range = range.clone();
			if (firstRangeInParagraph) {
				range.startContainer = firstRangeInParagraph.startContainer;
				range.startOffset = firstRangeInParagraph.startOffset;
			}
			if (lastRangeInParagraph) {
				range.endContainer = lastRangeInParagraph.endContainer;
				range.endOffset = lastRangeInParagraph.endOffset;
			}

			let selector = this._view.toSelector(range.toRange());
			if (selector) {
				this._view.setSpotlight(SpotlightKey.ReadAloudActiveSegment, selector, null);

				// If the Read Aloud annotation popup isn't open and position is locked, navigate to the current segment
				if (!state.annotationPopup && this.positionLocked) {
					setTimeout(() => {
						this.scrolling = true;

						// Navigate to the start of the segment if possible
						let startRange = range.toRange();
						startRange.collapse(true);
						let startSelector = this._view.toSelector(startRange);

						this._view.navigateToSelector(startSelector || selector, {
							ifNeeded: true,
							visibilityMargin: -this._view.iframeWindow.innerHeight / 4, // Scroll early, scroll not quite as often
							block: 'center',
							behavior: 'smooth'
						});

						debounceUntilScrollFinishes(this._view.iframeDocument).then(() => {
							this.scrolling = false;
						});
					});
				}
			}
		}

		if (!state.lang && this._view.lang) {
			return {
				...state,
				lang: this._view.lang,
			};
		}

		if (!state.active
				|| state.segments !== null && state.segmentGranularity === previousState?.segmentGranularity
				|| !state.segmentGranularity) {
			return null;
		}

		let ranges = this._view.getReadAloudRanges(state.segmentGranularity);

		let targetRange: Range | null = null;
		let targetIsSelection = false;
		if (!this._view.iframeDocument.getSelection()!.isCollapsed) {
			targetRange = this._view.iframeDocument.getSelection()!.getRangeAt(0);
			this._view.iframeDocument.getSelection()!.collapseToStart();
			targetIsSelection = true;
		}
		else if (state.targetPosition) {
			targetRange = this._view.toDisplayedRange(state.targetPosition as Selector);
		}

		let backwardStopIndex: number | null = null;
		let forwardStopIndex: number | null = null;
		if (targetRange) {
			let split = splitRanges(ranges, targetRange);
			if (split) {
				ranges = split.ranges;
				backwardStopIndex = split.startIndex;
				if (targetIsSelection) {
					forwardStopIndex = split.endIndex;
				}
			}
			else {
				ranges = this.getRanges(targetRange, state.segmentGranularity);
			}
		}
		else {
			backwardStopIndex = ranges.findIndex(
				range => isPageRectFullyVisible(getBoundingPageRect(range), this._view.iframeWindow)
			);
			if (backwardStopIndex === -1) {
				backwardStopIndex = ranges.findIndex(
					range => isPageRectVisible(getBoundingPageRect(range), this._view.iframeWindow)
				);
			}
			if (backwardStopIndex === -1) {
				backwardStopIndex = ranges.findIndex(
					range => isPageRectVisible(getBoundingPageRect(range), this._view.iframeWindow,
						this._view.iframeWindow.innerWidth)
				);
			}
			if (backwardStopIndex === -1) {
				backwardStopIndex = ranges.findIndex((range) => {
					let rect = range.getBoundingClientRect();
					return !isErrorRect(rect) && rect.x >= 0;
				});
			}
			if (backwardStopIndex === -1) {
				backwardStopIndex = null;
			}
		}

		let lastContainingBlock: Element | null = null;
		let segments: ReadAloudSegment[] = ranges
			.map((range) => {
				let text = range.toString().trim().replace(/\s+/g, ' ');
				if (!text) return null;
				let containingBlock = getContainingBlock(closestElement(range.commonAncestorContainer)!);
				let differentContainingBlock = containingBlock !== lastContainingBlock;
				lastContainingBlock = containingBlock;
				return {
					text,
					position: {
						range: new PersistentRange(range)
					},
					granularity: state.segmentGranularity!,
					anchor: differentContainingBlock ? 'paragraphStart' : null,
				} satisfies ReadAloudSegment;
			})
			.filter((segment, i) => {
				if (segment) {
					return true;
				}
				if (backwardStopIndex !== null && backwardStopIndex > i) backwardStopIndex--;
				if (forwardStopIndex !== null && forwardStopIndex > i) forwardStopIndex--;
				return false;
			}) as ReadAloudSegment[];
		let lang = state.lang || this._view.lang;

		return {
			...state,
			paused: false,
			segments,
			activeSegment: null,
			backwardStopIndex,
			forwardStopIndex,
			targetPosition: undefined,
			lang,
		};
	}

	setPositionLocked(locked: boolean) {
		if (this.state?.active) {
			this.positionLocked = locked;
		}
	}

	get hasTarget(): boolean {
		return !!this._view.iframeDocument.getSelection() && !this._view.iframeDocument.getSelection()!.isCollapsed;
	}

	getAnnotationFromSegments(segments: ReadAloudSegment[], init: NewAnnotation<WADMAnnotation>): NewAnnotation<WADMAnnotation> | null {
		if (!segments.length) {
			return null;
		}
		let range = makeRangeSpanning(
			segments.map(s => (s.position as RangeRef).range.toRange()),
			true
		);
		let annotation = this._view.getAnnotationFromRange(range, 'highlight');
		if (annotation) {
			annotation = {
				...annotation,
				...init,
			};
			return annotation;
		}
		return null;
	}

	getRanges(rootRange: Range, granularity: ReadAloudGranularity): Range[] {
		// https://searchfox.org/mozilla-central/rev/b4412cedce6e2900f5553cbdc43c3fa49c4b9adb/toolkit/components/narrate/Narrator.sys.mjs#54-82
		let matches = new Set();
		let filter = (node: Node) => {
			if (matches.has(node.parentNode)) {
				// Reject sub-trees of accepted nodes.
				return NodeFilter.FILTER_REJECT;
			}
			if (!/\S/.test(node.textContent!)) {
				// Reject nodes with no text.
				return NodeFilter.FILTER_REJECT;
			}
			for (let c = node.firstChild; c; c = c.nextSibling) {
				if (c.nodeType == c.TEXT_NODE && /\S/.test(c.textContent!)) {
					// If node has a non-empty text child accept it.
					matches.add(node);
					return NodeFilter.FILTER_ACCEPT;
				}
			}
			return NodeFilter.FILTER_SKIP;
		};

		let walker = createRangeWalker(rootRange, NodeFilter.SHOW_ELEMENT, filter);
		let segmentRanges = [...iterateWalker(walker)].map((el) => {
			let range = this._view.iframeDocument.createRange();
			range.selectNodeContents(el);
			return range;
		});

		// If there weren't any element children, just use the whole root range
		if (!segmentRanges.length) {
			segmentRanges = [rootRange];
		}

		if (granularity === 'sentence') {
			segmentRanges = segmentRanges.flatMap(range => splitRangeToSentences(range));
		}
		else if (granularity === 'paragraph') {
			// Split each paragraph into first sentence + rest of paragraph
			segmentRanges = segmentRanges.flatMap((range) => {
				let sentences = splitRangeToSentences(range);
				if (sentences.length <= 1) {
					return sentences;
				}
				let firstRange = sentences[0];
				let restRange = makeRangeSpanning(sentences.slice(1), true);
				return [firstRange, restRange];
			});
		}

		// Enforce max byte length per segment
		segmentRanges = segmentRanges.flatMap((segmentRange) => {
			if (!exceedsSegmentMaxLength(segmentRange.toString())) {
				return [segmentRange];
			}

			let textNodeRanges = splitRangeToTextNodes(segmentRange);
			let fullText = '';
			let parts: { range: Range; start: number; end: number }[] = [];
			for (let textNodeRange of textNodeRanges) {
				let text = textNodeRange.toString();
				parts.push({ range: textNodeRange, start: fullText.length, end: fullText.length + text.length });
				fullText += text;
			}

			let chunks = splitTextToChunks(fullText);
			if (chunks.length <= 1) {
				return [segmentRange];
			}

			let doc = segmentRange.commonAncestorContainer.ownerDocument!;
			let result: Range[] = [];
			for (let [chunkStart, chunkEnd] of chunks) {
				let startPart = parts.find(p => p.start <= chunkStart && chunkStart < p.end);
				let endPart = parts.find(p => p.start < chunkEnd && chunkEnd <= p.end);
				if (!startPart || !endPart) continue;

				let partRange = doc.createRange();
				partRange.setStart(
					startPart.range.startContainer,
					startPart.range.startOffset + (chunkStart - startPart.start)
				);
				partRange.setEnd(
					endPart.range.startContainer,
					endPart.range.startOffset + (chunkEnd - endPart.start)
				);
				if (!partRange.collapsed) {
					result.push(partRange);
				}
			}
			return result.length ? result : [segmentRange];
		});

		return segmentRanges;
	}
}
