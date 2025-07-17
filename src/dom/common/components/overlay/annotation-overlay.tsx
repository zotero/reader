import React, {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import {
	caretPositionFromPoint,
	collapseToOneCharacterAtStart,
	getBoundingPageRect,
	getColumnSeparatedPageRects,
	getPageRects,
	splitRangeToTextNodes,
	supportsCaretPositionFromPoint
} from "../../lib/range";
import { AnnotationType } from "../../../../common/types";
import ReactDOM from "react-dom";
import { IconNoteLarge } from "../../../../common/components/common/icons";
import { closestElement, isRTL, isVertical } from "../../lib/nodes";
import { isSafari } from "../../../../common/lib/utilities";
import { expandRect, getBoundingRect, rectsEqual } from "../../lib/rect";
import cx from "classnames";

export type DisplayedAnnotation = {
	id?: string;
	sourceID?: string;
	type: AnnotationType;
	color?: string;
	sortIndex?: string;
	text?: string;
	comment?: string;
	readOnly?: boolean;
	key: string;
	range: Range;
};

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = (props) => {
	let { iframe, annotations, selectedAnnotationIDs, onPointerDown, onPointerUp, onContextMenu, onDragStart, onResizeStart, onResizeEnd } = props;

	let [isResizing, setResizing] = useState(false);
	let [isPointerDownOutside, setPointerDownOutside] = useState(false);
	let [isAltDown, setAltDown] = useState(false);
	let pointerEventsSuppressed = isResizing || isPointerDownOutside || isAltDown;

	useEffect(() => {
		const win = iframe.contentWindow;
		if (!win) {
			return undefined;
		}

		let handleWindowPointerDown = (event: PointerEvent) => {
			setAltDown(event.altKey);
			if (event.button == 0 && !(event.composedPath()[0] as Element).closest('.annotation-container')) {
				setPointerDownOutside(true);
			}
		};

		let handleWindowPointerUp = (event: PointerEvent) => {
			setAltDown(event.altKey);
			if (event.button == 0) {
				setPointerDownOutside(false);
			}
		};

		let handleWindowKeyDownCapture = (event: KeyboardEvent) => {
			if (event.key == 'Alt') {
				setAltDown(true);
			}
		};

		let handleWindowKeyUpCapture = (event: KeyboardEvent) => {
			if (event.key == 'Alt') {
				setAltDown(false);
			}
		};

		win.addEventListener('pointerdown', handleWindowPointerDown, { passive: true });
		win.addEventListener('pointerup', handleWindowPointerUp, { passive: true });
		// Listen for Alt on the iframe window and the root window, because the iframe window doesn't get the event
		// when an annotation text field is focused
		win.addEventListener('keydown', handleWindowKeyDownCapture, { capture: true, passive: true });
		win.addEventListener('keyup', handleWindowKeyUpCapture, { capture: true, passive: true });
		window.addEventListener('keydown', handleWindowKeyDownCapture, { capture: true, passive: true });
		window.addEventListener('keyup', handleWindowKeyUpCapture, { capture: true, passive: true });
		return () => {
			win.removeEventListener('pointerdown', handleWindowPointerDown);
			win.removeEventListener('pointerup', handleWindowPointerUp);
			win.removeEventListener('keydown', handleWindowKeyDownCapture, { capture: true });
			win.removeEventListener('keyup', handleWindowKeyUpCapture, { capture: true });
			window.removeEventListener('keydown', handleWindowKeyDownCapture, { capture: true });
			window.removeEventListener('keyup', handleWindowKeyUpCapture, { capture: true });
		};
	}, [iframe.contentWindow]);

	let handlePointerDown = useCallback((annotation: DisplayedAnnotation, event: React.PointerEvent) => {
		onPointerDown(annotation.id!, event);
	}, [onPointerDown]);

	let handlePointerUp = useCallback((annotation: DisplayedAnnotation, event: React.PointerEvent) => {
		onPointerUp(annotation.id!, event);
	}, [onPointerUp]);

	let handleContextMenu = useCallback((annotation: DisplayedAnnotation, event: React.MouseEvent) => {
		onContextMenu(annotation.id!, event);
	}, [onContextMenu]);

	let handleDragStart = useCallback((annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => {
		onDragStart(annotation.id!, dataTransfer);
	}, [onDragStart]);

	let handleResizeStart = useCallback((annotation: DisplayedAnnotation) => {
		setResizing(true);
		onResizeStart(annotation.id!);
	}, [onResizeStart]);

	let handleResizeEnd = useCallback((annotation: DisplayedAnnotation, range: Range, cancelled: boolean) => {
		setResizing(false);
		onResizeEnd(annotation.id!, range, cancelled);
	}, [onResizeEnd]);

	let widgetContainer = useRef<SVGSVGElement>(null);

	let highlightUnderlines: DisplayedAnnotation[] = [];
	let numSelectedHighlightUnderlines = 0;
	let notes: DisplayedAnnotation[] = [];
	let notePreviews: DisplayedAnnotation[] = [];
	for (let annotation of annotations) {
		if (annotation.type === 'highlight' || annotation.type === 'underline') {
			// Put selected highlights/underlines at the end of the array,
			// so they render on top
			if (annotation.id && selectedAnnotationIDs.includes(annotation.id)) {
				highlightUnderlines.push(annotation);
				numSelectedHighlightUnderlines++;
			}
			else {
				highlightUnderlines.splice(
					highlightUnderlines.length - numSelectedHighlightUnderlines,
					0,
					annotation
				);
			}
		}
		else if (annotation.type == 'note') {
			if (annotation.id) {
				notes.push(annotation);
			}
			else {
				notePreviews.push(annotation);
			}
		}
	}

	return <>
		<svg className={cx('annotation-container blended', { 'disable-pointer-events': pointerEventsSuppressed })}>
			{highlightUnderlines.map((annotation) => {
				if (annotation.id) {
					return (
						<HighlightOrUnderline
							annotation={annotation}
							key={annotation.key}
							selected={selectedAnnotationIDs.includes(annotation.id)}
							singleSelection={selectedAnnotationIDs.length == 1}
							onPointerDown={handlePointerDown}
							onPointerUp={handlePointerUp}
							onContextMenu={handleContextMenu}
							onDragStart={handleDragStart}
							onResizeStart={handleResizeStart}
							onResizeEnd={handleResizeEnd}
							widgetContainer={widgetContainer.current}
						/>
					);
				}
				else {
					return (
						<g className="disable-pointer-events" key={annotation.key}>
							<HighlightOrUnderline
								annotation={annotation}
								selected={false}
								singleSelection={false}
								widgetContainer={widgetContainer.current}
							/>
						</g>
					);
				}
			})}
			{notePreviews.map(annotation => (
				<NotePreview annotation={annotation} key={annotation.key} />
			))}
		</svg>
		<svg
			className={cx('annotation-container', { 'disable-pointer-events': pointerEventsSuppressed })}
			ref={widgetContainer}
		>
			<StaggeredNotes
				annotations={notes}
				selectedAnnotationIDs={selectedAnnotationIDs}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUp}
				onContextMenu={handleContextMenu}
				onDragStart={handleDragStart}
			/>
		</svg>
	</>;
};
AnnotationOverlay.displayName = 'AnnotationOverlay';

type AnnotationOverlayProps = {
	iframe: HTMLIFrameElement;
	annotations: DisplayedAnnotation[];
	selectedAnnotationIDs: string[];
	onPointerDown: (id: string, event: React.PointerEvent) => void;
	onPointerUp: (id: string, event: React.PointerEvent) => void;
	onContextMenu: (id: string, event: React.MouseEvent) => void;
	onDragStart: (id: string, dataTransfer: DataTransfer) => void;
	onResizeStart: (id: string) => void;
	onResizeEnd: (id: string, range: Range, cancelled: boolean) => void;
};

let HighlightOrUnderline: React.FC<HighlightOrUnderlineProps> = (props) => {
	let { annotation, selected, singleSelection, onPointerDown, onPointerUp, onContextMenu, onDragStart, onResizeStart, onResizeEnd, widgetContainer } = props;
	let [isResizing, setResizing] = useState(false);
	let [resizedRange, setResizedRange] = useState(annotation.range);

	let outerGroupRef = useRef<SVGGElement>(null);
	let rectGroupRef = useRef<SVGGElement>(null);
	let dragImageRef = isSafari ? outerGroupRef : rectGroupRef;

	let handlePointerDown = useCallback((event: React.PointerEvent) => {
		onPointerDown?.(annotation, event);
	}, [annotation, onPointerDown]);

	let handlePointerUp = useCallback((event: React.PointerEvent) => {
		onPointerUp?.(annotation, event);
	}, [annotation, onPointerUp]);

	let handleContextMenu = useCallback((event: React.MouseEvent) => {
		onContextMenu?.(annotation, event);
	}, [annotation, onContextMenu]);

	let handleDragStart = useCallback((event: React.DragEvent) => {
		if (!onDragStart || annotation.text === undefined) {
			return;
		}

		let elem = dragImageRef.current;
		if (elem) {
			let br = elem.getBoundingClientRect();
			event.dataTransfer.setDragImage(elem, event.clientX - br.left, event.clientY - br.top);
		}
		onDragStart(annotation, event.dataTransfer);
	}, [annotation, dragImageRef, onDragStart]);

	let handleResizeStart = useCallback((annotation: DisplayedAnnotation) => {
		setResizing(true);
		setResizedRange(annotation.range);
		onResizeStart?.(annotation);
	}, [onResizeStart]);

	let handleResizeEnd = useCallback((annotation: DisplayedAnnotation, cancelled: boolean) => {
		setResizing(false);
		onResizeEnd?.(annotation, resizedRange, cancelled);
	}, [onResizeEnd, resizedRange]);

	let handleResize = useCallback((annotation: DisplayedAnnotation, range: Range) => {
		setResizedRange(range);
	}, []);

	let allowResize = selected && singleSelection && !annotation.readOnly && supportsCaretPositionFromPoint();

	useEffect(() => {
		if (!allowResize && isResizing) {
			handleResizeEnd(annotation, true);
		}
	}, [allowResize, annotation, handleResizeEnd, isResizing]);

	let { rects, interactiveRects, commentIconPosition } = useMemo(() => {
		let ranges = splitRangeToTextNodes(isResizing ? resizedRange : annotation.range);
		let rects: DOMRect[] = [];
		let seenRects = new Set<string>();
		let interactiveRects = new Set<DOMRect>();
		for (let range of ranges) {
			let closestInteractiveElement = range.startContainer.parentElement?.closest('a, area');
			for (let rect of getPageRects(range)) {
				if (rect.width == 0 || rect.height == 0) {
					continue;
				}
				let key = JSON.stringify(rect);
				if (seenRects.has(key)) {
					continue;
				}

				rects.push(rect);
				seenRects.add(key);
				if (closestInteractiveElement) {
					interactiveRects.add(rect);
				}
			}
		}

		let commentIconPosition;
		if (annotation.comment) {
			let commentIconRange = ranges[0].cloneRange();
			collapseToOneCharacterAtStart(commentIconRange);
			let rect = getBoundingPageRect(commentIconRange);
			commentIconPosition = { x: rect.x, y: rect.y };
		}
		else {
			commentIconPosition = null;
		}

		return { rects, interactiveRects, commentIconPosition };
	}, [annotation, isResizing, resizedRange]);

	let vert = isVertical(annotation.range.commonAncestorContainer);
	let rtl = isRTL(annotation.range.commonAncestorContainer);
	let underline = annotation.type === 'underline';
	let rectGroup = useMemo(() => {
		return <g ref={rectGroupRef}>
			{rects.map((rect, i) => (
				<rect
					x={vert && underline ? rect.x + (rtl ? -3 : rect.width) : rect.x}
					y={!vert && underline ? rect.y + rect.height : rect.y}
					width={vert && underline ? 3 : rect.width}
					height={!vert && underline ? 3 : rect.height}
					opacity="50%"
					key={i}
				/>
			))}
		</g>;
	}, [rects, rtl, underline, vert]);

	let foreignObjects = useMemo(() => {
		if (isResizing) {
			return [];
		}

		let isCoarsePointer = window.matchMedia('(pointer: coarse').matches;

		if (isCoarsePointer && isSafari) {
			// If the user is using a coarse pointer (touch device) on Safari:
			//  - Use the entire bounding rect as the tap target, with a 10px margin
			//  - Don't use a foreignObject, just a normal rect, because Safari
			//    makes foreignObjects eat all pointer events within their bounds
			//    with no regard for Z ordering. The foreignObject isn't necessary
			//    on mobile anyway because we don't support dragging.
			let rect = expandRect(getBoundingRect(rects), 10);
			return (
				<rect
					fill="transparent"
					x={rect.x}
					y={rect.y}
					width={rect.width}
					height={rect.height}
					className="needs-pointer-events annotation-div"
					onPointerDown={handlePointerDown}
					onPointerUp={handlePointerUp}
					onContextMenu={handleContextMenu}
					data-annotation-id={annotation.id}
				/>
			);
		}

		let clickTargetRects = isCoarsePointer
			// As in the Safari case above, use the full bounding rect as the tap
			// target if the user is using a touch device
			? [expandRect(getBoundingRect(rects), 10)]
			: rects;

		return clickTargetRects.map((rect, i) => (
			// Yes, this is horrible, but SVGs don't support drag events without embedding HTML in a <foreignObject>
			<foreignObject
				x={rect.x}
				y={rect.y}
				width={rect.width}
				height={rect.height}
				className="needs-pointer-events"
				key={i + '-foreign'}
			>
				<div
					className={cx('annotation-div', { 'disable-pointer-events': interactiveRects.has(rect) })}
					// Safari needs position: absolute, which breaks all other browsers
					style={isSafari ? { position: 'absolute', top: `${rect.y}px`, left: `${rect.x}px`, width: `${rect.width}px`, height: `${rect.height}px` } : undefined}
					draggable={true}
					onPointerDown={handlePointerDown}
					onPointerUp={handlePointerUp}
					onContextMenu={handleContextMenu}
					onDragStart={handleDragStart}
					data-annotation-id={annotation.id}
				/>
			</foreignObject>
		));
	}, [annotation, handleContextMenu, handleDragStart, handlePointerDown, handlePointerUp, interactiveRects, isResizing, rects]);

	let resizer = useMemo(() => {
		return allowResize && (
			<Resizer
				annotation={annotation}
				highlightRects={rects}
				onResizeStart={handleResizeStart}
				onResizeEnd={handleResizeEnd}
				onResize={handleResize}
			/>
		);
	}, [allowResize, annotation, handleResize, handleResizeEnd, handleResizeStart, rects]);

	if (!rects.length) {
		return null;
	}

	// When the user drags the annotation, we *want* to set the drag image to the rendered annotation -- a highlight
	// rectangle for a highlight annotation, an underline for an underline annotation. We don't want to include
	// resizers. But in Safari, passing an SVG sub-element to setDragImage() doesn't actually set the drag image to the
	// rendered content of that element, but rather to all the text contained within its bounding box (but not
	// necessarily within the element itself in the DOM tree). This is very weird and means that underline annotations
	// will have a blank drag image because the underline doesn't overlap any text. So when running in Safari, we pass
	// the whole outer <g> containing the underline/highlight (potentially small) and the interactive <foreignObject>s
	// (big) so that we get all the highlighted text to render in the drag image.
	return <>
		<g
			tabIndex={-1}
			data-annotation-id={annotation.id}
			fill={annotation.color}
			ref={outerGroupRef}
		>
			{rectGroup}
			{foreignObjects}
			{resizer}
		</g>
		{widgetContainer && ((selected && !isResizing) || commentIconPosition) && ReactDOM.createPortal(
			<>
				{selected && !isResizing && (
					<SplitSelectionBorder range={annotation.range}/>
				)}
				{commentIconPosition && (
					<CommentIcon {...commentIconPosition} color={annotation.color!}/>
				)}
			</>,
			widgetContainer
		)}
	</>;
};
HighlightOrUnderline.displayName = 'HighlightOrUnderline';
HighlightOrUnderline = memo(HighlightOrUnderline);
type HighlightOrUnderlineProps = {
	annotation: DisplayedAnnotation;
	selected: boolean;
	singleSelection: boolean;
	onPointerDown?: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onPointerUp?: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onContextMenu?: (annotation: DisplayedAnnotation, event: React.MouseEvent) => void;
	onDragStart?: (annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => void;
	onResizeStart?: (annotation: DisplayedAnnotation) => void;
	onResizeEnd?: (annotation: DisplayedAnnotation, range: Range, cancelled: boolean) => void;
	widgetContainer: Element | null;
};

const Note: React.FC<NoteProps> = (props) => {
	let { annotation, staggerIndex, selected, onPointerDown, onPointerUp, onContextMenu, onDragStart } = props;

	let dragImageRef = useRef<SVGSVGElement>(null);
	let doc = annotation.range.commonAncestorContainer.ownerDocument;

	let handleDragStart = useCallback((event: React.DragEvent) => {
		if (!onDragStart || annotation.comment === undefined) {
			return;
		}
		let elem = dragImageRef.current;
		if (elem) {
			let br = elem.getBoundingClientRect();
			event.dataTransfer.setDragImage(elem, event.clientX - br.left, event.clientY - br.top);
		}
		onDragStart(annotation, event.dataTransfer);
	}, [annotation, onDragStart]);

	if (!doc || !doc.defaultView) {
		return null;
	}

	let rect = annotation.range.getBoundingClientRect();
	rect.x += doc.defaultView.scrollX;
	rect.y += doc.defaultView.scrollY;
	let rtl = isRTL(annotation.range.commonAncestorContainer);
	let staggerOffset = (staggerIndex || 0) * 15;
	let x = rect.left + (rtl ? -25 : rect.width + 25) + (rtl ? -1 : 1) * staggerOffset;
	let y = rect.top + staggerOffset;
	return (
		<CommentIcon
			ref={dragImageRef}
			annotation={annotation}
			x={x}
			y={y}
			color={annotation.color!}
			opacity={annotation.id ? '100%' : '50%'}
			selected={selected}
			large={true}
			tabIndex={-1}
			onPointerDown={onPointerDown && (event => onPointerDown!(annotation, event))}
			onPointerUp={onPointerUp && (event => onPointerUp!(annotation, event))}
			onContextMenu={onContextMenu && (event => onContextMenu!(annotation, event))}
			onDragStart={handleDragStart}
		/>
	);
};
Note.displayName = 'Note';
type NoteProps = {
	annotation: DisplayedAnnotation,
	staggerIndex?: number,
	selected: boolean;
	onPointerDown?: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onPointerUp?: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onContextMenu?: (annotation: DisplayedAnnotation, event: React.MouseEvent) => void;
	onDragStart?: (annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => void;
};

let NotePreview: React.FC<NotePreviewProps> = (props) => {
	let { annotation } = props;
	let doc = annotation.range.commonAncestorContainer.ownerDocument;
	if (!doc || !doc.defaultView) {
		return null;
	}

	let rect = annotation.range.getBoundingClientRect();
	rect.x += doc.defaultView.scrollX;
	rect.y += doc.defaultView.scrollY;
	return <SelectionBorder rect={rect} preview={true} key={annotation.key} />;
};
NotePreview.displayName = 'NotePreview';
NotePreview = memo(NotePreview);
type NotePreviewProps = {
	annotation: DisplayedAnnotation;
};

const StaggeredNotes: React.FC<StaggeredNotesProps> = (props) => {
	let { annotations, selectedAnnotationIDs, onPointerDown, onPointerUp, onContextMenu, onDragStart } = props;
	let staggerMap = new Map<string | undefined, number>();
	return <>
		{annotations.map((annotation) => {
			let stagger = staggerMap.has(annotation.sortIndex) ? staggerMap.get(annotation.sortIndex)! : 0;
			staggerMap.set(annotation.sortIndex, stagger + 1);
			if (annotation.id) {
				return (
					<Note
						annotation={annotation}
						staggerIndex={stagger}
						key={annotation.key}
						selected={selectedAnnotationIDs.includes(annotation.id)}
						onPointerDown={onPointerDown}
						onPointerUp={onPointerUp}
						onContextMenu={onContextMenu}
						onDragStart={onDragStart}
					/>
				);
			}
			else {
				return (
					<div className="disable-pointer-events" key={annotation.key}>
						<Note
							annotation={annotation}
							staggerIndex={stagger}
							key={annotation.key}
							selected={false}
						/>
					</div>
				);
			}
		})}
	</>;
};
StaggeredNotes.displayName = 'StaggeredNotes';
type StaggeredNotesProps = {
	annotations: DisplayedAnnotation[];
	selectedAnnotationIDs: string[];
	onPointerDown: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onPointerUp: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onContextMenu: (annotation: DisplayedAnnotation, event: React.MouseEvent) => void;
	onDragStart: (annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => void;
};

let SelectionBorder: React.FC<SelectionBorderProps> = (props) => {
	let { rect, preview } = props;
	return (
		<rect
			x={rect.left - 5}
			y={rect.top - 5}
			width={rect.width + 10}
			height={rect.height + 10}
			fill="none"
			stroke={preview ? '#aaaaaa' : '#6d95e0'}
			strokeDasharray="10 6"
			strokeWidth={2}/>
	);
};
SelectionBorder.displayName = 'SelectionBorder';
SelectionBorder = memo(SelectionBorder, (prev, next) => {
	return rectsEqual(prev.rect, next.rect) && prev.preview === next.preview;
});
type SelectionBorderProps = {
	rect: DOMRect;
	preview?: boolean;
};

let SplitSelectionBorder: React.FC<SplitSelectionBorderProps> = (props) => {
	let { range } = props;
	return (
		<>
			{getColumnSeparatedPageRects(range)
				.map((sectionRect, i) => <SelectionBorder rect={sectionRect} key={i}/>)}
		</>
	);
};
SplitSelectionBorder.displayName = 'SelectionBorder';
type SplitSelectionBorderProps = {
	range: Range;
};

const Resizer: React.FC<ResizerProps> = (props) => {
	let { annotation, highlightRects, onResize, onResizeEnd, onResizeStart } = props;

	let [resizingSide, setResizingSide] = useState<false | 'start' | 'end'>(false);
	let [pointerCapture, setPointerCapture] = useState<{ elem: Element, pointerId: number } | null>(null);
	let [lastPointerMove, setLastPointerMove] = useState<React.PointerEvent | null>(null);

	let isCoarsePointer = window.matchMedia('(pointer: coarse').matches;
	let size = isCoarsePointer ? 6 : 3;

	let handlePointerDown = useCallback((event: React.PointerEvent) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		(event.target as Element).setPointerCapture(event.pointerId);
	}, []);

	let handlePointerUp = useCallback((event: React.PointerEvent) => {
		if (event.button !== 0
				|| !resizingSide
				|| !(event.target as Element).hasPointerCapture(event.pointerId)) {
			return;
		}
		(event.target as Element).releasePointerCapture(event.pointerId);
	}, [resizingSide]);

	let handleGotPointerCapture = useCallback((event: React.PointerEvent, side: 'start' | 'end') => {
		setResizingSide(side);
		setPointerCapture({ elem: event.target as Element, pointerId: event.pointerId });
		onResizeStart(annotation);
	}, [annotation, onResizeStart]);

	let handleLostPointerCapture = useCallback(() => {
		setResizingSide(false);
		if (pointerCapture) {
			setPointerCapture(null);
			setLastPointerMove(null);
			onResizeEnd(annotation, false);
		}
	}, [annotation, onResizeEnd, pointerCapture]);

	let handleKeyDown = useCallback((event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !resizingSide || !pointerCapture) {
			return;
		}
		pointerCapture.elem.releasePointerCapture(pointerCapture.pointerId);
		setResizingSide(false);
		setPointerCapture(null);
		onResizeEnd(annotation, true);
	}, [pointerCapture, onResizeEnd, annotation, resizingSide]);

	const doc = annotation.range.commonAncestorContainer.ownerDocument;
	const win = doc?.defaultView;

	useEffect(() => {
		if (!win) {
			return undefined;
		}
		win.addEventListener('keydown', handleKeyDown, true);
		return () => win.removeEventListener('keydown', handleKeyDown, true);
	}, [win, handleKeyDown]);

	let handlePointerMove = useCallback((event: React.PointerEvent) => {
		let { clientX, clientY } = event;
		let isStart = resizingSide === 'start';
		if (isSafari) {
			let targetRect = (event.target as Element).getBoundingClientRect();
			if (clientX >= targetRect.left && clientX <= targetRect.right) {
				// In Safari, caretPositionFromPoint() doesn't work if the mouse is directly over the target element
				// (returns the last element in the body instead), so we have to offset the X position by 1 pixel.
				// This makes resizing a bit jerkier, but it's better than the alternative.
				clientX = isStart ? targetRect.left - 1 : targetRect.right + 1;
			}
		}
		let pos = caretPositionFromPoint(event.view.document, clientX, clientY);
		if (pos) {
			// Just bail if the browser thinks the mouse is over the SVG - that seems to only happen momentarily
			if (pos.offsetNode.nodeType == Node.ELEMENT_NODE && (pos.offsetNode as Element).closest('svg')) {
				return;
			}

			let relativePosition = annotation.range.comparePoint(pos.offsetNode, pos.offset);
			let newRange = annotation.range.cloneRange();
			if (isStart) {
				if (relativePosition <= 0) {
					newRange.setStart(pos.offsetNode, pos.offset);
				}
				else {
					// Resizing the start past the end - swap the two
					newRange.setStart(newRange.endContainer, newRange.endOffset);
					newRange.setEnd(pos.offsetNode, pos.offset);
				}
			}
			else {
				// eslint-disable-next-line no-lonely-if
				if (relativePosition >= 0) {
					newRange.setEnd(pos.offsetNode, pos.offset);
				}
				else {
					// Resizing the end past the start - swap the two
					newRange.setEnd(newRange.startContainer, newRange.startOffset);
					newRange.setStart(pos.offsetNode, pos.offset);
				}
			}

			if (newRange.collapsed
					|| !newRange.toString().trim().length
					|| newRange.getClientRects().length == 0
					// Make sure we stay within one section
					|| doc?.querySelector('[data-section-index]')
						&& !closestElement(newRange.commonAncestorContainer)?.closest('[data-section-index]')) {
				return;
			}
			let boundingRect = newRange.getBoundingClientRect();
			if (!boundingRect.width || !boundingRect.height) {
				return;
			}

			onResize(annotation, newRange);
		}

		if (win) {
			setLastPointerMove(event);
		}
	}, [annotation, doc, onResize, resizingSide, win]);

	useEffect(() => {
		if (!win || !resizingSide || !lastPointerMove) {
			return undefined;
		}
		let scrollAmount = lastPointerMove.clientY < 50 ? -10 : lastPointerMove.clientY >= win.innerHeight - 50 ? 10 : 0;
		if (!scrollAmount) {
			return undefined;
		}

		win.scrollBy({ top: scrollAmount });
		let intervalID = win.setInterval(() => {
			win.scrollBy({ top: scrollAmount });
		}, 20);
		return () => win.clearInterval(intervalID);
	}, [lastPointerMove, resizingSide, win]);

	useEffect(() => {
		if (!win || !resizingSide || !lastPointerMove) {
			return undefined;
		}
		let handleScroll = () => {
			handlePointerMove(lastPointerMove!);
		};
		win.addEventListener('scroll', handleScroll);
		return () => win.removeEventListener('scroll', handleScroll);
	}, [handlePointerMove, lastPointerMove, resizingSide, win]);

	if (!highlightRects.length) {
		return null;
	}

	let vert = isVertical(annotation.range.commonAncestorContainer);
	let topLeftRect = highlightRects[0];
	let bottomRightRect = highlightRects[highlightRects.length - 1];
	return <>
		<rect
			x={vert ? topLeftRect.left : topLeftRect.left - size}
			y={vert ? topLeftRect.top - size : topLeftRect.top}
			width={vert ? topLeftRect.width : size}
			height={vert ? size : topLeftRect.height}
			fill={annotation.color}
			className={cx('resizer inherit-pointer-events', { 'resizer-vertical': vert })}
			onPointerDown={handlePointerDown}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onPointerMove={resizingSide == 'start' ? (event => handlePointerMove(event)) : undefined}
			onGotPointerCapture={event => handleGotPointerCapture(event, 'start')}
			onLostPointerCapture={handleLostPointerCapture}
		/>
		<rect
			x={vert ? bottomRightRect.left : bottomRightRect.right}
			y={vert ? bottomRightRect.bottom : bottomRightRect.top}
			width={vert ? bottomRightRect.width : size}
			height={vert ? size : bottomRightRect.height}
			fill={annotation.color}
			className={cx("resizer inherit-pointer-events", { 'resizer-vertical': vert })}
			onPointerDown={handlePointerDown}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onPointerMove={resizingSide == 'end' ? (event => handlePointerMove(event)) : undefined}
			onGotPointerCapture={event => handleGotPointerCapture(event, 'end')}
			onLostPointerCapture={handleLostPointerCapture}
		/>
	</>;
};
Resizer.displayName = 'Resizer';
type ResizerProps = {
	annotation: DisplayedAnnotation;
	highlightRects: DOMRect[];
	onResizeStart: (annotation: DisplayedAnnotation) => void;
	onResizeEnd: (annotation: DisplayedAnnotation, cancelled: boolean) => void;
	onResize: (annotation: DisplayedAnnotation, range: Range) => void;
};

let CommentIcon = React.forwardRef<SVGSVGElement, CommentIconProps>((props, ref) => {
	let size = props.large ? 24 : 14;
	let x = props.x - size / 2;
	let y = props.y - size / 2;
	return <>
		<svg
			color={props.color}
			opacity={props.opacity}
			x={x}
			y={y}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			data-annotation-id={props.annotation?.id}
			ref={ref}
		>
			<IconNoteLarge/>
		</svg>
		{props.selected && (
			<SelectionBorder rect={new DOMRect(x, y, size, size)}/>
		)}
		<foreignObject
			x={x}
			y={y}
			width={size}
			height={size}
			className="needs-pointer-events"
			tabIndex={props.tabIndex}
			data-annotation-id={props.annotation?.id}
		>
			<div
				// @ts-ignore
				xmlns="http://www.w3.org/1999/xhtml"
				className="annotation-div"
				draggable={true}
				onPointerDown={props.onPointerDown}
				onPointerUp={props.onPointerUp}
				onContextMenu={props.onContextMenu}
				onDragStart={props.onDragStart}
				onDragEnd={props.onDragEnd}
				data-annotation-id={props.annotation?.id}
			/>
		</foreignObject>
	</>;
});
CommentIcon.displayName = 'CommentIcon';
CommentIcon = memo(CommentIcon);
type CommentIconProps = {
	annotation?: { id?: string },
	x: number;
	y: number;
	color: string;
	opacity?: string | number;
	selected?: boolean;
	large?: boolean;
	tabIndex?: number;
	onPointerDown?: (event: React.PointerEvent) => void;
	onPointerUp?: (event: React.PointerEvent) => void;
	onContextMenu?: (event: React.MouseEvent) => void;
	onDragStart?: (event: React.DragEvent) => void;
	onDragEnd?: (event: React.DragEvent) => void;
};
