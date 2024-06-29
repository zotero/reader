import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import cx from 'classnames';
import Toolbar from './toolbar';
import Sidebar from './sidebar/sidebar';
import SelectionPopup from './view-popup/selection-popup';
import FindPopup from './view-popup/find-popup';
import AnnotationPopup from './view-popup/annotation-popup';
import AnnotationsView from './sidebar/annotations-view';
import SidebarResizer from './sidebar/sidebar-resizer';
import SplitViewResizer from './split-view-resizer';
import ThumbnailsView from './sidebar/thumbnails-view';
import OutlineView from './sidebar/outline-view';
import OverlayPopup from './view-popup/overlay-popup';
import ContextMenu from './context-menu';
import LabelPopup from './modal-popup/label-popup';
import PasswordPopup from './modal-popup/password-popup';
import PrintPopup from './modal-popup/print-popup';
import EPUBAppearancePopup from "./view-popup/epub-appearance-popup";


function View(props) {
	let { primary, state } = props;

	let name = primary ? 'primary' : 'secondary';

	function handleFindStateChange(params) {
		props.onChangeFindState(primary, params);
	}

	function handleFindNext() {
		props.onFindNext(primary);
	}

	function handleFindPrevious() {
		props.onFindPrevious(primary);
	}

	return (
		<div className={name}>
			<div
				data-tabstop={1}
				tabIndex={-1}
				data-proxy={`#${name}-view > iframe`}
				style={{ position: 'absolute' }}
			/>
			{state[name + 'ViewFindState'].popupOpen &&
				<FindPopup
					params={state[name + 'ViewFindState']}
					onChange={handleFindStateChange}
					onFindNext={handleFindNext}
					onFindPrevious={handleFindPrevious}
				/>
			}
			{state[name + 'ViewSelectionPopup'] && !state.readOnly &&
				<SelectionPopup
					params={state[name + 'ViewSelectionPopup']}
					enableAddToNote={state.enableAddToNote}
					onAddToNote={props.onAddToNote}
					onAddAnnotation={props.onAddAnnotation}
				/>
			}
			{state[name + 'ViewAnnotationPopup'] && !state.sidebarOpen &&
				<AnnotationPopup
					type={props.type}
					readOnly={state.readOnly}
					params={state[name + 'ViewAnnotationPopup']}
					annotation={state.annotations.find(x => x.id === state[name + 'ViewAnnotationPopup'].annotation.id)}
					onChange={(annotation) => props.onUpdateAnnotations([annotation])}
					onDragStart={() => {}}
					onOpenTagsPopup={props.onOpenTagsPopup}
					onOpenPageLabelPopup={props.onOpenPageLabelPopup}
					onOpenAnnotationContextMenu={props.onOpenAnnotationContextMenu}
					onSetDataTransferAnnotations={props.onSetDataTransferAnnotations}
				/>}
			{state[name + 'ViewOverlayPopup'] &&
				<OverlayPopup
					params={state[name + 'ViewOverlayPopup']}
					onOpenLink={props.onOpenLink}
					onNavigate={props.onNavigate}
				/>
			}
		</div>
	);
}

