import {
	Annotation,
	AnnotationPopupParams,
	AnnotationType,
	ArrayRect,
	WADMAnnotation,
	FindPopupParams,
	NewAnnotation,
	OutlineItem,
	OverlayPopupParams,
	SelectionPopupParams,
	Tool,
	ViewStats,
	NavLocation,
} from "../../common/types";
import PopupDelayer from "../../common/lib/popup-delayer";
import ReactDOM from "react-dom";
import {
	AnnotationOverlay,
	DisplayedAnnotation
} from "./components/overlay/annotation-overlay";
import React from "react";
import { IGNORE_CLASS } from "../epub/defines";
import {
	Selector
} from "./lib/selector";
import {
	makeRangeSpanning,
	moveRangeEndsIntoTextNodes
} from "./lib/range";
import { getSelectionRanges } from "./lib/selection";
import FindProcessor from "./find";
import { SELECTION_COLOR } from "../../common/defines";

abstract class DOMView<State> {
	protected readonly _container: Element;

	protected _tool: Tool;

	protected _selectedAnnotationIDs: string[];

	protected _annotations!: WADMAnnotation[];

	protected _annotationsByID!: Map<string, WADMAnnotation>;

	protected _showAnnotations: boolean;

	protected _annotationPopup: AnnotationPopupParams<WADMAnnotation> | null;

	protected _selectionPopup: SelectionPopupParams<WADMAnnotation> | null;

	protected _overlayPopup: OverlayPopupParams | null;

	protected _findPopup: FindPopupParams | null;

	protected abstract _findProcessor: FindProcessor | null;

	protected _viewState: Partial<State>;

	protected readonly _options: DOMViewOptions<State>;

	protected _overlayPopupDelayer: PopupDelayer;

	protected _disableAnnotationPointerEvents = false;

	protected _highlightedPosition: Selector | null = null;

	protected constructor(options: DOMViewOptions<State>) {
		this._options = options;
		this._container = options.container;

		// The variables below are from reader._state and are constantly updated
		// using setTool, setAnnotation, etc.

		// Tool type can be 'highlight', 'note' or 'pointer' (no tool at all), also 'underline' in future
		this._tool = options.tool;
		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		this.setAnnotations(options.annotations);
		// Don't show annotations if this is false
		this._showAnnotations = options.showAnnotations;
		this._annotationPopup = options.annotationPopup;
		this._selectionPopup = options.selectionPopup;
		this._overlayPopup = options.overlayPopup;
		this._findPopup = options.findPopup;
		this._viewState = options.viewState || {};
		this._overlayPopupDelayer = new PopupDelayer({ open: !!this._overlayPopup });
	}

	// ***
	// Utilities for annotations - abstractions over the specific types of selectors used by the two views
	// ***

	abstract toSelector(range: Range): Selector | null;

	abstract toDisplayedRange(selector: Selector): Range | null;
	
	protected abstract _navigateToSelector(selector: Selector): void;

	// ***
	// Abstractions over document structure
	// ***
	
	protected abstract _getSelectorSection(selector: Selector): number;

	protected abstract _getSectionRoot(section: number): ParentNode | null;

	protected abstract _getSectionAnnotations(section: number): WADMAnnotation[];

	protected abstract _getViewportBoundingRect(range: Range): DOMRect;
	
	protected abstract _getSelection(): Selection | null;

	protected abstract _getAnnotationFromTextSelection(type: AnnotationType, color?: string): NewAnnotation<WADMAnnotation> | null;
	
	protected abstract _updateViewState(): void;
	
	protected abstract _updateViewStats(): void;

	// ***
	// Utilities for subclasses - should be called in appropriate event handlers
	// ***
	
