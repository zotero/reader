
export function getModifiedSelectionRanges(extractor, selectionRanges, modifier) {
	if (!selectionRanges.length) {
		return [];
	}

	let range = selectionRanges.find(x => x.anchor);
	let anchor = {
		pageIndex: range.position.pageIndex,
		offset: range.anchorOffset
	};

	range = selectionRanges.find(x => x.head);
	let head = {
		pageIndex: range.position.pageIndex,
		offset: range.headOffset
	};
	if (modifier === 'left') {
		head.offset--;
	}
	else if (modifier === 'right') {
		head.offset++;
	}
	else if (modifier === 'up') {
		head.offset = extractor.getPrevLineClosestOffset(head.pageIndex, head.offset);
		if (head.offset === null) {
			return [];
		}
	}
	else if (modifier === 'down') {
		head.offset = extractor.getNextLineClosestOffset(head.pageIndex, head.offset);
		if (head.offset === null) {
			return [];
		}
	}
	else if (typeof modifier === 'object') {
		let position = modifier;
		head = position;
	}
	return getSelectionRanges(extractor, anchor, head);
}

export function getWordSelectionRanges(extractor, anchorPosition, headPosition) {
	let anchorWord = extractor.getClosestWord(anchorPosition);
	let headWord = extractor.getClosestWord(headPosition);
	if (!anchorWord || !headWord) {
		return [];
	}
	let anchor = { pageIndex: anchorPosition.pageIndex };
	let head = { pageIndex: headPosition.pageIndex };
	if (anchorWord.anchorOffset < headWord.anchorOffset && anchor.pageIndex === head.pageIndex
		|| anchor.pageIndex < head.pageIndex) {
		anchor.offset = anchorWord.anchorOffset;
		head.offset = headWord.headOffset;
	}
	else {
		anchor.offset = anchorWord.headOffset;
		head.offset = headWord.anchorOffset;
	}
	return getSelectionRanges(extractor, anchor, head);
}

export function getLineSelectionRanges(extractor, anchorPosition, headPosition) {
	let anchorLine = extractor.getClosestLine(anchorPosition);
	let headLine = extractor.getClosestLine(headPosition);
	if (!anchorLine || !headLine) {
		return [];
	}
	let anchor = { pageIndex: anchorPosition.pageIndex };
	let head = { pageIndex: headPosition.pageIndex };
	if (anchorLine.anchorOffset < headLine.anchorOffset && anchor.pageIndex === head.pageIndex
		|| anchor.pageIndex < head.pageIndex) {
		anchor.offset = anchorLine.anchorOffset;
		head.offset = headLine.headOffset;
	}
	else {
		anchor.offset = anchorLine.headOffset;
		head.offset = headLine.anchorOffset;
	}
	return getSelectionRanges(extractor, anchor, head);
}

export function getSelectionRanges(extractor, anchor, head) {
	let selectionRanges = [];
	let fromPageIndex = Math.min(anchor.pageIndex, head.pageIndex);
	let toPageIndex = Math.max(anchor.pageIndex, head.pageIndex);
	let reverse = anchor.pageIndex > head.pageIndex;
	for (let i = fromPageIndex; i <= toPageIndex; i++) {
		let a, h;
		if (i === anchor.pageIndex) {
			a = anchor.offset !== undefined ? anchor.offset : [anchor.rects[0][0], anchor.rects[0][1]];
		}

		if (i === head.pageIndex) {
			h = head.offset !== undefined ? head.offset : [head.rects[0][0], head.rects[0][1]];
		}

		let selectionRange = extractor.extractRange({
			pageIndex: i,
			anchor: a,
			head: h,
			reverse
		});
		if (!selectionRange) {
			return [];
		}

		if (i === anchor.pageIndex) {
			selectionRange.anchor = true;
		}

		if (i === head.pageIndex) {
			selectionRange.head = true;
		}

		if (!selectionRange.collapsed) {
			// // We can synchronously get page viewbox from page view, because it's already loaded when selecting
			// let pageHeight = PDFViewerApplication.pdfViewer.getPageView(selectionRange.position.pageIndex).viewport.viewBox[3];
			// let top = pageHeight - selectionRange.position.rects[0][3];
			// if (top < 0) {
			// 	top = 0;
			// }
			//
			// // TODO: Unify all annotations sort index calculation
			// let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
			// selectionRange.sortIndex = [
			// 	i.toString().slice(0, 5).padStart(5, '0'),
			// 	offset.toString().slice(0, 6).padStart(6, '0'),
			// 	Math.floor(top).toString().slice(0, 5).padStart(5, '0')
			// ].join('|');

			// let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
			// This currently gets sortIndex by position.rects, which is probably less precise than using an offset
			selectionRange.sortIndex = extractor.getSortIndex(selectionRange.position);
		}

		selectionRanges.push(selectionRange);
	}
	return selectionRanges;
}

