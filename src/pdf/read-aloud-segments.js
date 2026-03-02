import { detectLang } from '../common/lib/detect-lang';
import { splitTextToChunks } from '../common/read-aloud/segment-split';
import { getRangeRects } from './lib/utilities';
import { getTextFromChars } from './selection';

let trimText = (s) => s.replace(/^ +| +$/g, '');
let joinWithSpace = (a, b) => {
	if (!a) return b;
	if (!b) return a;
	return a + ((a.at(-1) !== ' ' && !/[\p{P}]/u.test(b[0] || '')) ? ' ' : '') + b;
};

let computeBoundingRect = (rects) => {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let r of rects) {
		if (!r) continue;
		let [x1, y1, x2, y2] = r;
		if (x1 < minX) minX = x1;
		if (y1 < minY) minY = y1;
		if (x2 > maxX) maxX = x2;
		if (y2 > maxY) maxY = y2;
	}

	return [minX, minY, maxX, maxY];
};

function paragraphsFromChars(chars) {
	let paragraphs = [];
	if (!chars || !chars.length) return paragraphs;

	let lines = [];
	let explicitBreaks = new Set();

	let lineStart = 0;

	let pushLine = (endIdx) => {
		let parts = getRangeRects(chars, lineStart, endIdx) || [];
		let rect = computeBoundingRect(parts);
		lines.push({ start: lineStart, end: endIdx, rect });
		lineStart = endIdx + 1;
	};

	for (let i = 0; i < chars.length; i++) {
		let ch = chars[i];
		if (!ch) continue;

		if (ch.paragraphBreakAfter) {
			explicitBreaks.add(i);
		}

		let isLineEnd = ch.lineBreakAfter || ch.paragraphBreakAfter || i === chars.length - 1;

		if (isLineEnd) {
			pushLine(i);
		}
	}

	if (!lines.length) {
		return paragraphs;
	}

	// First pass: decide paragraph breaks **between lines**
	let breaksBetweenLines = new Array(Math.max(0, lines.length - 1)).fill(false);
	const INDENT_EPS = 10;

	for (let li = 1; li < lines.length; li++) {
		let prev = lines[li - 1];
		let cur = lines[li];

		// Explicit paragraph break right after the previous line
		if (explicitBreaks.has(prev.end)) {
			breaksBetweenLines[li - 1] = true;
			continue;
		}

		if (cur.rect[0] > prev.rect[0] + INDENT_EPS) {
			breaksBetweenLines[li - 1] = true;
		}
	}

	// Group lines into initial paragraphs (by line indices)
	let paragraphLineGroups = [];
	let paraStartLine = 0;
	for (let li = 1; li < lines.length; li++) {
		if (breaksBetweenLines[li - 1]) {
			paragraphLineGroups.push([paraStartLine, li - 1]);
			paraStartLine = li;
		}
	}
	paragraphLineGroups.push([paraStartLine, lines.length - 1]);

	// Second pass: join single‑line paragraphs with previous
	// when the first characters share the same font
	if (paragraphLineGroups.length <= 1) {
		for (let [ls, le] of paragraphLineGroups) {
			paragraphs.push([lines[ls].start, lines[le].end]);
		}
		return paragraphs;
	}

	let mergedLineGroups = [];
	let [prevLs, prevLe] = paragraphLineGroups[0];
	let prevFont = chars[lines[prevLs].start].fontName;

	for (let idx = 1; idx < paragraphLineGroups.length; idx++) {
		let [curLs, curLe] = paragraphLineGroups[idx];

		let isSingleLine = curLs === curLe;
		let curFont = chars[lines[curLs].start].fontName;

		if (isSingleLine && prevFont && curFont && prevFont === curFont) {
			// Merge: extend previous paragraph to include current paragraph's lines
			prevLe = curLe;
		}
		else {
			mergedLineGroups.push([prevLs, prevLe]);
			[prevLs, prevLe] = [curLs, curLe];
			prevFont = curFont;
		}
	}
	mergedLineGroups.push([prevLs, prevLe]);

	// Final step: convert merged line groups to character index ranges
	for (let [ls, le] of mergedLineGroups) {
		paragraphs.push([lines[ls].start, lines[le].end]);
	}

	return paragraphs;
}

