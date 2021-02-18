'use strict';

export function copyToClipboard(str) {
	let el = document.createElement('textarea');
	el.value = str;
	document.body.appendChild(el);
	el.select();
	document.execCommand('copy');
	document.body.removeChild(el);
}

export function deselect() {
	let selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
	if (selection) selection.empty ? selection.empty() : selection.removeAllRanges();
}

export function getClientRects(range, containerEl) {
	let clientRects = Array.from(range.getClientRects());
	let offset = containerEl.getBoundingClientRect();
	let rects = clientRects.map((rect) => {
		return {
			top: rect.top + containerEl.scrollTop - offset.top - 10,
			left: rect.left + containerEl.scrollLeft - offset.left - 9,
			width: rect.width,
			height: rect.height
		};
	});

	rects = rects.map((rect) => {
		return [
			rect.left,
			rect.top,
			rect.left + rect.width,
			rect.top + rect.height
		];
	});

	return rects;
}


// https://github.com/jashkenas/underscore/blob/master/underscore.js
// (c) 2009-2018 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
// Underscore may be freely distributed under the MIT license.
// Returns a function, that, when invoked, will only be triggered at most once
// during a given window of time. Normally, the throttled function will run
// as much as it can, without ever going more than once per `wait` duration;
// but if you'd like to disable the execution on the leading edge, pass
// `{leading: false}`. To disable execution on the trailing edge, ditto.
export function throttle(func, wait, options) {
	var context, args, result;
	var timeout = null;
	var previous = 0;
	if (!options) options = {};
	var later = function () {
		previous = options.leading === false ? 0 : Date.now();
		timeout = null;
		result = func.apply(context, args);
		if (!timeout) context = args = null;
	};
	return function () {
		var now = Date.now();
		if (!previous && options.leading === false) previous = now;
		var remaining = wait - (now - previous);
		context = this;
		args = arguments;
		if (remaining <= 0 || remaining > wait) {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			previous = now;
			result = func.apply(context, args);
			if (!timeout) context = args = null;
		}
		else if (!timeout && options.trailing !== false) {
			timeout = setTimeout(later, remaining);
		}
		return result;
	};
}

export function setCaretToEnd(target) {
	const range = document.createRange();
	const sel = window.getSelection();
	range.selectNodeContents(target);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
	target.focus();
	range.detach();
}

export function clearSelection() {
	let selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
	if (selection) selection.empty ? selection.empty() : selection.removeAllRanges();
}

export function getPageFromElement(target) {
	let node = target.closest('.page');
	if (!node) {
		return null;
	}

	let number = parseInt(node.dataset.pageNumber);
	return { node, number };
}

export function getPageFromRange(range) {
	let parentElement = range.startContainer.parentElement;
	if (!parentElement) {
		return;
	}

	return getPageFromElement(parentElement);
}

export function findOrCreateContainerLayer(container, className) {
	let layer = container.querySelector('.' + className);

	if (!layer) {
		layer = document.createElement('div');
		layer.className = className;
		container.appendChild(layer);
	}

	return layer;
}

export function pointerEventToPosition(event) {
	let page = getPageFromElement(event.target);
	if (!page) {
		return null;
	}

	let rect = page.node.getBoundingClientRect();

	let x = event.clientX + page.node.scrollLeft - rect.left - 9;
	let y = event.clientY + page.node.scrollTop - rect.top - 10;

	return {
		pageIndex: page.number - 1,
		rects: [[x, y, x, y]]
	};
}

export function formatAnnotationText(annotation) {
	let parts = [];

	if (annotation.comment) {
		parts.push(annotation.comment + ':');
	}

	if (annotation.text) {
		parts.push('"' + annotation.text + '"');
	}

	return parts.join(' ');
}

export function equalPositions(annotation1, annotation2) {
	let p1 = annotation1.position;
	let p2 = annotation2.position;
	return (
		p1.pageIndex === p2.pageIndex
		&& JSON.stringify(p1.rects) === JSON.stringify(p2.rects)
	);
}


export function intersectPositions(position1, position2) {
	if (position1.pageIndex !== position2.pageIndex) {
		return false;
	}

	for (let r1 of position1.rects) {
		for (let r2 of position2.rects) {
			if (!(r2[0] > r1[2] || r2[2] < r1[0] || r2[1] > r1[3] || r2[3] < r1[1])) {
				return true;
			}
		}
	}

	return false;
}


export function intersectBoundingPositions(position1, position2) {
	if (position1.pageIndex !== position2.pageIndex) {
		return false;
	}

	let r1 = [
		Math.min(...position1.rects.map(x => x[0])),
		Math.min(...position1.rects.map(x => x[1])),
		Math.max(...position1.rects.map(x => x[2])),
		Math.max(...position1.rects.map(x => x[3]))
	];

	let r2 = [
		Math.min(...position2.rects.map(x => x[0])),
		Math.min(...position2.rects.map(x => x[1])),
		Math.max(...position2.rects.map(x => x[2])),
		Math.max(...position2.rects.map(x => x[3]))
	];

	return !(r2[0] > r1[2] || r2[2] < r1[0] || r2[1] > r1[3] || r2[3] < r1[1]);
}

import React, { useState, useEffect, useRef, useDebugValue } from 'react';

/**
 * Synchronously sets ref value and asynchronously sets state value
 * @param initialValue
 * @returns {[]}
 */
export function useRefState(initialValue) {
	const [state, setState] = useState(initialValue);
	const stateRef = useRef(state);

	function _setState(value) {
		stateRef.current = value;
		setState(value);
	}

	return [state, stateRef, _setState];
}

export function getAnnotationsFromSelectionRanges(selectionRanges) {
	let annotations = [];
	for (let selectionRange of selectionRanges) {
		// TODO: Use the extracted page label
		let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
		let pageIndex = selectionRange.position.pageIndex;

		annotations.push({
			text: selectionRange.text,
			position: selectionRange.position,
			pageLabel: pageLabels && pageLabels[pageIndex] || (pageIndex + 1).toString()
		});
	}

	return annotations;
}

export function getImageDataURL(img) {
	var canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	var ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
	return canvas.toDataURL('image/png');
}

export function setDataTransferAnnotations(dataTransfer, annotations) {
	let text = annotations.reduce((text, annotation) => {
		let parts = [];

		if (annotation.comment) {
			parts.push(annotation.comment + ':');
		}

		if (annotation.text) {
			parts.push('"' + annotation.text + '"');
		}

		return text + '\n\n' + parts.join(' ');
	}, '');

	annotations = annotations.map(
		({ id, text, comment, image, position, pageLabel }) => {
			if (image) {
				let img = document.querySelector('div[data-sidebar-id="' + id + '"] img');
				if (img) {
					image = getImageDataURL(img);
				}
			}
			return {
				attachmentItemID: window.itemID,
				text,
				comment,
				image,
				position,
				pageLabel
			};
		});

	dataTransfer.setData('zotero/annotation', JSON.stringify(annotations));
	// dataTransfer.setData('text/plain', JSON.stringify(annotations));
	dataTransfer.setData('text/plain', text);
}