export function getSelectionRangesByPosition(extractor, position) {
	let selectionRanges = [];
	let selectionRange = extractor.extractRangeByRects({
		pageIndex: position.pageIndex,
		rects: position.rects
	});
	if (!selectionRange) {
		return [];
	}

	selectionRanges = [selectionRange];

	if (position.nextPageRects) {
		selectionRange = extractor.extractRangeByRects({
			pageIndex: position.pageIndex + 1,
			rects: position.nextPageRects
		});
		if (selectionRange) {
			selectionRanges.push(selectionRange);
		}
	}

	if (selectionRanges.length === 2) {
		selectionRanges[0].anchor = true;
		selectionRanges[1].head = true;
	}
	else {
		selectionRanges[0].head = true;
		selectionRanges[0].anchor = true;
	}



	// if (!selectionRange.collapsed) {
	// 	// We can synchronously get page viewbox from page view, because it's already loaded when selecting
	// 	let pageHeight = PDFViewerApplication.pdfViewer.getPageView(selectionRange.position.pageIndex).viewport.viewBox[3];
	// 	let top = pageHeight - selectionRange.position.rects[0][3];
	// 	if (top < 0) {
	// 		top = 0;
	// 	}
	//
	// 	// TODO: Unify all annotations sort index calculation
	// 	let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
	// 	selectionRange.sortIndex = [
	// 		i.toString().slice(0, 5).padStart(5, '0'),
	// 		offset.toString().slice(0, 6).padStart(6, '0'),
	// 		Math.floor(top).toString().slice(0, 5).padStart(5, '0')
	// 	].join('|');
	// }

	return selectionRanges;
}

export function getReversedSelectionRanges(selectionRanges) {
	selectionRanges = JSON.parse(JSON.stringify(selectionRanges));
	if (selectionRanges.length === 2) {
		delete selectionRanges[0].anchor;
		delete selectionRanges[1].head;
		selectionRanges[0].head = true;
		selectionRanges[1].anchor = true;
	}

	let tmp = selectionRanges[0].anchorOffset;
	selectionRanges[0].anchorOffset = selectionRanges[0].headOffset;
	selectionRanges[0].headOffset = tmp;
	if (selectionRanges.length === 2) {
		let tmp = selectionRanges[1].anchorOffset;
		selectionRanges[1].anchorOffset = selectionRanges[1].headOffset;
		selectionRanges[1].headOffset = tmp;
	}
	return selectionRanges;
}

// Doesn't work with reversed selections
export function getSelectionRangeHandles(extractor, selectionRanges) {
	let selectionRange = selectionRanges[0];
	let pageIndex = selectionRange.position.pageIndex;
	let chars = extractor.getPageCharsSync(pageIndex);
	let char = chars[selectionRange.anchorOffset];
	let r = char.rect;
	let rect = (
		char.rotation === 0 && [r[0], r[1], r[0], r[3]]
		|| char.rotation === 90 && [r[0], r[1]]
		|| char.rotation === 180 && [r[2], r[1]]
		|| char.rotation === 270 && [r[2], r[3]]
	);
	let from = { pageIndex, rect };
	if (selectionRanges.length === 2) {
		selectionRange = selectionRanges[1];
	}
	pageIndex = selectionRange.position.pageIndex;
	chars = extractor.getPageCharsSync(pageIndex);
	if (selectionRange.head) {
		char = chars[selectionRange.headOffset - 1];
	}
	else {
		char = chars[selectionRange.headOffset];
	}
	r = char.rect;
	rect = (
		char.rotation === 0 && [r[2], r[3], r[2], r[1]]
		|| char.rotation === 90 && [r[2], r[3]]
		|| char.rotation === 180 && [r[0], r[3]]
		|| char.rotation === 270 && [r[0], r[1]]
	);
	let to = { pageIndex, rect };
	return [from, to];
}

// Based on https://stackoverflow.com/a/16100733





function getNodeOffset(container, offset) {
	let charIndex = 0;
	let charIndex2 = 0;
	let nodeStack = [container];
	let node;
	while (node = nodeStack.pop()) {
		if (node.nodeType === Node.TEXT_NODE) {
			charIndex = 0;
			for (let i = 0; i < node.length; i++) {
				if (node.nodeValue[i].trim()) {
					if (offset === charIndex2) {
						return { node, offset: charIndex };
					}
					charIndex2++;
				}
				charIndex++;
			}
		}
		else {
			let i = node.childNodes.length;
			while (i--) {
				nodeStack.push(node.childNodes[i]);
			}
		}
	}
}

export function setTextLayerSelection(win, selectionRanges) {
	// Anchor
	let selectionRange = selectionRanges[0];
	let offset = Math.min(selectionRange.anchorOffset, selectionRange.headOffset);
	let container = win.document.querySelector(
		`[data-page-number="${selectionRange.position.pageIndex + 1}"] .textLayer`);
	let { node: startNode, offset: startOffset } = getNodeOffset(container, offset);

	// Head
	selectionRange = selectionRanges[selectionRanges.length - 1];
	offset = Math.max(selectionRange.anchorOffset, selectionRange.headOffset);
	container = win.document.querySelector(
		`[data-page-number="${selectionRange.position.pageIndex + 1}"] .textLayer`);
	let { node: endNode, offset: endOffset } = getNodeOffset(container, offset);

	let range = win.document.createRange();
	range.setStart(container, 0);
	range.collapse(true);
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);

	let selection = win.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}