function buildSegmenterText(chars) {
	let textParts = [];
	let textLength = 0;
	let charIndexByTextIndex = [];

	for (let i = 0; i < chars.length; i++) {
		let ch = chars[i];
		if (!ch || ch.ignorable) {
			continue;
		}

		// Map all code units in ch.c to this char index for robust offset mapping.
		for (let j = 0; j < ch.c.length; j++) {
			charIndexByTextIndex[textLength + j] = i;
		}
		textParts.push(ch.c);
		textLength += ch.c.length;

		if (ch.spaceAfter || ch.lineBreakAfter || ch.paragraphBreakAfter) {
			textParts.push(' ');
			textLength += 1;
		}
	}

	// Normalize all whitespace to space characters
	let text = textParts.join('');
	text = text.replace(/\s/g, ' ');

	return { text, charIndexByTextIndex };
}

function trimSegmentSpaces(segmentText) {
	let start = 0;
	let end = segmentText.length;
	while (start < end && segmentText[start] === ' ') start++;
	while (end > start && segmentText[end - 1] === ' ') end--;
	return { start, end };
}

function findCharIndex(charIndexByTextIndex, start, end, forward) {
	let i = forward ? start : end - 1;
	let step = forward ? 1 : -1;
	let stop = forward ? end : start - 1;
	for (; i !== stop; i += step) {
		if (charIndexByTextIndex[i] !== undefined) {
			return charIndexByTextIndex[i];
		}
	}
	return null;
}

function textRangeToCharRange(charIndexByTextIndex, start, end) {
	let startChar = findCharIndex(charIndexByTextIndex, start, end, true);
	if (startChar === null) {
		return null;
	}

	let endChar = findCharIndex(charIndexByTextIndex, start, end, false);
	if (endChar === null) {
		return null;
	}

	return [startChar, endChar];
}

function sentencesFromSegmenterText(text, charIndexByTextIndex, lang) {
	if (!text) {
		return [];
	}

	if (!('Segmenter' in Intl)) {
		return [];
	}

	let segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
	let segments = [...segmenter.segment(text)];

	let out = [];
	for (let segment of segments) {
		let sentStart = segment.index;
		let sentEnd = sentStart + segment.segment.length;

		let trimmed = trimSegmentSpaces(segment.segment);
		sentStart += trimmed.start;
		sentEnd = sentStart + (trimmed.end - trimmed.start);

		if (sentEnd <= sentStart) {
			continue;
		}

		let segmentText = text.slice(sentStart, sentEnd);
		if (!segmentText) {
			continue;
		}

		// Enforce max byte length per segment
		let chunks = splitTextToChunks(segmentText);
		for (let [chunkStart, chunkEnd] of chunks) {
			let absStart = sentStart + chunkStart;
			let absEnd = sentStart + chunkEnd;

			let chunkTrimmed = trimSegmentSpaces(segmentText.slice(chunkStart, chunkEnd));
			absStart += chunkTrimmed.start;
			absEnd = absStart + (chunkTrimmed.end - chunkTrimmed.start);

			if (absEnd <= absStart) {
				continue;
			}

			let charRange = textRangeToCharRange(charIndexByTextIndex, absStart, absEnd);
			if (!charRange) {
				continue;
			}

			let chunkText = text.slice(absStart, absEnd);
			if (!chunkText) {
				continue;
			}

			out.push({
				text: chunkText,
				ranges: [charRange]
			});
		}
	}

	return out;
}

