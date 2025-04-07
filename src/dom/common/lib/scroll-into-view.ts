// Userland implementation of the CSSOM "scroll a target into view" algorithm,
// which supports Range targets in the spec but is only exposed as a method on
// Element in browsers.
//
// https://drafts.csswg.org/cssom-view/#scroll-a-target-into-view

import { isElement } from "./nodes";

type ScrollingBox = Element | Window;
type ScrollTarget = Element | Range | Node;

interface ScrollPosition {
	x: number;
	y: number;
}

/**
 * Scroll a target into view.
 */
export function scrollIntoView(
	target: ScrollTarget,
	options: ScrollIntoViewOptions & {
		container?: Element;
	} = {}
): void {
	let behavior = options.behavior || 'auto';
	let block = options.block || 'start';
	let inline = options.inline || 'nearest';
	let container = options.container || null;

	// For each ancestor element or viewport that establishes a scrolling box *scrolling box*,
	// in order of innermost to outermost scrolling box, run these substeps:
	for (let scrollingBox of getScrollingBoxes(target)) {
		// 1.1: If the Document associated with target is not same origin with the Document
		// associated with the element or viewport associated with scrolling box,
		// terminate these steps.
		//
		// [Not applicable here]

		// 1.2: Let *position* be the scroll position resulting from running the steps to
		// determine the scroll-into-view position of target with behavior as the scroll
		// behavior, block as the block flow position, inline as the inline base direction
		// position and scrolling box as the scrolling box.
		let position = determineScrollIntoViewPosition(target, block, inline, scrollingBox);

		// 1.3: If position is not the same as scrolling box’s current scroll position,
		// or scrolling box has an ongoing smooth scroll,
		//
		// [Skipping smooth scroll handling here]
		let currentPosition = getCurrentScrollPosition(scrollingBox);

		if (!arePositionsEqual(position, currentPosition)) {
			// If scrolling box is associated with an element
			//   Perform a scroll of the element’s scrolling box to position, with the
			//   element as the associated element and behavior as the scroll behavior.
			// If scrolling box is associated with a viewport
			//   [etc.]
			scrollingBox.scrollTo({
				top: position.y,
				left: position.x,
				behavior
			});
		}

		// 1.4: If container is not null and scrolling box is a shadow-including inclusive
		// ancestor of container, abort the rest of these steps.
		if (container !== null && isInclusiveAncestor(scrollingBox, container)) {
			break;
		}
	}
}

/**
 * @returns Scrolling boxes from innermost to outermost
 */
function getScrollingBoxes(target: ScrollTarget): ScrollingBox[] {
	let scrollingBoxes: ScrollingBox[] = [];

	let element: Node | null = 'commonAncestorContainer' in target
		? target.commonAncestorContainer
		: target;

	while (element && element.parentElement) {
		element = element.parentElement;

		if (isScrollable(element as Element)) {
			scrollingBoxes.push(element as Element);
		}
	}

	// Add the viewport (window) as the outermost scrolling box
	scrollingBoxes.push('startContainer' in target
		? target.startContainer.ownerDocument!.defaultView!
		: target.ownerDocument!.defaultView!);

	return scrollingBoxes;
}

function isScrollable(element: Element): boolean {
	let style = getComputedStyle(element);
	let overflowX = style.overflowX;
	let overflowY = style.overflowY;

	return (
		(overflowX === 'auto' || overflowX === 'scroll' || overflowY === 'auto' || overflowY === 'scroll')
		&& (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)
	);
}

function determineScrollIntoViewPosition(
	target: ScrollTarget,
	block: ScrollLogicalPosition,
	inline: ScrollLogicalPosition,
	scrollingBox: ScrollingBox
): ScrollPosition {
	let targetRect = getTargetRect(target);

	let scrollingBoxRect = isElement(scrollingBox)
		? scrollingBox.getBoundingClientRect()
		: new DOMRect(0, 0, scrollingBox.innerWidth, scrollingBox.innerHeight);

	let xOffset = calculateInlineOffset(targetRect, scrollingBoxRect, inline);
	let yOffset = calculateBlockOffset(targetRect, scrollingBoxRect, block);

	let currentPosition = getCurrentScrollPosition(scrollingBox);

	return {
		x: currentPosition.x + xOffset,
		y: currentPosition.y + yOffset
	};
}

function getTargetRect(target: ScrollTarget): DOMRect {
	if ('nodeType' in target && target.nodeType !== Node.ELEMENT_NODE) {
		let range = target.ownerDocument!.createRange();
		range.selectNode(target);
		target = range;
	}
	return (target as Range | Element).getBoundingClientRect();
}

function calculateInlineOffset(
	targetRect: DOMRect,
	scrollingBoxRect: DOMRect,
	inline: ScrollLogicalPosition
): number {
	let targetLeft = targetRect.left;
	let targetRight = targetRect.right;
	let boxLeft = scrollingBoxRect.left;
	let boxRight = scrollingBoxRect.right;

	switch (inline) {
		case 'start':
			return targetLeft - boxLeft;
		case 'center':
			return (targetLeft + targetRight) / 2 - (boxLeft + boxRight) / 2;
		case 'end':
			return targetRight - boxRight;
		case 'nearest':
		default:
			// If the target is fully visible horizontally, no scrolling needed
			if (targetLeft >= boxLeft && targetRight <= boxRight) {
				return 0;
			}
			// If the target extends beyond the left edge
			else if (targetLeft < boxLeft) {
				return targetLeft - boxLeft;
			}
			// If the target extends beyond the right edge
			else {
				return targetRight - boxRight;
			}
	}
}

function calculateBlockOffset(
	targetRect: DOMRect,
	scrollingBoxRect: DOMRect,
	block: ScrollLogicalPosition
): number {
	let targetTop = targetRect.top;
	let targetBottom = targetRect.bottom;
	let boxTop = scrollingBoxRect.top;
	let boxBottom = scrollingBoxRect.bottom;

	switch (block) {
		case 'start':
			return targetTop - boxTop;
		case 'center':
			return (targetTop + targetBottom) / 2 - (boxTop + boxBottom) / 2;
		case 'end':
			return targetBottom - boxBottom;
		case 'nearest':
		default:
			// If the target is fully visible vertically, no scrolling needed
			if (targetTop >= boxTop && targetBottom <= boxBottom) {
				return 0;
			}
			// If the target extends beyond the top edge
			else if (targetTop < boxTop) {
				return targetTop - boxTop;
			}
			// If the target extends beyond the bottom edge
			else {
				return targetBottom - boxBottom;
			}
	}
}

function getCurrentScrollPosition(scrollingBox: ScrollingBox): ScrollPosition {
	if (isElement(scrollingBox)) {
		return {
			x: scrollingBox.scrollLeft,
			y: scrollingBox.scrollTop
		};
	}
	else {
		return {
			x: scrollingBox.scrollX,
			y: scrollingBox.scrollY
		};
	}
}

function arePositionsEqual(position1: ScrollPosition, position2: ScrollPosition): boolean {
	return position1.x === position2.x && position1.y === position2.y;
}

/**
 * Check if an element is a shadow-including inclusive ancestor of another element.
 */
function isInclusiveAncestor(ancestor: ScrollingBox, descendant: Element): boolean {
	if (!isElement(ancestor)) {
		return false;
	}

	if (ancestor === descendant) {
		return true;
	}

	let current: Node | null = descendant;

	while (current) {
		if (current === ancestor) {
			return true;
		}

		// Handle shadow DOM traversal
		if (current.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			current = (current as ShadowRoot).host;
		}
		else {
			current = current.parentNode;
		}
	}

	return false;
}
