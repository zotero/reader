declare interface Window {
	rtl?: boolean;

	dev?: boolean;

	DarkReader: typeof import('darkreader');

	zoteroPrint?: (options?: { overrideSettings?: Record<string, string> }) => Promise<void>;
}

declare interface Document {
	// Firefox-only equivalent of caretRangeFromPoint
	caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
}

declare interface CaretPosition {
	offsetNode: Node;
	offset: number;
	getClientRect(): DOMRect;
}