export function buildReadAloudSegmentsFromRanges(chars, pageIndex, paragraphRanges) {
	if (!chars || !chars.length || !paragraphRanges || !paragraphRanges.length) {
		return { paragraphs: [], sentences: [] };
	}

	let paragraphs = [];
	let sentences = [];

	for (let [start, end] of paragraphRanges) {
		if (start === null || end === null || start > end) continue;

		let paraChars = chars.slice(start, end + 1);
		let { text, charIndexByTextIndex } = buildSegmenterText(paraChars);
		let paragraphText = trimText(text);
		let paragraphLang = detectLang(paragraphText) || undefined;
		let rawSentences = sentencesFromSegmenterText(text, charIndexByTextIndex, paragraphLang);

		let paraRects = getRangeRects(chars, start, end) || [];
		let paraText = '';

		// Track first sentence in this paragraph
		let isFirstSentenceInParagraph = true;

		for (let s of rawSentences) {
			if (!s.text) continue;

			let rects = [];
			let sentenceStart = null;
			let sentenceEnd = null;
			for (let [localStart, localEndInc] of s.ranges) {
				if (localStart === null || localEndInc === null) continue;

				let ss = Math.max(0, start + localStart);
				let ee = Math.min(start + localEndInc, chars.length - 1);
				if (ee < ss) continue;

				if (sentenceStart === null || ss < sentenceStart) sentenceStart = ss;
				if (sentenceEnd === null || ee > sentenceEnd) sentenceEnd = ee;

				let part = getRangeRects(chars, ss, ee);
				if (part && part.length) rects = rects.concat(part);
			}

			if (!rects.length || sentenceStart === null || sentenceEnd === null) continue;

			let sentence = {
				text: s.text,
				position: { pageIndex, rects },
				paragraphIndex: paragraphs.length,
				granularity: 'sentence',
				offsetStart: sentenceStart,
				offsetEnd: sentenceEnd
			};

			// Mark the first sentence of each paragraph
			if (isFirstSentenceInParagraph) {
				sentence.anchor = 'paragraphStart';
				isFirstSentenceInParagraph = false;
			}

			sentences.push(sentence);
			paraText = joinWithSpace(paraText, s.text);
		}

		if (paraRects.length && paraText) {
			paragraphs.push({
				anchor: 'paragraphStart',
				text: paraText,
				position: { pageIndex, rects: paraRects },
				granularity: 'paragraph',
				offsetStart: start,
				offsetEnd: end
			});
		}
	}

	return { paragraphs, sentences };
}

export function buildReadAloudSegments(chars, pageIndex) {
	if (!chars || !chars.length) {
		return { paragraphs: [], sentences: [] };
	}
	let paragraphRanges = paragraphsFromChars(chars);
	return buildReadAloudSegmentsFromRanges(chars, pageIndex, paragraphRanges);
}

export function getReadAloudSelectionBounds(selectionRanges) {
	if (!selectionRanges?.length || selectionRanges[0].collapsed) {
		return null;
	}

	let sortedRanges = [...selectionRanges];
	sortedRanges.sort((a, b) => {
		const pa = a.position.pageIndex;
		const pb = b.position.pageIndex;
		if (pa !== pb) {
			return pa - pb;
		}
		const aMin = Math.min(a.anchorOffset, a.headOffset);
		const bMin = Math.min(b.anchorOffset, b.headOffset);
		return aMin - bMin;
	});

	let startRange = sortedRanges[0];
	let endRange = sortedRanges[sortedRanges.length - 1];
	let startOffset = Math.min(startRange.anchorOffset, startRange.headOffset);
	let endOffset = Math.max(endRange.anchorOffset, endRange.headOffset) - 1;
	if (endOffset < startOffset) {
		return null;
	}

	return {
		selectionRanges: sortedRanges,
		start: {
			pageIndex: startRange.position.pageIndex,
			offset: startOffset
		},
		end: {
			pageIndex: endRange.position.pageIndex,
			offset: endOffset
		}
	};
}

export function buildReadAloudSegmentPart(chars, segment, pageIndex, offsetStart, offsetEnd, anchor) {
	if (offsetStart > offsetEnd || !chars?.length) {
		return null;
	}

	let start = Math.max(0, Math.min(offsetStart, chars.length - 1));
	let end = Math.max(0, Math.min(offsetEnd, chars.length - 1));
	if (start > end) {
		return null;
	}

	let rects = getRangeRects(chars, start, end);
	if (!rects?.length) {
		return null;
	}

	let text = getTextFromChars(chars.slice(start, end + 1));
	if (!text) {
		return null;
	}

	let next = {
		text,
		position: { pageIndex, rects },
		granularity: segment.granularity,
		anchor: anchor || null,
		offsetStart: start,
		offsetEnd: end
	};
	if (segment.paragraphIndex !== undefined) {
		next.paragraphIndex = segment.paragraphIndex;
	}
	return next;
}

