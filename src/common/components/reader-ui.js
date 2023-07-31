import React, { Fragment, useState, useCallback, useEffect, useRef, useImperativeHandle } from 'react';
import cx from 'classnames';
import Toolbar from './toolbar';
import Sidebar from './sidebar/sidebar';
import SelectionPopup from './view/selection-popup';
import FindPopup from './view/find-popup';
import AnnotationPopup from './view/annotation-popup';
import AnnotationsView from './sidebar/annotations-view';
import SidebarResizer from './sidebar/sidebar-resizer';
import SplitViewResizer from './split-view-resizer';
import ThumbnailsView from './sidebar/thumbnails-view';
import OutlineView from './sidebar/outline-view';
import OverlayPopup from './view/overlay-popup';
import ContextMenu from './context-menu';
import LabelOverlay from './overlay/label-overlay';
import PasswordOverlay from './overlay/password-overlay';
import PrintOverlay from './overlay/print-overlay';


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
				data-tabstop={true}
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
					onSetPortal={props.onSetPortal}
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
		sidebarOpenPageLabelPopup: (id) => annotationsViewRef.current?.openPageLabelPopup(id)
	}));

	let findState = state.primary ? state.primaryViewFindState : state.secondaryViewFindState;
	let viewStats = state.primary ? state.primaryViewStats : state.secondaryViewStats;

	let onChangeAnnotation = useCallback((annotation) => {
		props.onUpdateAnnotations([annotation]);
	}, []);

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
					findPopupOpen={findState.popupOpen}
					tool={state.tool}
					readOnly={state.readOnly}
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
					onToggleFind={props.onToggleFind}
				/>
				<div>
					{state.sidebarOpen === true &&
						<Sidebar
							type={props.type}
							view={state.sidebarView}
							enableOutlineView={!!state.outline.length}
							onChangeView={props.onChangeSidebarView}
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
									onChange={onChangeAnnotation}
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
			{state.labelOverlay && <LabelOverlay params={state.labelOverlay} onUpdateAnnotations={props.onUpdateAnnotations} onClose={props.onCloseLabelOverlay}/>}
			{state.passwordOverlay && <PasswordOverlay params={state.passwordOverlay} onEnterPassword={props.onEnterPassword}/>}
			{state.printOverlay && <PrintOverlay params={state.printOverlay}/>}
			{state.errorMessage && <div className="error-bar" tabIndex={-1}>{state.errorMessage}</div>}
		</Fragment>
	);
});

export default ReaderUI;
