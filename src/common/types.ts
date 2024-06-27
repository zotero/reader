import { Selector } from "../dom/common/lib/selector";

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
	image?: string;
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
	annotationID?: string;
	position?: Position;
	href?: string;
	scrollCoords?: [number, number];
};

export type Position = PDFPosition | Selector;

export type PDFPosition = {
	pageIndex: number;
	rects?: number[][];
	paths?: number[][];
};

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
	fontFamily?: string;
};

export type AnnotationPopupParams<A extends Annotation = Annotation> = {
	rect: ArrayRect;
	annotation?: A | null;
}

export type SelectionPopupParams<A extends Annotation = Annotation> = {
	rect: ArrayRect;
	annotation?: NewAnnotation<A> | null;
}


export type OverlayPopupParams = {
	type: string;
	url?: string;
	css?: string;
	content?: string;
	rect: ArrayRect;
	ref: Node;
};

export type ArrayRect = [left: number, top: number, right: number, bottom: number];

export type FindState = {
	popupOpen: boolean;
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
		snippets: string[]
	} | null;
};

export type MaybePromise<T> = Promise<T> | T;
