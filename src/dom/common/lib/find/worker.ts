import type { InternalCharDataRange, InternalOutputRange, InternalSearchContext } from "./internal-types";
import { FIND_MAX_TOTAL_MATCHES } from "../../../../common/defines";
import { compileFindRegExp } from "../../../../common/lib/find-pattern";

onmessage = async (event) => {
	let { context, term, options } = event.data;
	postMessage(executeSearch(context, term, options));
};

export function executeSearch(
	context: InternalSearchContext,
	term: string,
	options: {
		caseSensitive: boolean,
		entireWord: boolean,
		useRegex?: boolean,
	}
): InternalOutputRange[] {
	if (!term) {
		return [];
	}

	let { text, internalCharDataRanges } = context;
	let ranges: InternalOutputRange[] = [];

	// https://stackoverflow.com/a/6969486
	let termRe = options.useRegex
		? normalize(term)
		: normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (options.entireWord) {
		termRe = '\\b(?:' + termRe + ')\\b';
	}
	let flags = 'g' + (options.caseSensitive ? '' : 'i');
	let re;
	if (options.useRegex) {
		re = compileFindRegExp(termRe, flags);
		if (!re) {
			return [];
		}
	}
	else {
		re = new RegExp(termRe, flags);
	}
	let matches;
	while ((matches = re.exec(text))) {
		let [match] = matches;
		if (!match.length) {
			// A pattern like 'a*' can match an empty string, which would
			// otherwise loop forever
			re.lastIndex++;
			continue;
		}
		let { charDataID: startCharDataID, start: startOffset } = binarySearch(internalCharDataRanges, matches.index)!;
		let { charDataID: endCharDataID, start: endOffset } = binarySearch(internalCharDataRanges, matches.index + match.length)!;
		ranges.push({
			startCharDataID,
			startIndex: matches.index - startOffset,
			endCharDataID,
			endIndex: matches.index + match.length - endOffset,
		});
		if (ranges.length >= FIND_MAX_TOTAL_MATCHES) {
			break;
		}
	}

	return ranges;
}

function normalize(s: string) {
	return s
		// Remove smart quotes
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"');
}

function binarySearch(charDataRanges: InternalCharDataRange[], pos: number) {
	let left = 0;
	let right = charDataRanges.length - 1;
	while (left <= right) {
		let mid = Math.floor((left + right) / 2);
		if (charDataRanges[mid].start <= pos && pos <= charDataRanges[mid].end) {
			return charDataRanges[mid];
		}
		else if (pos < charDataRanges[mid].start) {
			right = mid - 1;
		}
		else {
			left = mid + 1;
		}
	}
	return null;
}
