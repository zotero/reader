'use strict';

import React, { Fragment, useState, useCallback, useEffect, useRef } from 'react';
import cx from 'classnames';
import { wx, hy } from '../lib/coordinates';

const PADDING_LEFT = 9;
const PADDING_TOP = 9;

const MIN_WIDTH = 20;
const MIN_HEIGHT = 20;

function Area({ annotation, move, isSelected, onResizeStart, onDragStart, onDragEnd, onChangePosition }) {
	const [resizingRect, setResizingRect] = useState();
	const draggableRef = useRef();
	const resizingDirections = useRef();
	const container = useRef(
		document.querySelector('div.page[data-page-number="' + (annotation.position.pageIndex + 1) + '"]')
	);

	// TODO: Fix `annotation` triggering useEffect on each render
	const handlePointerMoveCallback = useCallback(handlePointerMove, [annotation]);
	const handlePointerUpCallback = useCallback(handlePointerUp, [annotation]);
	const handleKeyDownCallback = useCallback(handleKeyDown, []);


	useEffect(() => {
		window.addEventListener('mousemove', handlePointerMoveCallback);
		window.addEventListener('mouseup', handlePointerUpCallback);
		document.getElementById('viewerContainer').addEventListener('keydown', handleKeyDownCallback);
		return () => {
			window.removeEventListener('mousemove', handlePointerMoveCallback);
			window.removeEventListener('mouseup', handlePointerUpCallback);
			document.getElementById('viewerContainer').removeEventListener('keydown', handleKeyDownCallback);
		};
	}, [handlePointerMoveCallback, handlePointerUpCallback, handleKeyDownCallback]);

	function getResizedRect(rect, clientX, clientY) {
		let clientRect = container.current.getBoundingClientRect();
		let pageWidth = clientRect.width;
		let pageHeight = clientRect.height;
		let x = clientX - clientRect.left - PADDING_LEFT;
		let y = clientY - clientRect.top - PADDING_TOP;

		rect = rect.slice();

		let scale = PDFViewerApplication.pdfViewer._currentScale;

		if (resizingDirections.current.includes('left')) {
			rect[0] = x > rect[2] - MIN_WIDTH * scale && rect[2] - MIN_WIDTH * scale || x > 0 && x || 0;
		}
		else if (resizingDirections.current.includes('right')) {
			rect[2] = x < rect[0] + MIN_WIDTH * scale && rect[0] + MIN_WIDTH * scale || x < pageWidth - PADDING_LEFT * 2 && x || pageWidth - PADDING_LEFT * 2;
		}

		if (resizingDirections.current.includes('top')) {
			rect[1] = y > rect[3] - MIN_HEIGHT * scale && rect[3] - MIN_HEIGHT * scale || y > 0 && y || 0;
		}
		else if (resizingDirections.current.includes('bottom')) {
			rect[3] = y < rect[1] + MIN_HEIGHT * scale && rect[1] + MIN_HEIGHT * scale || y < pageHeight - PADDING_TOP * 2 && y || pageHeight - PADDING_TOP * 2;
		}

		return rect;
	}

	function handleResizeStart(directions) {
		resizingDirections.current = directions;
		onResizeStart();
	}

	function handlePointerMove(event) {
		if (!resizingDirections.current) return;
		let rect = getResizedRect(annotation.position.rects[0], event.clientX, event.clientY);
		setResizingRect(rect);
	}

	function handlePointerUp(event) {
		if (!resizingDirections.current) return;
		let rect = getResizedRect(annotation.position.rects[0], event.clientX, event.clientY);
		onChangePosition({ ...annotation.position, rects: [rect] });
		resizingDirections.current = null;
		setResizingRect();
	}

	function handleKeyDown(event) {
		if (!resizingDirections.current) {
			return;
		}

		if (event.key === 'Escape') {
			resizingDirections.current = null;
			setResizingRect();
		}
	}

	let rect = resizingRect || annotation.position.rects[0];

	return (
		<Fragment>
			<div
				ref={draggableRef}
				// draggable={true}
				className={cx('area-annotation', {
					selected: isSelected,
					comment: !!annotation.comment
				})}
				style={{
					borderColor: annotation.color,
					left: Math.round(rect[0]),
					top: Math.round(rect[1]),
					width: wx(rect),
					height: hy(rect)
				}}
				// onDragStart={onDragStart}
				// onDragEnd={onDragEnd}
			>
				{!annotation.readOnly && <div className="resizer" onMouseDown={event => event.preventDefault()}>
					<div className="line top" onMouseDown={event => handleResizeStart(['top'])}/>
					<div className="line right" onMouseDown={event => handleResizeStart(['right'])}/>
					<div className="line bottom" onMouseDown={event => handleResizeStart(['bottom'])}/>
					<div className="line left" onMouseDown={event => handleResizeStart(['left'])}/>
					<div className="edge top-right" onMouseDown={event => handleResizeStart(['top', 'right'])}/>
					<div className="edge bottom-right" onMouseDown={event => handleResizeStart(['bottom', 'right'])}/>
					<div className="edge bottom-left" onMouseDown={event => handleResizeStart(['bottom', 'left'])}/>
					<div className="edge top-left" onMouseDown={event => handleResizeStart(['top', 'left'])}/>
				</div>}
			</div>
		</Fragment>
	);
}

export default Area;
