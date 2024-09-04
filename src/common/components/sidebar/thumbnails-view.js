import React, { Fragment, useState, useCallback, useContext, useEffect, useRef, useImperativeHandle, memo } from 'react';
import { useIntl, FormattedMessage } from 'react-intl';
import cx from 'classnames';
import { pressedNextKey, pressedPreviousKey } from '../../lib/utilities';
import { ReaderContext } from '../../reader';
import IconOptions from '../../../../res/icons/16/options.svg';

const Thumbnail = memo(({ thumbnail, selected, pageLabel, onContextMenu }) => {
	const intl = useIntl();
	return (
		<div
			className={cx('thumbnail', { selected })}
			data-page-index={thumbnail.pageIndex}
			onContextMenu={onContextMenu}
			role="option"
			aria-label={intl.formatMessage({ id: 'pdfReader.page' }) + `${pageLabel}`}
			aria-selected={selected}
			id={`thumbnail_${thumbnail.pageIndex}`}
		>
			<div className="image">
				{thumbnail.image
					? <img width={thumbnail.width} height={thumbnail.height} src={thumbnail.image} draggable={false} />
					: <div className="placeholder" style={{ width: thumbnail.width + 'px', height: thumbnail.height + 'px' }} />
				}
			</div>
			<div className="label">{pageLabel}</div>
		</div>
	);
});

Thumbnail.displayName = 'Thumbnail';



function ThumbnailsView(props) {
	const intl = useIntl();
	const [selected, setSelected] = useState([0]);
	const containerRef = useRef();
	const { onOpenThumbnailContextMenu } = props;
	const { platform } = useContext(ReaderContext);

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
			root: document.querySelector('.sidebar-content'),
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

	const handleContextMenu = useCallback((event) => {
		if (platform === 'web') {
			return;
		}
		event.preventDefault();
		onOpenThumbnailContextMenu({
			x: event.clientX,
			y: event.clientY,
			pageIndexes: selected
		});
	}, [onOpenThumbnailContextMenu, platform, selected]);

	const handleMoreClick = useCallback((event) => {
		event.preventDefault();
		const { x, bottom: y } = event.target.getBoundingClientRect();
		onOpenThumbnailContextMenu({
			x, y,
			pageIndexes: selected,
		});
	}, [onOpenThumbnailContextMenu, selected]);

	return (
		<div id="thumbnailsView" className="thumbnails-view" role="tabpanel" aria-labelledby="viewThumbnail">
			{platform === 'web' && (
				<div className="thumbnails-header">
					<FormattedMessage id="pdfReader.selectedPages" values={ { count: selected.length }} />
					<button
						tabIndex={-1}
						data-tabstop={1}
						className="toolbar-button"
						title={intl.formatMessage({ id: 'pdfReader.pageOptions' })}
						onClick={handleMoreClick}
					><IconOptions/></button>
				</div>
			)}
			<div
				className="thumbnails"
				data-tabstop={1}
				onKeyDown={handleKeyDown}
				onMouseDown={handleMouseDown}
				ref={containerRef}
				tabIndex={-1}
				role="listbox"
				aria-label={intl.formatMessage({ id: "pdfReader.thumbnails" })}
				aria-activedescendant={`thumbnail_${selected[selected.length-1]}`}
				aria-multiselectable="true"
			>
				{props.thumbnails.map((thumbnail, index) => {
					let pageLabel = props.pageLabels[index] || (index + 1).toString();
					return (
						<Thumbnail
							key={index}
							thumbnail={thumbnail}
							selected={selected.includes(index)}
							pageLabel={pageLabel}
							contextMenu={props.contextMenu}
							onContextMenu={handleContextMenu}
						/>
					);
				})}
			</div>
		</div>
	);
}

export default ThumbnailsView;
