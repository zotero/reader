export function getSelectionRanges(selection: Selection): Range[] {
	const ranges = [];
	for (let i = 0; i < selection.rangeCount; i++) {
		ranges.push(selection.getRangeAt(i));
	}
	return ranges;
}