	protected _handleViewUpdate() {
		this._updateViewState();
		this._updateViewStats();
		// Update annotation popup position
		if (this._annotationPopup) {
			const { annotation } = this._annotationPopup;
			if (annotation) {
				// Note: There is currently a bug in React components part therefore the popup doesn't
				// properly update its position when window is resized
				this._openAnnotationPopup(annotation as WADMAnnotation);
			}
		}
		// Update selection popup position
		if (this._selectionPopup) {
			const selection = this._getSelection();
			if (selection) {
				this._openSelectionPopup(selection);
			}
		}
		// Close overlay popup
		this._options.onSetOverlayPopup();
	}
	
	protected _renderAnnotations(section: number) {
		const root = this._getSectionRoot(section);
		if (!root) {
			return;
		}
		const doc = root.ownerDocument!;
		let container = root.querySelector('#annotation-overlay-' + section);
		if (!container) {
			container = doc.createElement('div');
			container.id = 'annotation-overlay-' + section;
			container.classList.add(IGNORE_CLASS);
			root.append(container);
		}
		const displayedAnnotations: DisplayedAnnotation[] = [
			...this._getSectionAnnotations(section).map(a => ({
				id: a.id,
				type: a.type,
				color: a.color,
				text: a.text,
				hasComment: !!a.comment,
				range: this.toDisplayedRange(a.position),
			})).filter(a => !!a.range) as DisplayedAnnotation[],
			...this._findProcessor?.getSectionAnnotations(section) ?? []
		];
		if (this._highlightedPosition) {
			displayedAnnotations.push({
				type: 'highlight',
				color: SELECTION_COLOR,
				hasComment: false,
				range: this.toDisplayedRange(this._highlightedPosition)!,
			});
		}
		ReactDOM.render((
			<AnnotationOverlay
				annotations={displayedAnnotations}
				selectedAnnotationIDs={this._selectedAnnotationIDs}
				onSelect={id => this._openAnnotationPopup(this._annotationsByID.get(id)!)}
				onDragStart={(dataTransfer, id) => {
					this._options.onSetDataTransferAnnotations(dataTransfer, this._annotationsByID.get(id)!);
				}}
				onResize={(id, range) => this._handleAnnotationResize(id, range)}
				disablePointerEvents={this._disableAnnotationPointerEvents}
			/>
		), container);
	}

	protected _openSelectionPopup(selection: Selection) {
		if (selection.isCollapsed) {
			return;
		}
		const range = moveRangeEndsIntoTextNodes(makeRangeSpanning(...getSelectionRanges(selection)));
		const domRect = this._getViewportBoundingRect(range);
		const rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		const annotation = this._getAnnotationFromTextSelection('highlight');
		if (annotation) {
			this._options.onSetSelectionPopup({ rect, annotation });
		}
	}

	protected _openAnnotationPopup(annotation: WADMAnnotation) {
		// Note: Popup won't be visible if sidebar is opened
		const range = this.toDisplayedRange(annotation.position);
		if (!range) {
			return;
		}
		const domRect = this._getViewportBoundingRect(range);
		const rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		this._options.onSelectAnnotations([annotation.id]);
		this._options.onSetAnnotationPopup({ rect, annotation });
	}

	protected _openExternalLinkOverlayPopup(linkNode: HTMLAnchorElement) {
		const range = linkNode.ownerDocument.createRange();
		range.selectNode(linkNode);
		const domRect = this._getViewportBoundingRect(range);
		const rect: ArrayRect = [domRect.left, domRect.top, domRect.right, domRect.bottom];
		const overlayPopup = {
			type: 'external-link',
			url: linkNode.href,
			rect,
			ref: linkNode
		};
		this._options.onSetOverlayPopup(overlayPopup);
	}

	// ***
	// Event handlers
	// ***

