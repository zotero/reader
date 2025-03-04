import React, { useEffect, useRef, useContext, Fragment } from 'react';
import { useIntl } from 'react-intl';
import cx from 'classnames';
import CustomSections from './common/custom-sections';
import { ReaderContext } from '../reader';
import { IconColor20 } from './common/icons';

import IconSidebar from '../../../res/icons/20/sidebar.svg';
import IconSidebarBottom from '../../../res/icons/20/sidebar-bottom.svg';
import IconZoomIn from '../../../res/icons/20/zoom-in.svg';
import IconZoomOut from '../../../res/icons/20/zoom-out.svg';
import IconAutoWidth from '../../../res/icons/20/auto-width.svg';
import IconChevronLeft from '../../../res/icons/20/chevron-left.svg';
import IconChevronUp from '../../../res/icons/20/chevron-up.svg';
import IconChevronDown from '../../../res/icons/20/chevron-down.svg';
import IconFormatText from '../../../res/icons/20/format-text.svg';
import IconHighlight from '../../../res/icons/20/annotate-highlight.svg';
import IconUnderline from '../../../res/icons/20/annotate-underline.svg';
import IconNote from '../../../res/icons/20/annotate-note.svg';
import IconText from '../../../res/icons/20/annotate-text.svg';
import IconImage from '../../../res/icons/20/annotate-area.svg';
import IconInk from '../../../res/icons/20/annotate-ink.svg';
import IconEraser from '../../../res/icons/20/annotate-eraser.svg';
import IconFind from '../../../res/icons/20/magnifier.svg';
import IconChevronDown8 from '../../../res/icons/8/chevron-8.svg';

