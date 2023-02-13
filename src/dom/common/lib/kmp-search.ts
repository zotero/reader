/**
 * Implements the K-M-P string search algorithm for DOM CharacterData nodes based on pseudocode from
 * https://en.wikipedia.org/wiki/Knuth%E2%80%93Morris%E2%80%93Pratt_algorithm#KMP_algorithm.
 */
export function kmpSearch(
	charDatas: CharacterData[],
	term: string,
	options: {
		caseSensitive: boolean,
		entireWord: boolean,
	}
): Range[] {
	term = normalize(term, options.caseSensitive);
	const table = makeKMPTable(term);
	
	let s = '';
	let sPos = 0;
	let termPos = 0;
	const ranges: Range[] = [];

	const charDataRanges: CharDataRange[] = [];
	for (const charData of charDatas) {
		const data = normalize(charData.data, options.caseSensitive);
		charDataRanges.push({
			charData,
			start: s.length,
			end: s.length + data.length - 1
		});
		s += data;
	}
	
	while (sPos < s.length) {
		if (term[termPos] == s[sPos]) {
			sPos++;
			termPos++;
			if (termPos == term.length) {
				const range = new Range();
				const absoluteStart = sPos - termPos;
				const { charData: startCharData, start: startOffset } = binarySearch(charDataRanges, absoluteStart)!;
				range.setStart(startCharData, absoluteStart - startOffset);
				const absoluteEnd = sPos - termPos + term.length;
				const { charData: endCharData, start: endOffset } = binarySearch(charDataRanges, absoluteEnd)!;
				range.setEnd(endCharData, absoluteEnd - endOffset);
				
				if (options.entireWord) {
					const beforeAbsoluteStart = absoluteStart - 1;
					const beforeStartNode = binarySearch(charDataRanges, beforeAbsoluteStart);
					const afterAbsoluteEnd = absoluteEnd;
					const afterEndNode = binarySearch(charDataRanges, afterAbsoluteEnd);
					if ((!beforeStartNode || /\W/.test(beforeStartNode.charData.data[beforeAbsoluteStart - beforeStartNode.start]))
						&& (!afterEndNode || /\W/.test(afterEndNode.charData.data[afterAbsoluteEnd - afterEndNode.start]))) {
						ranges.push(range);
					}
				}
				else {
					ranges.push(range);
				}
				
				termPos = table[termPos];
			}
		}
		else {
			termPos = table[termPos];
			if (termPos < 0) {
				sPos++;
				termPos++;
			}
		}
	}

	return ranges;
}

export function makeKMPTable(term: string): number[] {
	const table = [-1];
	let cnd = 0;
	for (let pos = 1; pos < term.length; pos++, cnd++) {
		if (term[pos] == term[cnd]) {
			table.push(table[cnd]);
		}
		else {
			table.push(cnd);
			while (cnd >= 0 && term[pos] != term[cnd]) {
				cnd = table[cnd];
			}
		}
	}
	table.push(cnd);
	return table;
}

function normalize(s: string, caseSensitive: boolean) {
	if (!caseSensitive) {
		s = s.toLowerCase();
	}
	return s
		// Remove smart quotes
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		// Normalize spaces
		.replace(/\s+/g, ' ');
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

