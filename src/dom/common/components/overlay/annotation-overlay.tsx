import React, {
	LegacyRef,
	useState
} from 'react';
import {
	caretPositionFromPoint,
	collapseToOneCharacterAtStart,
	splitRangeToTextNodes,
	supportsCaretPositionFromPoint
} from "../../lib/range";
import PropTypes from "prop-types";
import { AnnotationType } from "../../../../common/types";
import ReactDOM from "react-dom";
import { IconNoteLarge } from "../../../../common/components/common/icons";
import { closestElement } from "../../lib/nodes";

export type DisplayedAnnotation = {
	id?: string;
	type: AnnotationType;
	color?: string;
	text?: string;
	comment?: string;
	range: Range;
};

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = (props) => {
	const { annotations, selectedAnnotationIDs, onSelect, onDragStart, onResize, disablePointerEvents, scale } = props;
	
	const [widgetContainer, setWidgetContainer] = useState<Element | null>(null);
	
	const handlePointerDown = (event: React.PointerEvent, id: string) => {
		if (event.button !== 0) {
			return;
		}
		// Cycle selection if clicked annotation is already selected
		if (selectedAnnotationIDs.includes(id)) {
			const targets = event.view.document.elementsFromPoint(event.clientX, event.clientY)
				.filter(target => !!target.getAttribute('data-annotation-id'));
			if (!targets.length) {
				return;
			}
			const nextTarget = targets[(targets.indexOf(event.target as Element) + 1) % targets.length];
			onSelect(nextTarget.getAttribute('data-annotation-id')!);
		}
		else {
			onSelect(id);
		}
	};
	
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
			{annotations.map((annotation, i) => {
				if (annotation.type != 'highlight') {
					return null;
				}
				if (annotation.id) {
					return (
						<Highlight
							annotation={annotation}
							key={annotation.id}
							selected={selectedAnnotationIDs.includes(annotation.id)}
							onPointerDown={event => handlePointerDown(event, annotation.id!)}
							onDragStart={dataTransfer => onDragStart(dataTransfer, annotation.id!)}
							onResize={range => onResize(annotation.id!, range)}
							disablePointerEvents={disablePointerEvents}
							widgetContainer={widgetContainer}
							scale={scale}
						/>
					);
				}
				else {
					return (
						<Highlight
							annotation={annotation}
							key={i}
							selected={false}
							disablePointerEvents={true}
							widgetContainer={widgetContainer}
							scale={scale}
						/>
					);
				}
			})}
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
			ref={c => setWidgetContainer(c)}
		>
			{annotations.map((annotation, i) => {
				if (annotation.type != 'note') {
					return null;
				}
				if (annotation.id) {
					return (
						<Note
							annotation={annotation}
							key={annotation.id}
							selected={selectedAnnotationIDs.includes(annotation.id)}
							onPointerDown={event => handlePointerDown(event, annotation.id!)}
							onDragStart={dataTransfer => onDragStart(dataTransfer, annotation.id!)}
							disablePointerEvents={disablePointerEvents}
							scale={scale}
						/>
					);
				}
				else {
					return (
						<Note
							annotation={annotation}
							key={i}
							selected={false}
							disablePointerEvents={true}
							scale={scale}
						/>
					);
				}
			})}
		</svg>
	</>;
};
AnnotationOverlay.displayName = 'AnnotationOverlay';

type AnnotationOverlayProps = {
	annotations: DisplayedAnnotation[];
	selectedAnnotationIDs: string[];
	onSelect: (id: string) => void;
	onDragStart: (dataTransfer: DataTransfer, id: string) => void;
	onResize: (id: string, range: Range) => void;
	disablePointerEvents: boolean;
	// Passed down to invalidate memoized subcomponents on zoom
	scale?: number;
};

