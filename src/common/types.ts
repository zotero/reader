import type { Selector } from "../dom/common/lib/selector";
import type { ReflowableAppearance } from "../dom/common/lib/appearance";

export type ToolType =
	| 'highlight'
	| 'underline'
	| 'note'
	| 'image'
	| 'text'
	| 'ink'
	| 'eraser'
	| 'pointer';

export type Tool = {
	type: ToolType;
	color?: string;
}

export type Platform = 'web' | 'zotero' | 'ios' | 'android';

export type AnnotationType =
	| 'highlight'
	| 'underline'
	| 'note'
	| 'image'
	| 'text'
	| 'ink'
	| 'eraser';

export interface Annotation {
	id: string;
	type: AnnotationType;
	color?: string;
	sortIndex: string;
	pageLabel?: string;
	position: Position;
	text?: string;
	comment?: string;
	tags: string[];
	dateCreated: string;
	dateModified: string;
	readOnly?: boolean;
	authorName: string;
	isAuthorNameAuthoritative: boolean;
}

export interface PDFAnnotation extends Annotation {
	position: PDFPosition;
}

export interface WADMAnnotation extends Annotation {
	position: Selector;
}

export type NavLocation = {
	pageNumber?: string;
	pageIndex?: number;
	annotationID?: string;
	position?: Position;
	href?: string;
	scrollCoords?: [number, number];
	scrollYPercent?: number;
};

export type Position = PDFPosition | Selector | SDTPosition;

/**
 * A position in the source document's own coordinate system, as stored in
 * annotations and view states: PDFPosition for PDFs, a WADM Selector for
 * EPUBs and snapshots.
 */
export type SourcePosition = Exclude<Position, SDTPosition>;

export type PDFPosition = {
	pageIndex: number;
	rects?: number[][];
	paths?: number[][];
	nextPageRects?: number[][];
};

/**
 * A range in a Structured Document Text content tree. Each endpoint is a
 * content point per the SDT schema: a path of child indices leading to a
 * text node, followed by a character offset within that node's text.
 * Endpoints can be compared with compareRefs() and split into
 * { ref, offset } with splitContentPoint() from the
 * structured-document-text module.
 */
export type SDTPosition = {
	start: number[];
	end: number[];
};

export function isSDTPosition(position: unknown): position is SDTPosition {
	return !!position
		&& typeof position === 'object'
		&& Array.isArray((position as SDTPosition).start)
		&& Array.isArray((position as SDTPosition).end);
}

type NewAnnotationOptionalFields =
	'id'
	| 'tags'
	| 'dateCreated'
	| 'dateModified'
	| 'authorName'
	| 'isAuthorNameAuthoritative';

export type NewAnnotation<A extends Annotation = Annotation>
	= Omit<A, NewAnnotationOptionalFields> & Partial<Pick<A, NewAnnotationOptionalFields>>;

export type OutlineItem = {
	title: string;
	// The whole location will be passed to navigate() once user clicks the item
	location: NavLocation;
	items?: OutlineItem[];
	expanded?: boolean;
};

export type ViewStats = {
	pageIndex?: number;
	pageLabel?: string;
	pagesCount?: number;
	usePhysicalPageNumbers?: boolean;
	canCopy: boolean;
	canZoomOut: boolean;
	canZoomIn: boolean;
	canZoomReset: boolean;
	canNavigateBack?: boolean;
	canNavigateForward?: boolean;
	canNavigateToFirstPage?: boolean;
	canNavigateToLastPage?: boolean;
	canNavigateToPreviousPage?: boolean;
	canNavigateToNextPage?: boolean;
	canNavigateToPreviousSection?: boolean;
	canNavigateToNextSection?: boolean;
	zoomAutoEnabled?: boolean;
	zoomPageWidthEnabled?: boolean;
	zoomPageHeightEnabled?: boolean;
	scrollMode?: number;
	spreadMode?: number;
	flowMode?: string;
	appearance?: Partial<ReflowableAppearance>;
	fixedLayout?: boolean;
	outlinePath?: number[];
};

export type AnnotationPopupParams<A extends Annotation = Annotation> = {
	rect: ArrayRect;
	annotation?: A | null;
}

export type SelectionPopupParams<A extends Annotation = Annotation> = {
	rect: ArrayRect;
	anchorPoint?: ArrayPoint;
	annotation?: NewAnnotation<A> | null;
	preferTop?: boolean;
	preferLeft?: boolean;
}

type FootnotePopupParams = {
	type: 'footnote';
	content: string;
	css: string;
	rect: ArrayRect;
	ref: Node;
}

type LinkPopupParams = {
	type: 'link';
	url: string;
}

type ImagePopupParams = {
	type: 'image';
	src: string;
	title?: string;
	alt?: string;
	rect: ArrayRect;
}

export type ReferenceChar = {
	c: string;
	bold?: boolean;
	italic?: boolean;
	url?: string;
	ignorable?: boolean;
	spaceAfter?: boolean;
	lineBreakAfter?: boolean;
}

export type OverlayReference = {
	// Stable only within the currently loaded structured document.
	sourceKey: string;
	position: PDFPosition;
	text: string;
	chars: ReferenceChar[];
}

type ReferencePopupParams = {
	source: 'sdt';
	rect: ArrayRect;
	position: PDFPosition;
	references: OverlayReference[];
	persistent?: boolean;
} & ({ type: 'citation' } | { type: 'reference' })

export type OverlayPopupParams =
	| FootnotePopupParams
	| LinkPopupParams
	| ImagePopupParams
	| ReferencePopupParams;

export type ReferencePart = {
	text: string;
}

