export type InternalSearchContext = {
	text: string;
	internalCharDataRanges: InternalCharDataRange[];
}

export type InternalCharDataRange = {
	charDataID: number;
	start: number;
	end: number;
}

export type InternalOutputRange = {
	startCharDataID: number;
	endCharDataID: number;
	startIndex: number;
	endIndex: number;
}
