function getCharacterFlowClass(char) {
	return char?.flowClass ?? 'body';
}

export function isolateCharsToAnchorFlow(chars, anchorAtStart) {
	let hasFlowMetadata = chars.some(char => (
		Object.prototype.hasOwnProperty.call(char, 'flowClass')
	));
	if (!hasFlowMetadata || !chars.length) {
		return null;
	}
	let anchorChar = anchorAtStart ? chars[0] : chars.at(-1);
	let headChar = anchorAtStart ? chars.at(-1) : chars[0];
	let flowClass = getCharacterFlowClass(anchorChar);
	// Different endpoint flows express a cross-flow selection. Preserve the
	// user's complete sweep instead of choosing one endpoint as authoritative.
	if (flowClass !== getCharacterFlowClass(headChar)) {
		return null;
	}
	return chars.filter(char => getCharacterFlowClass(char) === flowClass);
}

export function splitContinuousCharRuns(chars) {
	let runs = [];
	for (let char of chars) {
		let run = runs.at(-1);
		let previous = run?.at(-1);
		if (!run
				|| char.pageIndex !== previous.pageIndex
				|| char.offset !== previous.offset + 1) {
			run = [];
			runs.push(run);
		}
		run.push(char);
	}
	return runs;
}
