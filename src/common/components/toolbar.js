import React, { useEffect, useRef, useContext, Fragment } from 'react';
import { Localized, useLocalization } from "@fluent/react";
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
import IconGoBack from '../../../res/icons/20/go-back.svg';

function Toolbar(props) {
	const pageInputRef = useRef();
	const { platform } = useContext(ReaderContext);

	const { l10n } = useLocalization();

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
					title={l10n.getString('reader-toggle-sidebar')}
					tabIndex={-1}
					onClick={handleSidebarButtonClick}
				><IconSidebar/></button>
				<div className="divider"/>
				<button
					id="zoomOut"
					className="toolbar-button zoomOut"
					title={l10n.getString('reader-zoom-out')}
					tabIndex={-1}
					disabled={!props.enableZoomOut}
					onClick={props.onZoomOut}
				><IconZoomOut/></button>
				<button
					id="zoomIn"
					className="toolbar-button zoomIn"
					title={l10n.getString('reader-zoom-in')}
					tabIndex={-1}
					disabled={!props.enableZoomIn}
					onClick={props.onZoomIn}
				><IconZoomIn/></button>
				<button
					id="zoomAuto"
					className="toolbar-button zoomAuto"
					title={l10n.getString('reader-zoom-reset')}
					tabIndex={-1}
					disabled={!props.enableZoomReset}
					onClick={props.onZoomReset}
				><IconAutoWidth/></button>
				<button
					id="appearance"
					className={cx('toolbar-button', { active: props.appearancePopup })}
					title={l10n.getString('reader-appearance')}
					tabIndex={-1}
					onClick={props.onToggleAppearancePopup}
				><IconFormatText/></button>
				<div className="divider"/>
				<button
					id="navigateBack"
					className="toolbar-button navigateBack"
					title={l10n.getString('general-back')}
					tabIndex={-1}
					disabled={!props.enableNavigateBack}
					onClick={props.onNavigateBack}
				><IconGoBack/></button>
				<div className="divider"/>
				{['pdf', 'epub'].includes(props.type) && (
					<React.Fragment>
						<button
							className="toolbar-button pageUp"
							title={l10n.getString('reader-previous-page')}
							id="previous"
							tabIndex={-1}
							disabled={!props.enableNavigateToPreviousPage}
							onClick={props.onNavigateToPreviousPage}
							aria-describedby="numPages"
						><IconChevronUp/></button>
						<button
							className="toolbar-button pageDown"
							title={l10n.getString('reader-next-page')}
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
						title={l10n.getString(
							(props.type === 'pdf' || props.usePhysicalPageNumbers)
								? 'reader-page'
								: 'reader-location'
						)}
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
				<Localized id="reader-toolbar-highlight" attrs={{ title: true, 'aria-description': true }}>
					<button
						tabIndex={-1}
						className={cx('toolbar-button highlight', { active: props.tool.type === 'highlight' })}
						disabled={props.readOnly}
						onClick={() => handleToolClick('highlight')}
					><IconHighlight/></button>
				</Localized>
				<Localized id="reader-toolbar-underline" attrs={{ title: true, 'aria-description': true }}>
					<button
						tabIndex={-1}
						className={cx('toolbar-button underline', { active: props.tool.type === 'underline' })}
						disabled={props.readOnly}
						onClick={() => handleToolClick('underline')}
					><IconUnderline/></button>
				</Localized>
				<Localized id="reader-toolbar-note" attrs={{ title: true, 'aria-description': true }}>
					<button
						tabIndex={-1}
						className={cx('toolbar-button note', { active: props.tool.type === 'note' })}
						disabled={props.readOnly}
						onClick={() => handleToolClick('note')}
					><IconNote/></button>
				</Localized>
				{props.type === 'pdf' && (
					<Localized id="reader-toolbar-text" attrs={{ title: true, 'aria-description': true }}>
						<button
							tabIndex={-1}
							className={cx('toolbar-button text', { active: props.tool.type === 'text' })}
							disabled={props.readOnly}
							onClick={() => handleToolClick('text')}
						><IconText/></button>
					</Localized>
				)}
				{props.type === 'pdf' && (
					<Localized id="reader-toolbar-area" attrs={{ title: true, 'aria-description': true }}>
						<button
							tabIndex={-1}
							className={cx('toolbar-button area', { active: props.tool.type === 'image' })}
							disabled={props.readOnly}
							onClick={() => handleToolClick('image')}
						><IconImage/></button>
					</Localized>
				)}
				{props.type === 'pdf' && (
					<Localized id="reader-toolbar-draw" attrs={{ title: true, 'aria-description': true }}>
						<button
							tabIndex={-1}
							className={cx('toolbar-button ink', { active: ['ink', 'eraser'].includes(props.tool.type) })}
							disabled={props.readOnly}
							onClick={() => handleToolClick('ink')}
						><IconInk/></button>
					</Localized>
				)}
				<div className="divider"/>
				<button
					tabIndex={-1}
					className="toolbar-button toolbar-dropdown-button"
					disabled={props.readOnly || ['pointer', 'hand'].includes(props.tool.type)}
					title={l10n.getString('reader-pick-color')}
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
					title={l10n.getString('reader-find-in-document')}
					tabIndex={-1}
					onClick={handleFindClick}
				><IconFind/></button>
				{platform === 'zotero' && props.showContextPaneToggle && (
					<Fragment>
						<button
							className="toolbar-button context-pane-toggle"
							title={l10n.getString('reader-toggle-context-pane')}
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
