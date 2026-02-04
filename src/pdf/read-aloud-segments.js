import { getRangeRects } from './lib/utilities';

const END_PUNCTUATION = new Set(['.', '!', '?', '…', '。', '！', '？']);
const TRAILING_CHARS = new Set(['"', "'", '”', '’', '»', '《', '》', ')', ']', '}', '›', '」', '』']);

let isLetter = (c) => /\p{L}/u.test(c);
let trimText = (s) => s.replace(/^ +| +$/g, '');
let joinWithSpace = (a, b) => {
	if (!a) return b;
	if (!b) return a;
	return a + ((a.at(-1) !== ' ' && !/[\p{P}]/u.test(b[0] || '')) ? ' ' : '') + b;
};

function getPrevWordInfo(chars, prevIdx) {
	if (prevIdx === null || prevIdx < 0) return { letters: '', startIdx: -1 };

	let s = prevIdx;
	while (s - 1 >= 0 && !chars[s - 1].wordBreakAfter) s--;

	let w = '';
	for (let k = s; k <= prevIdx; k++) {
		let ch = chars[k]?.c || '';
		if (isLetter(ch)) w += ch;
	}
	return { letters: w, startIdx: s };
}

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

function sentencesFromChars(chars) {
	const MIN_LEN = 30;

	let out = [];
	let buf = [];
	let ranges = [];
	let segStart = null;

	let append = (idx) => {
		let ch = chars[idx];
		// Skip ignorable characters for the textual content,
		// mirroring getTextFromChars behavior.
		if (ch.ignorable) return;

		buf.push(ch.c);

		// Match getTextFromChars:
		// - space after explicit spaces or line breaks
		// - and also after paragraph breaks
		if (ch.spaceAfter || ch.lineBreakAfter) {
			buf.push(' ');
		}
		if (ch.paragraphBreakAfter) {
			buf.push(' ');
		}
	};

	let flush = () => {
		let text = trimText(buf.join(''));
		if (text && ranges.length) {
			out.push({ text, ranges: ranges.slice() });
		}
		buf = [];
		ranges = [];
		segStart = null;
	};

	let consumeAfterPunct = (i) => {
		let endIdx = i;
		let j = i + 1;

		while (j < chars.length && END_PUNCTUATION.has(chars[j].c)) {
			append(j);
			endIdx = j;
			j++;
		}
		while (j < chars.length && TRAILING_CHARS.has(chars[j].c)) {
			append(j);
			endIdx = j;
			j++;
		}
		return { endIdx, nextI: j };
	};

	let hasSepBeforeWord = (startIdx) => {
		let bi = startIdx - 1;
		return (
			startIdx === 0 ||
			(bi >= 0 &&
				(chars[bi].spaceAfter ||
					chars[bi].lineBreakAfter ||
					chars[bi].paragraphBreakAfter))
		);
	};

	let dotOk = (word) => word.length >= 2 || (word.length > 0 && word === word.toLowerCase());

	for (let i = 0; i < chars.length;) {
		let ch = chars[i];
		if (!ch || ch.ignorable) {
			i++;
			continue;
		}
		if (segStart === null) segStart = i;

		append(i);

		if (END_PUNCTUATION.has(ch.c)) {
			// Sentence definitely ends at line/paragraph end or at the last char
			if (ch.lineBreakAfter || ch.paragraphBreakAfter || i === chars.length - 1) {
				let { endIdx, nextI } = consumeAfterPunct(i);
				ranges.push([segStart, endIdx]);
				flush();
				i = nextI;
				continue;
			}

			let prev = chars[i - 1];
			if (prev && prev.wordBreakAfter) {
				let { letters: prevWord, startIdx } = getPrevWordInfo(chars, i - 1);
				if (hasSepBeforeWord(startIdx) && (ch.c !== '.' || dotOk(prevWord))) {
					let { endIdx, nextI } = consumeAfterPunct(i);
					ranges.push([segStart, endIdx]);
					flush();
					i = nextI;
					continue;
				}
			}
		}

		i++;
	}

	if (segStart !== null) {
		ranges.push([segStart, Math.max(segStart, chars.length - 1)]);
		flush();
	}

	let merged = [];
	for (let k = 0; k < out.length; k++) {
		let cur = out[k];
		if (cur.text.length >= MIN_LEN) {
			merged.push(cur);
			continue;
		}
		let nxt = out[k + 1];
		if (nxt) {
			merged.push({
				text: joinWithSpace(cur.text, nxt.text),
				ranges: cur.ranges.concat(nxt.ranges)
			});
			k++;
		}
		else if (merged.length) {
			let prev = merged[merged.length - 1];
			prev.text = joinWithSpace(prev.text, cur.text);
			prev.ranges = prev.ranges.concat(cur.ranges);
		}
		else {
			merged.push(cur);
		}
	}
	return merged;
}

function buildReadAloudSegmentsFromRanges(chars, pageIndex, paragraphRanges) {
	if (!chars || !chars.length || !paragraphRanges || !paragraphRanges.length) {
		return { paragraphs: [], sentences: [] };
	}

	let paragraphs = [];
	let sentences = [];

	for (let [start, end] of paragraphRanges) {
		if (start === null || end === null || start > end) continue;

		let paraChars = chars.slice(start, end + 1);
		let rawSentences = sentencesFromChars(paraChars);

		let paraRects = [];
		let paraText = '';

		// Track first sentence in this paragraph
		let isFirstSentenceInParagraph = true;

		for (let s of rawSentences) {
			if (!s.text) continue;

			let rects = [];
			for (let [localStart, localEndInc] of s.ranges) {
				if (localStart === null || localEndInc === null) continue;

				let ss = Math.max(0, start + localStart);
				let ee = Math.min(start + localEndInc, chars.length - 1);
				if (ee < ss) continue;

				let part = getRangeRects(chars, ss, ee);
				if (part && part.length) rects = rects.concat(part);
			}

			if (!rects.length) continue;

			let sentence = {
				text: s.text,
				position: { pageIndex, rects }
			};

			// Mark the first sentence of each paragraph
			if (isFirstSentenceInParagraph) {
				sentence.anchor = 'paragraphStart';
				isFirstSentenceInParagraph = false;
			}

			sentences.push(sentence);
			paraRects = paraRects.concat(rects);
			paraText = joinWithSpace(paraText, s.text);
		}

		if (paraRects.length && paraText) {
			paragraphs.push({
				anchor: 'paragraphStart',
				text: paraText,
				position: { pageIndex, rects: paraRects }
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