export function splitReadAloudSegmentsBySelection(segments, selectionStart, selectionEnd, getCharsForPage) {
	let comparePos = (a, b) => {
		if (a.pageIndex !== b.pageIndex) {
			return a.pageIndex - b.pageIndex;
		}
		return a.offset - b.offset;
	};

	let hasOffsets = segments.every(segment =>
		Number.isInteger(segment.offsetStart) && Number.isInteger(segment.offsetEnd)
	);
	if (!hasOffsets) {
		return null;
	}

	let startIndex = segments.findIndex(segment => {
		let segEnd = { pageIndex: segment.position.pageIndex, offset: segment.offsetEnd };
		return comparePos(selectionStart, segEnd) <= 0;
	});
	if (startIndex === -1) {
		return null;
	}

	let endIndex = segments.findIndex(segment => {
		let segStart = { pageIndex: segment.position.pageIndex, offset: segment.offsetStart };
		return comparePos(selectionEnd, segStart) < 0;
	});
	if (endIndex === -1) {
		endIndex = segments.length;
	}
	if (startIndex >= endIndex) {
		return null;
	}

	let newSegments = [];
	let splitStartIndex = null;
	let splitEndIndex = null;

	for (let i = 0; i < segments.length; i++) {
		let segment = segments[i];
		if (i < startIndex || i >= endIndex) {
			newSegments.push(segment);
			continue;
		}

		let pageIndex = segment.position.pageIndex;
		let segStart = { pageIndex, offset: segment.offsetStart };
		let segEnd = { pageIndex, offset: segment.offsetEnd };

		let startWithin = i === startIndex
			&& comparePos(selectionStart, segStart) > 0
			&& comparePos(selectionStart, segEnd) <= 0;
		let endWithin = i === endIndex - 1
			&& comparePos(selectionEnd, segStart) >= 0
			&& comparePos(selectionEnd, segEnd) < 0;

		if (!startWithin && !endWithin) {
			if (i === startIndex) {
				splitStartIndex = newSegments.length;
			}
			newSegments.push(segment);
			if (i === endIndex - 1) {
				splitEndIndex = newSegments.length;
			}
			continue;
		}

		let chars = getCharsForPage?.(pageIndex);
		let middleAnchor = segment.anchor || null;
		if (startWithin) {
			let before = buildReadAloudSegmentPart(
				chars,
				segment,
				pageIndex,
				segment.offsetStart,
				selectionStart.offset - 1,
				middleAnchor
			);
			if (before) {
				newSegments.push(before);
				middleAnchor = null;
			}
		}

		let middleStart = startWithin ? selectionStart.offset : segment.offsetStart;
		let middleEnd = endWithin ? selectionEnd.offset : segment.offsetEnd;
		let middle = buildReadAloudSegmentPart(
			chars,
			segment,
			pageIndex,
			middleStart,
			middleEnd,
			middleAnchor
		);
		if (middle) {
			if (i === startIndex) {
				splitStartIndex = newSegments.length;
			}
			newSegments.push(middle);
			if (i === endIndex - 1 && endWithin) {
				splitEndIndex = newSegments.length;
			}
		}

		if (endWithin) {
			let after = buildReadAloudSegmentPart(
				chars,
				segment,
				pageIndex,
				selectionEnd.offset + 1,
				segment.offsetEnd,
				null
			);
			if (after) {
				newSegments.push(after);
			}
		}

		if (i === endIndex - 1 && !endWithin) {
			splitEndIndex = newSegments.length;
		}
	}

	if (splitStartIndex === null || splitEndIndex === null) {
		return null;
	}

	return {
		segments: newSegments,
		startIndex: splitStartIndex,
		endIndex: splitEndIndex
	};
}
