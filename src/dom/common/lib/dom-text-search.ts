export function executeSearch(
	nodes: CharacterData[],
	term: string,
	options: {
		caseSensitive: boolean,
		entireWord: boolean,
	}
): Range[] {
	if (!term) {
		return [];
	}
	
	let sectionText = '';
	const charDataRanges: CharDataRange[] = [];
	for (const charData of nodes) {
		const data = normalize(charData.data, options.caseSensitive);
		charDataRanges.push({
			charData,
			start: sectionText.length,
			end: sectionText.length + data.length - 1
		});
		sectionText += data;
	}

	const ranges = [];

	// https://stackoverflow.com/a/6969486
	let termRe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (options.entireWord) {
		termRe = '\\b' + termRe + '\\b';
	}
	const re = new RegExp(termRe, 'g');
	let matches;
	while ((matches = re.exec(sectionText))) {
		const [match] = matches;
		const range = new Range();
		const { charData: startCharData, start: startOffset } = binarySearch(charDataRanges, matches.index)!;
		range.setStart(startCharData, matches.index - startOffset);
		const { charData: endCharData, start: endOffset } = binarySearch(charDataRanges, matches.index + match.length)!;
		range.setEnd(endCharData, matches.index + match.length - endOffset);
		ranges.push(range);
	}

	return ranges;
}

function normalize(s: string, caseSensitive: boolean) {
	if (!caseSensitive) {
		s = s.toLowerCase();
	}
	return s
		// Remove smart quotes
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"');
}

function binarySearch(charDataRanges: CharDataRange[], pos: number) {
	let left = 0;
	let right = charDataRanges.length - 1;
	while (left <= right) {
		const mid = Math.floor((left + right) / 2);
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

type CharDataRange = {
	charData: CharacterData;
	start: number;
	end: number;
}

