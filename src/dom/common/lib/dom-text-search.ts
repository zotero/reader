export function executeSearch(
	context: SearchContext,
	term: string,
	options: {
		caseSensitive: boolean,
		entireWord: boolean,
	}
): Range[] {
	if (!term) {
		return [];
	}
	
	let { text, charDataRanges } = context;
	let ranges = [];

	// https://stackoverflow.com/a/6969486
	let termRe = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (options.entireWord) {
		termRe = '\\b' + termRe + '\\b';
	}
	let re = new RegExp(termRe, 'g' + (options.caseSensitive ? '' : 'i'));
	let matches;
	while ((matches = re.exec(text))) {
		let [match] = matches;
		let range = new Range();
		let { charData: startCharData, start: startOffset } = binarySearch(charDataRanges, matches.index)!;
		range.setStart(startCharData, matches.index - startOffset);
		let { charData: endCharData, start: endOffset } = binarySearch(charDataRanges, matches.index + match.length)!;
		range.setEnd(endCharData, matches.index + match.length - endOffset);
		ranges.push(range);
	}

	return ranges;
}

export function createSearchContext(nodes: CharacterData[]): SearchContext {
	let text = '';
	let charDataRanges: CharDataRange[] = [];
	for (let charData of nodes) {
		let data = normalize(charData.data);
		charDataRanges.push({
			charData,
			start: text.length,
			end: text.length + data.length - 1,
		});
		text += data;
	}
	return { text, charDataRanges };
}

function normalize(s: string) {
	return s
		// Remove smart quotes
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"');
}

function binarySearch(charDataRanges: CharDataRange[], pos: number) {
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

export type SearchContext = {
	text: string;
	charDataRanges: CharDataRange[];
}

export type CharDataRange = {
	charData: CharacterData;
	start: number;
	end: number;
}