const ReaderUI = React.forwardRef((props, ref) => {
	let [state, setState] = useState(props.state);
	let sidebarRef = useRef();
	let annotationsViewRef = useRef();

	useImperativeHandle(ref, () => ({
		setState,
		sidebarScrollAnnotationIntoView: (id) => annotationsViewRef.current?.scrollAnnotationIntoView(id),
		sidebarEditAnnotationText: (id) => annotationsViewRef.current?.editAnnotationText(id),
	}));

	let findState = state.primary ? state.primaryViewFindState : state.secondaryViewFindState;
	let viewStats = state.primary ? state.primaryViewStats : state.secondaryViewStats;

	return (
		<Fragment>
			<div>
				<Toolbar
					type={props.type}
					pageIndex={viewStats.pageIndex || 0}
					pageLabel={viewStats.pageLabel || ''}
					pagesCount={viewStats.pagesCount || 0}
					usePhysicalPageNumbers={viewStats.usePhysicalPageNumbers}
					percentage={viewStats.percentage || ''}
					sidebarOpen={state.sidebarOpen}
					enableZoomOut={viewStats.canZoomOut}
					enableZoomIn={viewStats.canZoomIn}
					enableZoomReset={viewStats.canZoomReset}
					enableNavigateBack={viewStats.canNavigateBack}
					enableNavigateToPreviousPage={viewStats.canNavigateToPreviousPage}
					enableNavigateToNextPage={viewStats.canNavigateToNextPage}
					epubAppearancePopup={state.epubAppearancePopup}
					findPopupOpen={findState.popupOpen}
					tool={state.tool}
					readOnly={state.readOnly}
					stackedView={state.bottomPlaceholderHeight !== null}
					showContextPaneToggle={state.showContextPaneToggle}
					onToggleSidebar={props.onToggleSidebar}
					onZoomIn={props.onZoomIn}
					onZoomOut={props.onZoomOut}
					onZoomReset={props.onZoomReset}
					onNavigateBack={props.onNavigateBack}
					onNavigateToPreviousPage={props.onNavigateToPreviousPage}
					onNavigateToNextPage={props.onNavigateToNextPage}
					onChangePageNumber={props.onChangePageNumber}
					onChangeTool={props.onChangeTool}
					onOpenColorContextMenu={props.onOpenColorContextMenu}
					onToggleEPUBAppearance={props.onToggleEPUBAppearance}
					onToggleFind={props.onToggleFind}
					onToggleContextPane={props.onToggleContextPane}
				/>
				<div>
					{state.sidebarOpen === true &&
						<Sidebar
							type={props.type}
							view={state.sidebarView}
							filter={state.filter}
							onChangeView={props.onChangeSidebarView}
							onChangeFilter={props.onChangeFilter}
							thumbnailsView={
								<ThumbnailsView
									pageLabels={state.pageLabels}
									thumbnails={state.thumbnails}
									currentPageIndex={viewStats.pageIndex || 0}
									onOpenThumbnailContextMenu={props.onOpenThumbnailContextMenu}
									onRenderThumbnails={props.onRenderThumbnails}
									onNavigate={props.onNavigate}
								/>
							}
							annotationsView={
								<AnnotationsView
									ref={annotationsViewRef}
									type={props.type}
									readOnly={state.readOnly}
									filter={state.filter}
									annotations={state.annotations}
									selectedIDs={state.selectedAnnotationIDs}
									authorName="test"
									onSelectAnnotations={props.onSelectAnnotations}
									onUpdateAnnotations={props.onUpdateAnnotations}
									onSetDataTransferAnnotations={props.onSetDataTransferAnnotations}
									onOpenTagsPopup={props.onOpenTagsPopup}
									onOpenPageLabelPopup={props.onOpenPageLabelPopup}
									onOpenAnnotationContextMenu={props.onOpenAnnotationContextMenu}
									onOpenSelectorContextMenu={props.onOpenSelectorContextMenu}
									onChangeFilter={props.onChangeFilter}
								/>
							}
							outlineView={
								<OutlineView
									outline={state.outline}
									onNavigate={props.onNavigate}
									onOpenLink={props.onOpenLink}
									onUpdate={props.onUpdateOutline}
								/>
							}
						/>
					}

				</div>
				<SidebarResizer onResize={props.onResizeSidebar}/>
			</div>
			<div className="split-view">
				<View {...props} primary={true} state={state}/>
				<SplitViewResizer onResize={props.onResizeSplitView}/>
				{state.splitType && <View {...props} primary={false} state={state} />}
			</div>
			{state.contextMenu && <ContextMenu params={state.contextMenu} onClose={props.onCloseContextMenu}/>}
			{state.labelPopup && <LabelPopup params={state.labelPopup} onUpdateAnnotations={props.onUpdateAnnotations} onClose={props.onCloseLabelPopup}/>}
			{state.passwordPopup && <PasswordPopup params={state.passwordPopup} onEnterPassword={props.onEnterPassword}/>}
			{state.printPopup && <PrintPopup params={state.printPopup}/>}
			{state.errorMessage && <div className="error-bar" tabIndex={-1}>{state.errorMessage}</div>}
			{props.type === 'epub' && state.epubAppearancePopup && (
				// We always read the primaryViewState, but we write both view states
				<EPUBAppearancePopup
					params={state.primaryViewState.appearance}
					onChange={props.onChangeEPUBAppearance}
					onClose={() => props.onToggleEPUBAppearance({ open: false })}
				/>
			)}
			<div id="a11yAnnouncement" aria-live="polite"></div>
		</Fragment>
	);
});

export default ReaderUI;
