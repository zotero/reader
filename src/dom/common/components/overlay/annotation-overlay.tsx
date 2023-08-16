import React, {
	useCallback,
	useEffect,
	useRef,
	useState
} from 'react';
import {
	caretPositionFromPoint,
	collapseToOneCharacterAtStart,
	splitRangeToTextNodes,
	supportsCaretPositionFromPoint
} from "../../lib/range";
import { AnnotationType } from "../../../../common/types";
import ReactDOM from "react-dom";
import { IconNoteLarge } from "../../../../common/components/common/icons";
import { closestElement } from "../../lib/nodes";
import { isSafari } from "../../../../common/lib/utilities";

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
	let { iframe, annotations, selectedAnnotationIDs, onPointerDown, onPointerUp, onDragStart, onResizeStart, onResizeEnd, disablePointerEvents } = props;

	let [isResizing, setResizing] = useState(false);
	let [isPointerDownOutside, setPointerDownOutside] = useState(false);
	let pointerEventsSuppressed = disablePointerEvents || isResizing || isPointerDownOutside;

	useEffect(() => {
		let win = iframe.contentWindow;
		if (!win) {
			return undefined;
		}

		let handleWindowPointerDown = (event: PointerEvent) => {
			if (event.button == 0 && !(event.target as Element).closest('.annotation-container')) {
				setPointerDownOutside(true);
			}
		};

		let handleWindowPointerUp = (event: PointerEvent) => {
			if (event.button == 0) {
				setPointerDownOutside(false);
			}
		};

		win.addEventListener('pointerdown', handleWindowPointerDown);
		win.addEventListener('pointerup', handleWindowPointerUp);
		return () => {
			win!.removeEventListener('pointerdown', handleWindowPointerDown);
			win!.removeEventListener('pointerup', handleWindowPointerUp);
		};
	}, [iframe.contentWindow]);

	let handlePointerDown = useCallback((annotation: DisplayedAnnotation, event: React.PointerEvent) => {
		onPointerDown(annotation.id!, event);
	}, [onPointerDown]);

	let handlePointerUp = useCallback((annotation: DisplayedAnnotation, event: React.PointerEvent) => {
		onPointerUp(annotation.id!, event);
	}, [onPointerUp]);

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

	return <>
		<svg
			className="annotation-container"
			style={{
				mixBlendMode: 'multiply',
				zIndex: '9999',
				pointerEvents: 'none',
				position: 'absolute',
				left: '0',
				top: '0',
				overflow: 'visible'
			}}
		>
			{annotations.filter(annotation => annotation.type == 'highlight' || annotation.type == 'underline').map((annotation) => {
				if (annotation.id) {
					return (
						<HighlightOrUnderline
							annotation={annotation}
							key={annotation.key}
							selected={selectedAnnotationIDs.includes(annotation.id)}
							singleSelection={selectedAnnotationIDs.length == 1}
							onPointerDown={handlePointerDown}
							onPointerUp={handlePointerUp}
							onDragStart={handleDragStart}
							onResizeStart={handleResizeStart}
							onResizeEnd={handleResizeEnd}
							pointerEventsSuppressed={pointerEventsSuppressed}
							widgetContainer={widgetContainer.current}
						/>
					);
				}
				else {
					return (
						<HighlightOrUnderline
							annotation={annotation}
							key={annotation.key}
							selected={false}
							singleSelection={false}
							pointerEventsSuppressed={true}
							widgetContainer={widgetContainer.current}
						/>
					);
				}
			})}
			{annotations.filter(annotation => annotation.type == 'note' && !annotation.id).map(annotation => (
				<NotePreview annotation={annotation} key={annotation.key} />
			))}
		</svg>
		<svg
			className="annotation-container"
			style={{
				zIndex: '9999',
				pointerEvents: 'none',
				position: 'absolute',
				left: '0',
				top: '0',
				overflow: 'visible'
			}}
			ref={widgetContainer}
		>
			<StaggeredNotes
				annotations={annotations.filter(a => a.type == 'note' && a.id)}
				selectedAnnotationIDs={selectedAnnotationIDs}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUp}
				onDragStart={handleDragStart}
				pointerEventsSuppressed={pointerEventsSuppressed}
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
	onDragStart: (id: string, dataTransfer: DataTransfer) => void;
	onResizeStart: (id: string) => void;
	onResizeEnd: (id: string, range: Range, cancelled: boolean) => void;
	disablePointerEvents: boolean;
};

