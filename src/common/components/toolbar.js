import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle, useLayoutEffect } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';

function Toolbar(props) {
	const intl = useIntl();
	const pageInputRef = useRef();

	useEffect(() => {
		if (['pdf', 'epub'].includes(props.type)) {
			pageInputRef.current.value = props.pageLabel || (props.pageIndex + 1);
		}
	}, [props.pageLabel, props.pageIndex]);

	function handleSidebarButtonClick(event) {
		props.onToggleSidebar(!props.sidebarOpen);
	}

	function handleToolColorClick(event) {
		let br = event.currentTarget.getBoundingClientRect();
		props.onOpenColorContextMenu({ x: br.left, y: br.bottom });
	}

	function handleFindClick(event) {
		props.onToggleFind();
	}

	function handleToolClick(type) {
		if (props.tool.type === type) {
			type = 'pointer';
		}
		props.onChangeTool({ ...props.tool, type });
	}

	function handlePageNumberKeydown(event) {
		if (event.key === 'Enter') {
			props.onChangePageNumber(event.target.value);
		}
	}

	function handlePageNumberBlur(event) {
		props.onChangePageNumber(event.target.value);
	}

	return (
		<div className="toolbar" data-tabstop={1}>
			<div className="start">
				<button
					id="sidebarToggle"
					className="toolbarButton"
					title="Toggle Sidebar"
					tabIndex={-1}
					onClick={handleSidebarButtonClick}
				/>
				<div className="toolbarButtonSpacer"></div>
				<div className="splitToolbarButton">
					<button
						id="zoomOut"
						className="toolbarButton zoomOut"
						title="Zoom Out"
						tabIndex={-1}
						disabled={!props.enableZoomOut}
						onClick={props.onZoomOut}
					/>
					<button
						id="zoomIn"
						className="toolbarButton zoomIn"
						title="Zoom In"
						tabIndex={-1}
						disabled={!props.enableZoomIn}
						onClick={props.onZoomIn}

					/>
					<button
						id="zoomAuto"
						className="toolbarButton zoomAuto"
						title="Zoom Auto"
						tabIndex={-1}
						disabled={!props.enableZoomReset}
						onClick={props.onZoomReset}
					/>
				</div>
				<button
					id="navigateBack"
					className="toolbarButton navigateBack"
					title="Back"
					tabIndex={-1}
					disabled={!props.enableNavigateBack}
					onClick={props.onNavigateBack}
				/>
				{['pdf', 'epub'].includes(props.type) && (
					<div className="splitToolbarButton">
						<button
							className="toolbarButton pageUp"
							title="Previous Page"
							id="previous"
							tabIndex={-1}
							disabled={!props.enableNavigateToPreviousPage}
							onClick={props.onNavigateToPreviousPage}
						/>
						<button
							className="toolbarButton pageDown"
							title="Next Page"
							id="next"
							tabIndex={-1}
							disabled={!props.enableNavigateToNextPage}
							onClick={props.onNavigateToNextPage}

						/>
					</div>
				)}
				{['pdf', 'epub'].includes(props.type) && (
					<input
						ref={pageInputRef}
						type="input"
						id="pageNumber"
						className="toolbarField pageNumber"
						title={props.type == 'pdf' ? "Page" : "Location"}
						defaultValue=""
						size="4"
						min="1"
						tabIndex={-1}
						autoComplete="off"
						onKeyDown={handlePageNumberKeydown}
						onBlur={handlePageNumberBlur}
					/>)}
				{props.pageLabel && (
					<span id="numPages" className="toolbarLabel">{props.pageIndex + 1}/{props.pagesCount}</span>
				)}
			</div>
			<div className="center">
				<div className="tool-group annotation-tools">
					<button
						tabIndex={-1}
						className={cx('toolbarButton highlight', { toggled: props.tool.type === 'highlight' })}
						title={intl.formatMessage({ id: 'pdfReader.highlightText' })}
						onClick={() => handleToolClick('highlight')}>
						<span className="button-background"/>
					</button>
					<button
						tabIndex={-1}
						className={cx('toolbarButton note', {
							toggled: props.tool.type === 'note'
						})}
						title={intl.formatMessage({ id: 'pdfReader.addNote' })}
						onClick={() => handleToolClick('note')}
					>
						<span className="button-background"/>
					</button>
					{props.type === 'pdf' && (
						<button
							tabIndex={-1}
							className={cx('toolbarButton area', { toggled: props.tool.type === 'image' })}
							title={intl.formatMessage({ id: 'pdfReader.selectArea' })}
							onClick={() => handleToolClick('image')}
						>
							<span className="button-background"/>
						</button>
					)}
					{props.type === 'pdf' && (
						<button
							tabIndex={-1}
							className={cx('toolbarButton text', { toggled: props.tool.type === 'text' })}
							title={intl.formatMessage({ id: 'pdfReader.selectArea' })}
							onClick={() => handleToolClick('text')}
						>
							<span className="button-background"/>
						</button>
					)}
					{props.type === 'pdf' && (
						<button
							tabIndex={-1}
							className={cx('toolbarButton ink', { toggled: props.tool.type === 'ink' })}
							title={intl.formatMessage({ id: 'pdfReader.selectArea' })}
							onClick={() => handleToolClick('ink')}
						>
							<span className="button-background"/>
						</button>
					)}
					{props.type === 'pdf' && (
						<button
							tabIndex={-1}
							className={cx('toolbarButton eraser', { toggled: props.tool.type === 'eraser' })}
							title={intl.formatMessage({ id: 'pdfReader.selectArea' })}
							onClick={() => handleToolClick('eraser')}
						>
							<span className="button-background"/>
						</button>
					)}
					<button
						tabIndex={-1}
						className="toolbarButton global-color"
						style={{ color: props.tool.color }}
						title={intl.formatMessage({ id: 'pdfReader.pickColor' })}
						onClick={handleToolColorClick}
					>
						<span className="button-background"/>
						<span className="dropmarker"/>
					</button>
				</div>
			</div>
			<div className="end">
				<button
					id="viewFind"
					className={cx('toolbarButton', { active: props.findPopupOpen })}
					title="Find in Document"
					tabIndex={-1}
					onClick={handleFindClick}
				/>
			</div>
		</div>
	);
}

export default Toolbar;
