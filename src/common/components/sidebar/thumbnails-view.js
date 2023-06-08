import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';
import { pressedNextKey, pressedPreviousKey } from '../../lib/utilities';

function Thumbnail({ thumbnail, selected, pageLabel, onContextMenu }) {
	return (
		<div
			className={cx('thumbnail', { selected })}
			data-page-index={thumbnail.pageIndex}
			onContextMenu={onContextMenu}
		>
			<div className="image">
				{thumbnail.image
					? <img width={thumbnail.width} height={thumbnail.height} src={thumbnail.image} draggable={false}/>
					: <div className="placeholder" style={{ width: thumbnail.width + 'px', height: thumbnail.height + 'px' }}/>
				}
			</div>
			<div className="label">{pageLabel}</div>
		</div>
	);
}

function ThumbnailsView(props) {
	const intl = useIntl();
	const [selected, setSelected] = useState([0]);
	const containerRef = useRef();

	useEffect(() => {
		if (selected.length <= 1) {
			if (props.currentPageIndex !== undefined) {
				setSelected([props.currentPageIndex]);
				containerRef.current.children[props.currentPageIndex]?.scrollIntoView({
					block: 'nearest',
					inline: 'nearest'
				});
			}
		}
	}, [props.currentPageIndex]);

	useEffect (() => {
		let options = {
			root: containerRef.current.parentNode,
			rootMargin: "200px",
			threshold: 1.0
		};

		function intersectionCallback(entries) {
			let pageIndexes = [];
			for (let entry of entries) {
				if (entry.isIntersecting) {
					let pageIndex = parseInt(entry.target.getAttribute('data-page-index'));
					pageIndexes.unshift(pageIndex);
				}
			}
			if (pageIndexes.length) {
				props.onRenderThumbnails(pageIndexes);
			}
		}

		const observer = new IntersectionObserver(intersectionCallback, options);

		let nodes = containerRef.current.querySelectorAll('.thumbnail');
		for (let node of nodes) {
			observer.observe(node);
		}

		return () => {
			observer.disconnect();
		};
	}, [props.thumbnails]);

	function handleMouseDown(event) {
		let thumbnail = event.target.closest('.thumbnail');
		if (thumbnail) {
			let pageIndex = Array.from(containerRef.current.children).indexOf(thumbnail);
			if (event.buttons !== 1 && selected.includes(pageIndex)) {
				return;
			}
			if (event.shiftKey) {
				let lastSelected = selected.slice(-1);
				let min = Math.min(...lastSelected, pageIndex);
				let max = Math.max(...lastSelected, pageIndex);
				let range = [];
				for (let i = min; i <= max; i++) {
					range.push(i);
				}
				setSelected([...new Set([...selected, ...range])]);
			}
			else if (event.metaKey || event.ctrlKey) {
				if (selected.includes(pageIndex)) {
					setSelected(selected.filter(x => x !== pageIndex));
				}
				else {
					setSelected([...selected, pageIndex]);
				}
			}
			else {
				setSelected([pageIndex]);
				props.onNavigate({ pageIndex });
			}
		}
	}

	function handleKeyDown(e) {
		e.preventDefault();
		if (pressedPreviousKey(e)) {
			let pageIndex = selected[selected.length - 1];
			if (pageIndex === undefined) {
				pageIndex = 0;
			}
			else {
				pageIndex -= 1;
				if (pageIndex < 0) {
					pageIndex = 0;
				}
			}
			if (e.shiftKey) {
				if (selected.includes(pageIndex) && selected.length >= 2) {
					setSelected(selected.filter(x => x !== pageIndex + 1));
				}
				else {
					setSelected([...new Set([...selected, pageIndex])]);
				}
			}
			else {
				setSelected([pageIndex]);
				props.onNavigate({ pageIndex });
			}
			containerRef.current.children[pageIndex].scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
		else if (pressedNextKey(e)) {
			let pageIndex = selected[selected.length - 1];
			if (pageIndex === undefined) {
				pageIndex = 0;
			}
			else {
				pageIndex += 1;
				if (pageIndex === containerRef.current.children.length) {
					pageIndex = containerRef.current.children.length - 1;
				}
			}
			if (e.shiftKey) {
				if (selected.includes(pageIndex) && selected.length >= 2) {
					setSelected(selected.filter(x => x !== pageIndex - 1));
				}
				else {
					setSelected([...new Set([...selected, pageIndex])]);
				}
			}
			else {
				setSelected([pageIndex]);
				props.onNavigate({ pageIndex });
			}
			containerRef.current.children[pageIndex].scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
		else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
			let range = [];
			for (let i = 0; i < containerRef.current.children.length; i++) {
				range.push(i);
			}
			setSelected(range);
		}
		else if (e.key === 'Escape') {
			setSelected([props.currentPageIndex]);
			containerRef.current.children[props.currentPageIndex]?.scrollIntoView({
				block: 'nearest',
				inline: 'nearest'
			});
		}
	}

	function handleContextMenu(event) {
		event.preventDefault();
		props.onOpenThumbnailContextMenu({
			x: event.clientX,
			y: event.clientY,
			pageIndexes: selected
		});
	}

	return (
		<div
			ref={containerRef}
			className="thumbnails-view"
			tabIndex={-1}
			data-tabstop={1}
			onMouseDown={handleMouseDown}
			onKeyDown={handleKeyDown}
		>
			{props.thumbnails.map((thumbnail, index) => {
				let pageLabel = props.pageLabels[index] || (index + 1).toString();
				return (
					<Thumbnail
						key={index}
						thumbnail={thumbnail}
						selected={selected.includes(index)}
						pageLabel={pageLabel}
						onContextMenu={handleContextMenu}
					/>
				);
			})}
		</div>
	);
}

export default ThumbnailsView;