const Highlight: React.FC<HighlightProps> = React.memo((props) => {
	const { annotation, selected, onPointerDown, onDragStart, onResize, disablePointerEvents, widgetContainer } = props;
	const [dragImage, setDragImage] = useState<Element | null>(null);
	const [isResizing, setResizing] = useState(false);

	const ranges = splitRangeToTextNodes(annotation.range);
	if (!ranges.length) {
		return null;
	}
	const doc = ranges[0].commonAncestorContainer.ownerDocument;
	if (!doc || !doc.defaultView) {
		return null;
	}

	const handleDragStart = (event: React.DragEvent) => {
		if (!onDragStart || annotation.text === undefined) {
			return;
		}

		const elem = (event.target as Element).closest('g')!;
		const br = elem.getBoundingClientRect();
		event.dataTransfer.setDragImage(elem, event.clientX - br.left, event.clientY - br.top);
		onDragStart(event.dataTransfer);
	};

	const handleDragEnd = () => {
		if (dragImage) {
			dragImage.remove();
			setDragImage(null);
		}
	};

	const highlightRects = new Map<string, DOMRect>();
	for (const range of ranges) {
		for (const rect of range.getClientRects()) {
			if (rect.width == 0 || rect.height == 0) {
				continue;
			}
			const key = JSON.stringify(rect);
			if (!highlightRects.has(key)) {
				highlightRects.set(key, rect);
			}
		}
	}

	let commentIconPosition;
	if (annotation.comment) {
		const commentIconRange = ranges[0].cloneRange();
		collapseToOneCharacterAtStart(commentIconRange);
		const rect = commentIconRange.getBoundingClientRect();
		commentIconPosition = { x: rect.x + doc.defaultView!.scrollX, y: rect.y + doc.defaultView!.scrollY };
	}
	else {
		commentIconPosition = null;
	}
	return <>
		<g fill={annotation.color}>
			{[...highlightRects.entries()].map(([key, rect]) => (
				<rect
					x={rect.x + doc.defaultView!.scrollX}
					y={rect.y + doc.defaultView!.scrollY}
					width={rect.width}
					height={rect.height}
					opacity="50%"
					key={key}/>
			))}
			{!disablePointerEvents && !isResizing && [...highlightRects.entries()].map(([key, rect]) => (
				// Yes, this is horrible, but SVGs don't support drag events without embedding HTML in a <foreignObject>
				<foreignObject
					x={rect.x + doc.defaultView!.scrollX}
					y={rect.y + doc.defaultView!.scrollY}
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
						onPointerDown={onPointerDown}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
						data-annotation-id={annotation.id}/>
				</foreignObject>
			))}
			{!disablePointerEvents && onResize && selected && supportsCaretPositionFromPoint() && (
				<Resizer
					annotation={annotation}
					highlightRects={[...highlightRects.values()]}
					onPointerDown={() => setResizing(true)}
					onPointerUp={() => setResizing(false)}
					onResize={onResize}
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
});
Highlight.displayName = 'Highlight';
type HighlightProps = {
	annotation: DisplayedAnnotation;
	selected: boolean;
	onPointerDown?: (event: React.PointerEvent) => void;
	onDragStart?: (dataTransfer: DataTransfer) => void;
	onResize?: (range: Range) => void;
	disablePointerEvents: boolean;
	widgetContainer: Element | null;
	scale?: number;
};

const Note: React.FC<NoteProps> = React.memo((props) => {
	const { annotation, selected, onPointerDown, onDragStart, disablePointerEvents } = props;
	const iconRef = React.useRef<SVGSVGElement>(null);

	const ranges = splitRangeToTextNodes(annotation.range);
	if (!ranges.length) {
		return null;
	}
	const doc = ranges[0].commonAncestorContainer.ownerDocument;
	if (!doc || !doc.defaultView) {
		return null;
	}

	const handleDragStart = (event: React.DragEvent) => {
		if (!onDragStart || annotation.comment === undefined) {
			return;
		}

		const elem = event.target as Element;
		const br = elem.getBoundingClientRect();
		event.dataTransfer.setDragImage(iconRef.current!, event.clientX - br.left, event.clientY - br.top);
		onDragStart(event.dataTransfer);
	};

	const rect = annotation.range.getBoundingClientRect();
	const ltr = getComputedStyle(closestElement(annotation.range.commonAncestorContainer!)!).direction != 'rtl';
	return (
		<CommentIcon
			x={rect.x + (ltr ? rect.width + 25 : -25) + doc.defaultView!.scrollX}
			y={rect.y + doc.defaultView!.scrollY}
			color={annotation.color!}
			opacity={annotation.id ? '100%' : '50%'}
			selected={selected}
			large={true}
			onPointerDown={disablePointerEvents ? undefined : onPointerDown}
			onDragStart={disablePointerEvents ? undefined : handleDragStart}
			ref={iconRef}
		/>
	);
});
Note.displayName = 'Note';
type NoteProps = {
	annotation: DisplayedAnnotation;
	selected: boolean;
	onPointerDown?: (event: React.PointerEvent) => void;
	onDragStart?: (dataTransfer: DataTransfer) => void;
	disablePointerEvents: boolean;
	scale?: number;
};

const SelectionBorder: React.FC<SelectionBorderProps> = (props) => {
	return (
		<rect
			x={props.rect.x + props.win.scrollX - 5}
			y={props.rect.y + props.win.scrollY - 5}
			width={props.rect.width + 10}
			height={props.rect.height + 10}
			fill="none"
			stroke="#6d95e0"
			strokeDasharray="10 6"
			strokeWidth={2}/>
	);
};
SelectionBorder.displayName = 'SelectionBorder';
type SelectionBorderProps = {
	rect: DOMRect;
	win: Window;
};

const RangeSelectionBorder: React.FC<RangeSelectionBorderProps> = (props) => {
	const rect = props.range.getBoundingClientRect();
	const win = props.range.commonAncestorContainer.ownerDocument!.defaultView!;
	return <SelectionBorder rect={rect} win={win}/>;
};
RangeSelectionBorder.displayName = 'RangeSelectionBorder';
type RangeSelectionBorderProps = {
	range: Range;
};

const Resizer: React.FC<ResizerProps> = (props) => {
	const WIDTH = 3;

	const [resizingSide, setResizingSide] = useState<false | 'start' | 'end'>(false);
	
	// TODO: RTL
	const highlightRects = Array.from(props.highlightRects)
		.sort((a, b) => (a.top - b.top) || (a.left - b.left));
	const startRect = highlightRects[0];
	const endRect = highlightRects[highlightRects.length - 1];
	
	const handlePointerDown = (event: React.PointerEvent, isStart: boolean) => {
		if (event.button !== 0) {
			return;
		}
		(event.target as Element).setPointerCapture(event.pointerId);
		setResizingSide(isStart ? 'start' : 'end');
		props.onPointerDown();
	};
	
	const handlePointerUp = (event: React.PointerEvent) => {
		if (event.button !== 0) {
			return;
		}
		(event.target as Element).releasePointerCapture(event.pointerId);
		setResizingSide(false);
		props.onPointerUp();
	};

	const handleResize = (event: React.PointerEvent, isStart: boolean) => {
		const pos = caretPositionFromPoint(event.view.document, event.clientX, event.clientY);
		if (pos) {
			const newRange = props.annotation.range.cloneRange();
			if (isStart) {
				if (newRange.startContainer === pos.offsetNode && newRange.startOffset === pos.offset) {
					return;
				}
				newRange.setStart(pos.offsetNode, pos.offset);
			}
			else {
				if (newRange.endContainer === pos.offsetNode && newRange.endOffset === pos.offset) {
					return;
				}
				newRange.setEnd(pos.offsetNode, pos.offset);
			}
			props.onResize(newRange);
		}
	};

	const win = props.annotation.range.commonAncestorContainer.ownerDocument!.defaultView!;
	return <>
		<rect
			x={startRect.x + win.scrollX - WIDTH}
			y={startRect.y + win.scrollY}
			width={WIDTH}
			height={startRect.height}
			fill={props.annotation.color}
			style={{ pointerEvents: 'all', cursor: 'col-resize' }}
			onPointerDown={event => handlePointerDown(event, true)}
			onPointerUp={event => handlePointerUp(event)}
			onPointerMove={resizingSide == 'start' ? (event => handleResize(event, true)) : undefined}
		/>
		<rect
			x={endRect.right + win.scrollX}
			y={endRect.y + win.scrollY}
			width={WIDTH}
			height={endRect.height}
			fill={props.annotation.color}
			style={{ pointerEvents: 'all', cursor: 'col-resize' }}
			onPointerDown={event => handlePointerDown(event, false)}
			onPointerUp={event => handlePointerUp(event)}
			onPointerMove={resizingSide == 'end' ? (event => handleResize(event, false)) : undefined}
		/>
	</>;
};
Resizer.displayName = 'Resizer';
type ResizerProps = {
	annotation: DisplayedAnnotation;
	highlightRects: DOMRect[];
	onPointerDown: () => void;
	onPointerUp: () => void;
	onResize: (range: Range) => void;
};

let CommentIcon = React.forwardRef<SVGSVGElement, CommentIconProps>((props, ref) => {
	const size = props.large ? 24 : 14;
	const x = props.x - size / 2;
	const y = props.y - size / 2;
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
			<SelectionBorder
				rect={new DOMRect(x, y, size, size)}
				win={window}
			/>
		)}
		{(props.onPointerDown || props.onDragStart || props.onDragEnd) && (
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
					onDragStart={props.onDragStart}
					onDragEnd={props.onDragEnd}/>
			</foreignObject>
		)}
	</>;
});
CommentIcon.displayName = 'CommentIcon';
CommentIcon.propTypes = {
	x: PropTypes.number.isRequired,
	y: PropTypes.number.isRequired,
	color: PropTypes.string.isRequired,
	opacity: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
	selected: PropTypes.bool,
	large: PropTypes.bool,
	onPointerDown: PropTypes.func,
	onDragStart: PropTypes.func,
	onDragEnd: PropTypes.func,
};
CommentIcon = React.memo(CommentIcon);
type CommentIconProps = {
	x: number;
	y: number;
	color: string;
	opacity?: string | number;
	selected?: boolean;
	large?: boolean;
	onPointerDown?: (event: React.PointerEvent) => void;
	onDragStart?: (event: React.DragEvent) => void;
	onDragEnd?: (event: React.DragEvent) => void;
};