function Toolbar(props) {
	const intl = useIntl();
	const pageInputRef = useRef();
	const { platform } = useContext(ReaderContext);

	useEffect(() => {
		if (['pdf', 'epub'].includes(props.type)) {
			pageInputRef.current.value = props.pageLabel ?? (props.pageIndex + 1);
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
		if (type === 'ink' && ['ink', 'eraser'].includes(props.tool.type)) {
			type = 'pointer';
		}
		props.onChangeTool({ type });
	}

	function handlePageNumberKeydown(event) {
		if (event.key === 'Enter') {
			props.onChangePageNumber(event.target.value);
		}
	}

	function handlePageNumberBlur(event) {
		if (event.target.value != (props.pageLabel ?? (props.pageIndex + 1))) {
			props.onChangePageNumber(event.target.value);
		}
	}

	return (
		<div className="toolbar" data-tabstop={1} role="application">
			<div className="start">
				<button
					id="sidebarToggle"
					className="toolbar-button sidebar-toggle"
					title={intl.formatMessage({ id: 'pdfReader.toggleSidebar' })}
					tabIndex={-1}
					onClick={handleSidebarButtonClick}
				><IconSidebar/></button>
				<div className="divider"/>
				<button
					id="zoomOut"
					className="toolbar-button zoomOut"
					title={intl.formatMessage({ id: 'pdfReader.zoomOut' })}
					tabIndex={-1}
					disabled={!props.enableZoomOut}
					onClick={props.onZoomOut}
				><IconZoomOut/></button>
				<button
					id="zoomIn"
					className="toolbar-button zoomIn"
					title={intl.formatMessage({ id: 'pdfReader.zoomIn' })}
					tabIndex={-1}
					disabled={!props.enableZoomIn}
					onClick={props.onZoomIn}
				><IconZoomIn/></button>
				<button
					id="zoomAuto"
					className="toolbar-button zoomAuto"
					title={intl.formatMessage({ id: 'pdfReader.zoomReset' })}
					tabIndex={-1}
					disabled={!props.enableZoomReset}
					onClick={props.onZoomReset}
				><IconAutoWidth/></button>
				<button
					id="appearance"
					className={cx('toolbar-button', { active: props.appearancePopup })}
					title={intl.formatMessage({ id: 'pdfReader.appearance' })}
					tabIndex={-1}
					onClick={props.onToggleAppearancePopup}
				><IconFormatText/></button>
				<div className="divider"/>
				<button
					id="navigateBack"
					className="toolbar-button navigateBack"
					title={intl.formatMessage({ id: 'general.back' })}
					tabIndex={-1}
					disabled={!props.enableNavigateBack}
					onClick={props.onNavigateBack}
				><IconChevronLeft/></button>
				<div className="divider"/>
				{['pdf', 'epub'].includes(props.type) && (
					<React.Fragment>
						<button
							className="toolbar-button pageUp"
							title={intl.formatMessage({ id: 'pdfReader.previousPage' })}
							id="previous"
							tabIndex={-1}
							disabled={!props.enableNavigateToPreviousPage}
							onClick={props.onNavigateToPreviousPage}
							aria-describedby="numPages"
						><IconChevronUp/></button>
						<button
							className="toolbar-button pageDown"
							title={intl.formatMessage({ id: 'pdfReader.nextPage' })}
							id="next"
							tabIndex={-1}
							disabled={!props.enableNavigateToNextPage}
							onClick={props.onNavigateToNextPage}
							aria-describedby="numPages"
						><IconChevronDown/></button>
					</React.Fragment>
				)}
				{['pdf', 'epub'].includes(props.type) && (
					<input
						ref={pageInputRef}
						type="input"
						id="pageNumber"
						className="toolbar-text-input"
						title={intl.formatMessage({
							id: props.type === 'pdf' || props.usePhysicalPageNumbers
								? 'pdfReader.page'
								: 'pdfReader.location'
						})}
						defaultValue=""
						size="4"
						min="1"
						tabIndex={-1}
						autoComplete="off"
						onKeyDown={handlePageNumberKeydown}
						onBlur={handlePageNumberBlur}
					/>)}
				{props.pageLabel && (
					<span id="numPages">&nbsp;<div>{!(props.type === 'pdf' && props.pageIndex + 1 == props.pageLabel)
						&& (props.pageIndex + 1)} / {props.pagesCount}</div></span>
				)}
			</div>
			<div className="center tools">
				<button
					tabIndex={-1}
					className={cx('toolbar-button highlight', { active: props.tool.type === 'highlight' })}
					title={intl.formatMessage({ id: 'pdfReader.highlightText' })}
					disabled={props.readOnly}
					onClick={() => handleToolClick('highlight')}
					data-l10n-id="pdfReader-toolbar-highlight"
				><IconHighlight/></button>
				<button
					tabIndex={-1}
					className={cx('toolbar-button underline', { active: props.tool.type === 'underline' })}
					title={intl.formatMessage({ id: 'pdfReader.underlineText' })}
					disabled={props.readOnly}
					onClick={() => handleToolClick('underline')}
					data-l10n-id="pdfReader-toolbar-underline"
				><IconUnderline/></button>
				<button
					tabIndex={-1}
					className={cx('toolbar-button note', {
						active: props.tool.type === 'note'
					})}
					title={intl.formatMessage({ id: 'pdfReader.addNote' })}
					disabled={props.readOnly}
					onClick={() => handleToolClick('note')}
					data-l10n-id="pdfReader-toolbar-note"
				><IconNote/></button>
				{props.type === 'pdf' && (
					<button
						tabIndex={-1}
						className={cx('toolbar-button text', { active: props.tool.type === 'text' })}
						title={intl.formatMessage({ id: 'pdfReader.addText' })}
						disabled={props.readOnly}
						onClick={() => handleToolClick('text')}
						data-l10n-id="pdfReader-toolbar-text"
					><IconText/></button>
				)}
				{props.type === 'pdf' && (
					<button
						tabIndex={-1}
						className={cx('toolbar-button area', { active: props.tool.type === 'image' })}
						title={intl.formatMessage({ id: 'pdfReader.selectArea' })}
						disabled={props.readOnly}
						onClick={() => handleToolClick('image')}
						data-l10n-id="pdfReader-toolbar-area"
					><IconImage/></button>
				)}
				{props.type === 'pdf' && (
					<button
						tabIndex={-1}
						className={cx('toolbar-button ink', { active: ['ink', 'eraser'].includes(props.tool.type) })}
						title={intl.formatMessage({ id: 'pdfReader.draw' })}
						disabled={props.readOnly}
						onClick={() => handleToolClick('ink')}
						data-l10n-id="pdfReader-toolbar-draw"
					><IconInk/></button>
				)}
				<div className="divider"/>
				<button
					tabIndex={-1}
					className="toolbar-button toolbar-dropdown-button"
					disabled={props.readOnly || ['pointer', 'hand'].includes(props.tool.type)}
					title={intl.formatMessage({ id: 'pdfReader.pickColor' })}
					onClick={handleToolColorClick}
				>
					{
						props.tool.type === 'eraser'
						? <IconEraser/>
						: <IconColor20 color={props.tool.color || ['pointer', 'hand'].includes(props.tool.type) && 'transparent'}/>
					}
					<IconChevronDown8/>
				</button>
			</div>
			<div className="end">
				<CustomSections type="Toolbar"/>
				<button
					className={cx('toolbar-button find', { active: props.findPopupOpen })}
					title={intl.formatMessage({ id: 'pdfReader.findInDocument' })}
					tabIndex={-1}
					onClick={handleFindClick}
				><IconFind/></button>
				{platform === 'zotero' && props.showContextPaneToggle && (
					<Fragment>
						<div className="divider"/>
						<button
							className="toolbar-button context-pane-toggle"
							title={intl.formatMessage({ id: 'pdfReader.toggleContextPane' })}
							tabIndex={-1}
							onClick={props.onToggleContextPane}
						>{props.stackedView ? <IconSidebarBottom/> : <IconSidebar className="standard-view"/>}</button>
					</Fragment>
				)}
			</div>
		</div>
	);
}

export default Toolbar;
