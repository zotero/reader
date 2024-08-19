export function executeSearch(
	context: InternalSearchContext,
	term: string,
	options: {
		caseSensitive: boolean,
		entireWord: boolean,
	}
): Promise<InternalOutputRange[]> {
	// @ts-ignore
	let worker = new Worker(new URL('./worker.ts', import.meta.url));
	return new Promise<InternalOutputRange[]>((resolve, reject) => {
		worker.onmessage = (event) => {
			resolve(event.data);
		};
		worker.onerror = (event) => {
			reject(event.error);
		};
		worker.postMessage({ context, term, options });
	});
}

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
