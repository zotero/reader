/* eslint-disable react/prop-types */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import cx from 'classnames';
import { getStableAttachment } from './stable-attachment.mjs';

// TODO: Resizing window doesn't properly reposition annotation popup on x axis, in EPUB view
function ViewPopup({ id: _id, rect, anchorPoint, className, uniqueRef, padding, preferTop, preferLeft, children, onRender, popupRef, stableAttachment }) {
	const [popupPosition, setPopupPosition] = useState(null);
	const containerRef = useRef();
	const xrect = useRef();

	const initialized = useRef(false);
	const pos = useRef(null);
	let stable = !!stableAttachment;
	let stableWidth = stableAttachment?.width;
	let stableHeight = stableAttachment?.height;

	// Update the popup position when the `rect` changes
	useEffect(() => {
		if (stable) return;
		if (xrect.current) {
			let dx = rect[0] - xrect.current[0];
			let dy = rect[1] - xrect.current[1];
			xrect.current = rect;

			pos.current.left += dx;
			pos.current.top += dy;

			setPopupPosition({}); // Trigger re-render
		}
		else {
			xrect.current = rect;
		}
	}, [rect, stable]);

	useLayoutEffect(() => {
		if (initialized.current) {
			onRender && onRender();
		}
		// Preserve existing callback timing: a new callback alone does not reposition.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [popupPosition]);

	useLayoutEffect(() => {
		if (stable) return undefined;
		updatePopupPosition();
		// Editor needs more time to get its final dimensions
		let timer = setTimeout(updatePopupPosition, 0);
		return () => clearTimeout(timer);
		// Preserve the legacy measurement triggers; content does not own stable placement.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uniqueRef, rect, anchorPoint, stable]);

	useLayoutEffect(() => {
		if (!stable) return undefined;
		let parent = containerRef.current.parentNode;
		let active = true;
		let update = () => {
			if (!active) return;
			let viewport = parent.getBoundingClientRect();
			let next = getStableAttachment({ rect, viewport: [viewport.width, viewport.height],
				width: stableWidth, height: stableHeight, padding });
			if (JSON.stringify(pos.current) === JSON.stringify(next)) return;
			pos.current = next;
			xrect.current = rect;
			initialized.current = true;
			setPopupPosition(next);
		};
		update();
		// Only observe the containing viewport, not content whose growth we constrain.
		let observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
		observer?.observe(parent);
		window.addEventListener('resize', update);
		return () => {
			active = false;
			observer?.disconnect();
			window.removeEventListener('resize', update);
		};
	}, [rect, stable, stableWidth, stableHeight, padding]);

	function updatePopupPosition() {
		if (!containerRef.current) {
			return;
		}

		let width = containerRef.current.offsetWidth;
		let height = containerRef.current.offsetHeight;

		let parent = containerRef.current.parentNode;
		let viewRect = parent.getBoundingClientRect();
		viewRect = [0, 0, viewRect.width, viewRect.height];

		// `rect` is the rect that the popup is placed along.
		// `anchorPoint` is the point within it that the popup points at.
		// When placed above or below, the popup is centered on the
		// anchor's x; when placed beside, it's centered on its y.
		// Defaults to the center of the rect.
		let anchorX = anchorPoint ? anchorPoint[0] : rect[0] + (rect[2] - rect[0]) / 2;
		let anchorY = anchorPoint ? anchorPoint[1] : rect[1] + (rect[3] - rect[1]) / 2;

		function calculateTop() {
			let top = anchorY - height / 2;
			// If the rect is taller than the popup, keep the popup within it
			if (rect[3] - rect[1] > height) {
				top = Math.min(Math.max(top, rect[1]), rect[3] - height);
			}
			return top;
		}

		// Place the popup beside the rect, pointing at the rect's near edge. If
		// the rect is too wide for the popup to fit beside it, point at the
		// anchor instead, so the popup stays close to what it's pointing at.
		function calculateLeftForSide(placeLeft) {
			if (placeLeft) {
				let left = rect[0] - width - padding;
				return left < padding ? anchorX - width - padding : left;
			}
			else {
				let left = rect[2] + padding;
				return left + width > viewRect[2] - padding ? anchorX + padding : left;
			}
		}

		let left = anchorX - width / 2;

		let side;
		let top;
		if (left < 0) {
			side = 'right';
			left = calculateLeftForSide(false);
			top = calculateTop();
		}
		else if (left + width > viewRect[2]) {
			side = 'left';
			left = calculateLeftForSide(true);
			top = calculateTop();
		}
		else {
			// Try to place the popup on the preferred vertical side (bottom
			// by default, top if `preferTop`).
			// Fall back to the other side if the preferred one doesn't fit.
			let fitsAbove = rect[1] - padding - height > 0;
			let fitsBelow = rect[3] + height + padding < viewRect[3];
			if (preferTop ? fitsAbove : fitsBelow) {
				if (preferTop) {
					top = rect[1] - padding - height;
					side = 'top';
				}
				else {
					top = rect[3] + padding;
					side = 'bottom';
				}
			}
			else if (preferTop ? fitsBelow : fitsAbove) {
				if (preferTop) {
					top = rect[3] + padding;
					side = 'bottom';
				}
				else {
					top = rect[1] - padding - height;
					side = 'top';
				}
			}
			else {
				// Neither above nor below fits, so place the popup next to the
				// rect. If `preferLeft` is passed (not undefined), place on the
				// preferred side. Otherwise, place on the side with more room.
				let placeLeft = preferLeft === undefined
					? rect[0] >= (viewRect[2] - viewRect[0]) / 2
					: preferLeft;
				side = placeLeft ? 'left' : 'right';
				left = calculateLeftForSide(placeLeft);
				top = calculateTop();
			}
		}

		if (left + width > viewRect[2] - padding) {
			left = viewRect[2] - width - padding;
		}
		if (left < padding) {
			left = padding;
		}
		if (top + height > viewRect[3] - padding) {
			top = viewRect[3] - height - padding;
		}
		if (top < padding) {
			top = padding;
		}

		xrect.current = rect;
		pos.current = { top, left, side };

		setPopupPosition({}); // Trigger re-render
		initialized.current = true;
	}

	let pointerClass = {};
	if (pos.current) {
		pointerClass['page-popup-' + pos.current.side + '-center'] = true;
	}

	return (
		<div
			ref={(node) => {
				containerRef.current = node;
				if (popupRef) popupRef.current = node;
			}}
			className={cx('view-popup', className, { ...pointerClass, 'stable-attachment': !!stableAttachment })}
			style={stableAttachment ? pos.current?.style : pos.current ? { transform: `translate(${pos.current.left}px, ${pos.current.top}px)` } : {}}
		>
			{children}
		</div>
	);
}

export default ViewPopup;