	private _handleAnnotationResize(id: string, range: Range) {
		if (!range.toString().length
			// Just bail if the browser thinks the mouse is over the SVG - that seems to only happen momentarily
			|| range.startContainer.nodeType == Node.ELEMENT_NODE && (range.startContainer as Element).closest('svg')
			|| range.endContainer.nodeType == Node.ELEMENT_NODE && (range.endContainer as Element).closest('svg')) {
			return;
		}

		const annotation = this._annotationsByID.get(id)!;
		const selector = this.toSelector(moveRangeEndsIntoTextNodes(range));
		if (!selector) {
			// Probably resized past the end of a section - don't worry about it
			return;
		}
		annotation.position = selector;
		annotation.text = range.toString();
		this._options.onUpdateAnnotations([annotation]);
	}

	protected _handleCopy(event: ClipboardEvent) {
		if (!event.clipboardData) {
			return;
		}
		if (this._selectedAnnotationIDs.length) {
			// It's enough to provide only one of selected annotations,
			// others will be included automatically by _onSetDataTransferAnnotations
			const annotation = this._annotationsByID.get(this._selectedAnnotationIDs[0]);
			if (!annotation) {
				return;
			}
			console.log('Copying annotation', annotation);
			this._options.onSetDataTransferAnnotations(event.clipboardData, annotation);
		}
		else {
			const annotation = this._getAnnotationFromTextSelection('highlight');
			if (!annotation) {
				return;
			}
			console.log('Copying text', annotation);
			this._options.onSetDataTransferAnnotations(event.clipboardData, annotation, true);
		}
		event.preventDefault();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setAnnotations(annotations: WADMAnnotation[]) {
		// Individual annotation object reference changes only if that annotation was modified,
		// so it's possible to do rendering optimizations by skipping other annotations
		this._annotations = annotations;
		this._annotationsByID = new Map(annotations.map(a => [a.id, a]));
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	navigate(location: NavLocation) {
		if (location.annotationID) {
			const annotation = this._annotationsByID.get(location.annotationID);
			if (!annotation) {
				return;
			}
			const selector = annotation.position;
			this._navigateToSelector(selector);
		}
		else if (location.position) {
			const selector = location.position as Selector;
			this._navigateToSelector(selector);
			this._highlightedPosition = selector;

			const section = this._getSelectorSection(selector);
			this._renderAnnotations(section);
			setTimeout(() => {
				this._highlightedPosition = null;
				this._renderAnnotations(section);
			}, 2000);
		}
	}
}

export type DOMViewOptions<State> = {
	portal?: boolean;
	container: Element;
	tool: Tool;
	selectedAnnotationIDs: string[];
	annotations: WADMAnnotation[];
	showAnnotations: boolean;
	annotationPopup: AnnotationPopupParams<WADMAnnotation> | null;
	selectionPopup: SelectionPopupParams<WADMAnnotation> | null;
	overlayPopup: OverlayPopupParams | null;
	findPopup: FindPopupParams | null;
	viewState?: State;
	onSetOutline: (outline: OutlineItem[]) => void;
	onChangeViewState: (state: State, primary?: boolean) => void;
	onChangeViewStats: (stats: ViewStats) => void;
	onSetDataTransferAnnotations: (dataTransfer: DataTransfer, annotation: NewAnnotation<WADMAnnotation>, fromText?: boolean) => void;
	onAddAnnotation: (annotation: NewAnnotation<WADMAnnotation>, select?: boolean) => void;
	onUpdateAnnotations: (annotations: Annotation[]) => void;
	onOpenLink: (url: string) => void;
	onSelectAnnotations: (ids: string[]) => void;
	onSetSelectionPopup: (params?: SelectionPopupParams<WADMAnnotation> | null) => void;
	onSetAnnotationPopup: (params?: AnnotationPopupParams<WADMAnnotation> | null) => void;
	onSetOverlayPopup: (params?: OverlayPopupParams) => void;
	onSetFindPopup: (params?: FindPopupParams) => void;
	onOpenViewContextMenu: (params: { x: number, y: number }) => void;
	onFocus: () => void;
	onTabOut: (isShiftTab?: boolean) => void;
	onKeyDown: (event: KeyboardEvent) => void;
	buf: ArrayBuffer;
};

export default DOMView;
