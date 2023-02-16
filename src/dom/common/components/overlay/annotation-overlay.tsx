import React, {
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

export type DisplayedAnnotation = {
	id?: string;
	type: AnnotationType;
	color?: string;
	text?: string;
	hasComment: boolean;
	range: Range;
};

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = (props) => {
	const { annotations, selectedAnnotationIDs, onSelect, onDragStart, onResize, disablePointerEvents } = props;
	
	const handleClick = (event: React.MouseEvent, id: string) => {
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
		{annotations.map((annotation, i) => {
			if (annotation.type == 'highlight') {
				return (
					<Highlight
						annotation={annotation}
						key={annotation.id || i}
						selected={!!annotation.id && selectedAnnotationIDs.includes(annotation.id)}
						onClick={event => annotation.id && handleClick(event, annotation.id)}
						onDragStart={dataTransfer => annotation.id && onDragStart(dataTransfer, annotation.id)}
						onResize={range => annotation.id && onResize(annotation.id, range)}
						disablePointerEvents={disablePointerEvents || !annotation.id}
					/>
				);
			}

			/*else if (annotation.type == 'image') {
				if (rawRange.startContainer instanceof HTMLElement && rawRange.startContainer.tagName == 'IMG') {
					// Select the containing img element
					rawRange.selectNode(rawRange.startContainer);
				}
				const ranges = [rawRange];
				return (
					<Image
						annotation={annotation}
						ranges={ranges}
						key={annotation.id}
						selected={props.selectedAnnotationIDs.includes(annotation.id)}
						onClick={() => props.onClick(annotation)}/>
				);
			}*/
			return null;
		})}
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
};

const Highlight: React.FC<HighlightProps> = (props) => {
	const { annotation, selected, onClick, onDragStart, onResize, disablePointerEvents } = props;
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
		if (annotation.text === undefined) {
			return;
		}

		event.dataTransfer.setDragImage((event.target as Element).closest('g')!, 0, 0);
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
	if (annotation.hasComment) {
		const commentIconRange = ranges[0].cloneRange();
		collapseToOneCharacterAtStart(commentIconRange);
		const rect = commentIconRange.getBoundingClientRect();
		commentIconPosition = { x: rect.x + doc.defaultView!.scrollX, y: rect.y + doc.defaultView!.scrollY };
	}
	else {
		commentIconPosition = null;
	}
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
							onClick={onClick}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							data-annotation-id={annotation.id}/>
					</foreignObject>
				))}
				{!disablePointerEvents && selected && supportsCaretPositionFromPoint() && (
					<Resizer
						annotation={annotation}
						highlightRects={[...highlightRects.values()]}
						onPointerDown={() => setResizing(true)}
						onPointerUp={() => setResizing(false)}
						onResize={onResize}
					/>
				)}
			</g>
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
		>
			{selected && !isResizing && (
				<SelectionBorder range={annotation.range}/>
			)}
			{commentIconPosition && (
				<CommentIcon {...commentIconPosition} color={annotation.color!}/>
			)}
		</svg>
	</>;
};
Highlight.displayName = 'Highlight';
type HighlightProps = {
	annotation: DisplayedAnnotation;
	selected: boolean;
	onClick: (event: React.MouseEvent) => void;
	onDragStart: (dataTransfer: DataTransfer) => void;
	onResize: (range: Range) => void;
	disablePointerEvents: boolean;
};

const SelectionBorder: React.FC<SelectionBorderProps> = (props) => {
	const rect = props.range.getBoundingClientRect();
	const win = props.range.commonAncestorContainer.ownerDocument!.defaultView!;
	return (
		<rect
			x={rect.x + win.scrollX - 5}
			y={rect.y + win.scrollY - 5}
			width={rect.width + 10}
			height={rect.height + 10}
			fill="none"
			stroke="#6d95e0"
			strokeDasharray="10 6"
			strokeWidth={2}/>
	);
};
SelectionBorder.displayName = 'SelectionBorder';
type SelectionBorderProps = {
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
				newRange.setStart(pos.offsetNode, pos.offset);
			}
			else {
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

const CommentIcon: React.FC<CommentIconProps> = React.memo((props) => {
	return (
		<g transform={`translate(${props.x - 7}, ${props.y - 7}) scale(0.6)`}>
			<path
				d="M 0.5 0.5 L 23.5 0.5 23.5 23.5 11.5 23.5 0.5 12.5 0.5 0.5"
				fill={props.color}
			/>
			<path
				d="M 0.5 12.5 L 11.5 12.5 11.5 23.5 0.5 12.5"
				fill="rgba(255, 255, 255, 0.4)"
			/>
			<path
				d="M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z"
				fill="#000"
			/>
		</g>
	);
});
CommentIcon.displayName = 'CommentIcon';
CommentIcon.propTypes = {
	x: PropTypes.number.isRequired,
	y: PropTypes.number.isRequired,
	color: PropTypes.string.isRequired
};
type CommentIconProps = {
	x: number;
	y: number;
	color: string;
};