const HighlightOrUnderline: React.FC<HighlightOrUnderlineProps> = (props) => {
	let { annotation, selected, singleSelection, onPointerDown, onPointerUp, onDragStart, onResizeStart, onResizeEnd, pointerEventsSuppressed, widgetContainer } = props;
	let [isResizing, setResizing] = useState(false);
	let [resizedRange, setResizedRange] = useState(annotation.range);

	let dragImageRef = useRef<SVGGElement>(null);

	let ranges = splitRangeToTextNodes(isResizing ? resizedRange : annotation.range);
	if (!ranges.length) {
		return null;
	}
	const doc = ranges[0].commonAncestorContainer.ownerDocument;
	if (!doc || !doc.defaultView) {
		return null;
	}

	let handleDragStart = (event: React.DragEvent) => {
		if (!onDragStart || annotation.text === undefined) {
			return;
		}

		let elem = dragImageRef.current;
		if (elem) {
			let br = elem.getBoundingClientRect();
			event.dataTransfer.setDragImage(elem, event.clientX - br.left, event.clientY - br.top);
		}
		onDragStart(annotation, event.dataTransfer);
	};

	let handleResizeStart = (annotation: DisplayedAnnotation) => {
		setResizing(true);
		setResizedRange(annotation.range);
		onResizeStart?.(annotation);
	};

	let handleResizeEnd = (annotation: DisplayedAnnotation, cancelled: boolean) => {
		setResizing(false);
		onResizeEnd?.(annotation, resizedRange, cancelled);
	};

	let handleResize = (annotation: DisplayedAnnotation, range: Range) => {
		setResizedRange(range);
	};

	let rects = new Map<string, DOMRect>();
	for (let range of ranges) {
		for (let rect of range.getClientRects()) {
			if (rect.width == 0 || rect.height == 0) {
				continue;
			}
			rect.x += doc.defaultView!.scrollX;
			rect.y += doc.defaultView!.scrollY;
			let key = JSON.stringify(rect);
			if (!rects.has(key)) {
				rects.set(key, rect);
			}
		}
	}

	let commentIconPosition;
	if (annotation.comment) {
		let commentIconRange = ranges[0].cloneRange();
		collapseToOneCharacterAtStart(commentIconRange);
		let rect = commentIconRange.getBoundingClientRect();
		commentIconPosition = { x: rect.x + doc.defaultView!.scrollX, y: rect.y + doc.defaultView!.scrollY };
	}
	else {
		commentIconPosition = null;
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
		<g fill={annotation.color} ref={isSafari ? dragImageRef : undefined}>
			<g ref={isSafari ? undefined : dragImageRef}>
				{[...rects.entries()].map(([key, rect]) => (
					<rect
						x={rect.x}
						y={annotation.type == 'underline' ? rect.y + rect.height : rect.y}
						width={rect.width}
						height={annotation.type == 'underline' ? 3 : rect.height}
						opacity="50%"
						key={key}
					/>
				))}
			</g>
			{!pointerEventsSuppressed && !isResizing && [...rects.entries()].map(([key, rect]) => (
				// Yes, this is horrible, but SVGs don't support drag events without embedding HTML in a <foreignObject>
				<foreignObject
					x={rect.x}
					y={rect.y}
					width={rect.width}
					height={rect.height}
					key={key + '-foreign'}
				>
					<div
						// @ts-ignore
						xmlns="http://www.w3.org/1999/xhtml"
						style={{
							pointerEvents: 'auto',
							cursor: 'pointer',
							width: '100%',
							height: '100%',
						}}
						draggable={true}
						onPointerDown={onPointerDown && (event => onPointerDown!(annotation, event))}
						onPointerUp={onPointerUp && (event => onPointerUp!(annotation, event))}
						onDragStart={handleDragStart}
						data-annotation-id={annotation.id}
					/>
				</foreignObject>
			))}
			{(!pointerEventsSuppressed || isResizing) && selected && singleSelection && !annotation.readOnly && supportsCaretPositionFromPoint() && (
				<Resizer
					annotation={annotation}
					highlightRects={[...rects.values()]}
					onResizeStart={handleResizeStart}
					onResizeEnd={handleResizeEnd}
					onResize={handleResize}
				/>
			)}
		</g>
		{widgetContainer && ((selected && !isResizing) || commentIconPosition) && ReactDOM.createPortal(
			<>
				{selected && !isResizing && (
					<RangeSelectionBorder range={annotation.range}/>
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
type HighlightOrUnderlineProps = {
	annotation: DisplayedAnnotation;
	selected: boolean;
	singleSelection: boolean;
	onPointerDown?: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onPointerUp?: (annotation: DisplayedAnnotation, event: React.PointerEvent) => void;
	onDragStart?: (annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => void;
	onResizeStart?: (annotation: DisplayedAnnotation) => void;
	onResizeEnd?: (annotation: DisplayedAnnotation, range: Range, cancelled: boolean) => void;
	pointerEventsSuppressed: boolean;
	widgetContainer: Element | null;
};

const Note: React.FC<NoteProps> = (props) => {
	let { annotation, staggerIndex, selected, onPointerDown, onPointerUp, onDragStart, disablePointerEvents } = props;

	let dragImageRef = useRef<SVGSVGElement>(null);
	let doc = annotation.range.commonAncestorContainer.ownerDocument;
	if (!doc || !doc.defaultView) {
		return null;
	}

	let handleDragStart = (event: React.DragEvent) => {
		if (!onDragStart || annotation.comment === undefined) {
			return;
		}
		let elem = dragImageRef.current;
		if (elem) {
			let br = elem.getBoundingClientRect();
			event.dataTransfer.setDragImage(elem, event.clientX - br.left, event.clientY - br.top);
		}
		onDragStart(annotation, event.dataTransfer);
	};

	let rect = annotation.range.getBoundingClientRect();
	rect.x += doc.defaultView.scrollX;
	rect.y += doc.defaultView.scrollY;
	let rtl = getComputedStyle(closestElement(annotation.range.commonAncestorContainer!)!).direction === 'rtl';
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
			onPointerDown={disablePointerEvents || !onPointerDown ? undefined : (event => onPointerDown!(annotation, event))}
			onPointerUp={disablePointerEvents || !onPointerUp ? undefined : (event => onPointerUp!(annotation, event))}
			onDragStart={disablePointerEvents ? undefined : handleDragStart}
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
	onDragStart?: (annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => void;
	disablePointerEvents: boolean;
};

const NotePreview: React.FC<NotePreviewProps> = (props) => {
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
type NotePreviewProps = {
	annotation: DisplayedAnnotation;
};

const StaggeredNotes: React.FC<StaggeredNotesProps> = (props) => {
	let { annotations, selectedAnnotationIDs, onPointerDown, onPointerUp, onDragStart, pointerEventsSuppressed } = props;
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
						onDragStart={onDragStart}
						disablePointerEvents={pointerEventsSuppressed}
					/>
				);
			}
			else {
				return (
					<Note
						annotation={annotation}
						staggerIndex={stagger}
						key={annotation.key}
						selected={false}
						disablePointerEvents={true}
					/>
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
	onDragStart: (annotation: DisplayedAnnotation, dataTransfer: DataTransfer) => void;
	pointerEventsSuppressed: boolean;
};

const SelectionBorder: React.FC<SelectionBorderProps> = React.memo((props) => {
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
}, (prev, next) => JSON.stringify(prev.rect) === JSON.stringify(next.rect));
SelectionBorder.displayName = 'SelectionBorder';
type SelectionBorderProps = {
	rect: DOMRect;
	preview?: boolean;
};

const RangeSelectionBorder: React.FC<RangeSelectionBorderProps> = (props) => {
	let rect = props.range.getBoundingClientRect();
	let win = props.range.commonAncestorContainer.ownerDocument!.defaultView!;
	rect.x += win.scrollX;
	rect.y += win.scrollY;
	return <SelectionBorder rect={rect}/>;
};
RangeSelectionBorder.displayName = 'RangeSelectionBorder';
type RangeSelectionBorderProps = {
	range: Range;
};

const Resizer: React.FC<ResizerProps> = (props) => {
	let WIDTH = 3;

	let { annotation, highlightRects, onResize, onResizeEnd, onResizeStart } = props;
	let [resizingSide, setResizingSide] = useState<false | 'start' | 'end'>(false);
	let [pointerCapture, setPointerCapture] = useState<{ elem: Element, pointerId: number } | null>(null);

	let rtl = getComputedStyle(closestElement(annotation.range.commonAncestorContainer!)!).direction == 'rtl';

	highlightRects = Array.from(highlightRects)
		.sort((a, b) => (a.bottom - b.bottom) || (a.left - b.left));

	let handlePointerDown = (event: React.PointerEvent, isStart: boolean) => {
		if (event.button !== 0) {
			return;
		}
		(event.target as Element).setPointerCapture(event.pointerId);
		setResizingSide(isStart ? 'start' : 'end');
		setPointerCapture({ elem: event.target as Element, pointerId: event.pointerId });
		onResizeStart(annotation);
	};

	let handlePointerUp = (event: React.PointerEvent) => {
		if (event.button !== 0
				|| !resizingSide
				|| !(event.target as Element).hasPointerCapture(event.pointerId)) {
			return;
		}
		(event.target as Element).releasePointerCapture(event.pointerId);
		setResizingSide(false);
		setPointerCapture(null);
		onResizeEnd(annotation, false);
	};

	let handleKeyDown = useCallback((event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !resizingSide || !pointerCapture) {
			return;
		}
		pointerCapture.elem.releasePointerCapture(pointerCapture.pointerId);
		setResizingSide(false);
		setPointerCapture(null);
		onResizeEnd(annotation, true);
	}, [pointerCapture, onResizeEnd, annotation, resizingSide]);

	let doc = annotation.range.commonAncestorContainer.ownerDocument;
	let win = doc?.defaultView;

	useEffect(() => {
		if (!win) {
			return undefined;
		}
		win.addEventListener('keydown', handleKeyDown, true);
		return () => win?.removeEventListener('keydown', handleKeyDown, true);
	}, [win, handleKeyDown]);

	let handlePointerMove = (event: React.PointerEvent, isStart: boolean) => {
		let pos = caretPositionFromPoint(event.view.document, event.clientX, event.clientY);
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
	};

	if (!highlightRects.length) {
		return null;
	}

	let topLeftRect = highlightRects[rtl ? highlightRects.length - 1 : 0];
	let bottomRightRect = highlightRects[rtl ? 0 : highlightRects.length - 1];

	return <>
		<rect
			x={topLeftRect.left - WIDTH}
			y={topLeftRect.top}
			width={WIDTH}
			height={topLeftRect.height}
			fill={annotation.color}
			style={{ pointerEvents: 'all', cursor: 'col-resize' }}
			onPointerDown={event => handlePointerDown(event, true)}
			onPointerUp={event => handlePointerUp(event)}
			onPointerMove={resizingSide == 'start' ? (event => handlePointerMove(event, !rtl)) : undefined}
		/>
		<rect
			x={bottomRightRect.right}
			y={bottomRightRect.top}
			width={WIDTH}
			height={bottomRightRect.height}
			fill={annotation.color}
			style={{ pointerEvents: 'all', cursor: 'col-resize' }}
			onPointerDown={event => handlePointerDown(event, false)}
			onPointerUp={event => handlePointerUp(event)}
			onPointerMove={resizingSide == 'end' ? (event => handlePointerMove(event, rtl)) : undefined}
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
			ref={ref}
		>
			<IconNoteLarge/>
		</svg>
		{props.selected && (
			<SelectionBorder rect={new DOMRect(x, y, size, size)}/>
		)}
		{(props.onPointerDown || props.onPointerUp || props.onDragStart || props.onDragEnd) && (
			<foreignObject
				x={x}
				y={y}
				width={size}
				height={size}
			>
				<div
					// @ts-ignore
					xmlns="http://www.w3.org/1999/xhtml"
					style={{
						pointerEvents: 'auto',
						cursor: 'pointer',
						width: '100%',
						height: '100%',
					}}
					draggable={true}
					onPointerDown={props.onPointerDown}
					onPointerUp={props.onPointerUp}
					onDragStart={props.onDragStart}
					onDragEnd={props.onDragEnd}
					data-annotation-id={props.annotation?.id}
				/>
			</foreignObject>
		)}
	</>;
});
CommentIcon.displayName = 'CommentIcon';
CommentIcon = React.memo(CommentIcon);
type CommentIconProps = {
	annotation?: { id?: string },
	x: number;
	y: number;
	color: string;
	opacity?: string | number;
	selected?: boolean;
	large?: boolean;
	onPointerDown?: (event: React.PointerEvent) => void;
	onPointerUp?: (event: React.PointerEvent) => void;
	onDragStart?: (event: React.DragEvent) => void;
	onDragEnd?: (event: React.DragEvent) => void;
};