export type ReferenceAction =
	| 'add-to-library'
	| 'show-in-library'
	| 'open-attachment'
	| 'view-online';

export type ReferenceDisplayData = {
	itemType: string;
	title: string;
	firstCreator: string | null;
	year: string | null;
	abstract?: string | null;
}

export type ReferenceResultDTO = {
	// Opaque host token. It must not expose an item, attachment, or library ID.
	resultID: string;
	libraryState: 'existing' | 'unsaved';
	display: ReferenceDisplayData;
	actions: ReferenceAction[];
}

export type ReferenceLookupStatus =
	| 'strong'
	| 'no-match'
	| 'invalid'
	| 'offline'
	| 'rate-limited'
	| 'timeout'
	| 'cancelled'
	| 'error'
	| 'expired'
	| 'incomplete';

export type MatchReferenceRequest = {
	requestID: string;
	sourceKey: string;
	referenceParts: ReferencePart[];
}

export type FindReferenceOnlineRequest = {
	requestID: string;
	referenceKey: string;
}

export type ReferenceLookupResponse = {
	requestID: string;
	// A positive online result restored by the local callback, without network work.
	lookupSource?: 'online';
} & ({
	status: 'strong';
	result: ReferenceResultDTO;
	referenceKey: string;
} | {
	status: 'no-match';
	result?: never;
	referenceKey: string;
} | {
	status: Exclude<ReferenceLookupStatus, 'strong' | 'no-match'>;
	result?: never;
	referenceKey?: string;
})

export type PerformReferenceActionRequest = {
	requestID: string;
	referenceKey: string;
	resultID: string;
	action: ReferenceAction;
}

export type ReferenceActionResponse = {
	requestID: string;
	referenceKey: string;
	status:
		| 'ok'
		| 'existing'
		| 'saved'
		| 'stale'
		| 'failed'
		| 'duplicate-conflict';
	result?: ReferenceResultDTO;
}

export type ReferencePopupCallbacks = {
	onMatchReference?: (
		request: MatchReferenceRequest,
		callback: (response: ReferenceLookupResponse) => void
	) => void;
	onFindReferenceOnline?: (
		request: FindReferenceOnlineRequest,
		callback: (response: ReferenceLookupResponse) => void
	) => void;
	onCancelReferenceLookup?: (request: { requestID: string }) => void;
	onPerformReferenceAction?: (
		request: PerformReferenceActionRequest,
		callback: (response: ReferenceActionResponse) => void
	) => void;
}

export type ArrayRect = [left: number, top: number, right: number, bottom: number];

export type ArrayPoint = [x: number, y: number];

export type FindState = {
	popupOpen?: boolean;
	active: boolean;
	query: string;
	highlightAll: boolean;
	caseSensitive: boolean;
	entireWord: boolean;
	// For mobile app to focus specific result
	index: number | null,
	result: {
		total: number,
		index: number,
		// Mobile app lists all results in a popup
		snippets: string[],
		annotation?: NewAnnotation,
		// Used for a11y notifications
		currentSnippet: string,
		currentPageLabel: string | null
	} | null;
};

export type ReadAloudAnnotationPopup = {
	annotation: Annotation;
	baseSegmentIndex: number;
	startSegmentIndex: number;
	endSegmentIndex: number;
	segments: ReadAloudSegment[];
};

/**
 * UI-only state stored on the React state tree.
 * Engine state (playback, segments, and voice) lives in ReadAloudManager.
 */
export type ReadAloudState = {
	popupOpen: boolean;
	lang?: string;
	annotationPopup: ReadAloudAnnotationPopup | null;
	segmentAnnotations: Map<number, string>;
	savedPosition?: Position | null;
	highlightGranularity: ReadAloudGranularity;
};

/**
 * Composed state pushed to views for display (spotlights and scrolling)
 * and segment computation.
 */
export type ReadAloudStateSnapshot = {
	popupOpen: boolean;
	active: boolean;
	paused: boolean;
	segmentGranularity: ReadAloudGranularity | null;
	highlightGranularity: ReadAloudGranularity;
	segments: ReadAloudSegment[] | null;
	activeSegment: ReadAloudSegment | null;
	activeWordSourcePosition: SourcePosition | null;
	lang: string | null;
	lastSkipGranularity: ReadAloudGranularity | null;
	annotationPopup: ReadAloudAnnotationPopup | null;
};

/**
 * Modifications to composed state that can be returned by views
 * using onSetReadAloudState().
 */
export type ReadAloudStateDelta = {
	targetPosition?: Position;
	lang?: string | null;
};

export type ReadAloudSegment = {
	position: SDTPosition;

	/**
	 * The segment's position in the source document's coordinate system,
	 * materialized by the reader when segments are built so views only
	 * have to display it.
	 */
	sourcePosition?: SourcePosition | null;

	/**
	 * Like sourcePosition, but spanning the whole logical paragraph the
	 * segment belongs to.
	 */
	paragraphSourcePosition?: SourcePosition | null;
	text: string;
	granularity: ReadAloudGranularity;
	anchor: 'paragraphStart' | null;
};

export type ReadAloudGranularity = 'paragraph' | 'sentence' | 'word';

export type ReadAloudTimestamp = {
	start: number;
	end: number;
	charStart: number;
	charEnd: number;
};

export type MaybePromise<T> = Promise<T> | T;

export type ColorScheme = 'light' | 'dark';

export type Theme = {
	id: string;
	label: string;
	background: string;
	foreground: string;
	invertImages?: boolean;
};

export type ViewContextMenuOverlay =
	| {
		type: 'external-link';
		url: string;
	}
	| {
		type: 'math';
		tex: string;
	}
	| {
		type: 'image';
		image: ImageBitmapSource;
	};
