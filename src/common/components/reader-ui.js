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
import AppearancePopup from "./modal-popup/appearance-popup";
import ThemePopup from './modal-popup/theme-popup';


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

	function handleOverlayPopupClose() {
		props.onCloseOverlayPopup(primary);
	}

	return (
		<div className={name + '-view'}>
			<div
				data-tabstop={1}
				tabIndex={-1}
				data-proxy={`#${name}-view > iframe`}
				style={{ position: 'absolute' }}
			/>
			{state[name + 'ViewSelectionPopup'] && !state.readOnly &&
				<SelectionPopup
					params={state[name + 'ViewSelectionPopup']}
					textSelectionAnnotationMode={state.textSelectionAnnotationMode}
					enableAddToNote={state.enableAddToNote}
					onAddToNote={props.onAddToNote}
					onAddAnnotation={props.onAddAnnotation}
					onChangeTextSelectionAnnotationMode={props.onChangeTextSelectionAnnotationMode}
				/>
			}
			{state[name + 'ViewAnnotationPopup']
				&& (
					(!state.sidebarOpen || state.sidebarView !== 'annotations')
					&& state.annotations.find(x => x.id === state[name + 'ViewAnnotationPopup'].annotation.id)
				)
				&& <AnnotationPopup
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
					previewedReferences={state.previewedReferences}
					onPreviewReference={props.onPreviewReference}
					onOpenLink={props.onOpenLink}
					onNavigate={props.onNavigate}
					onRecognizeReference={props.onRecognizeReference}
					onAddToLibrary={props.onAddToLibrary}
					onShowInLibrary={props.onShowInLibrary}
					onOpenInReader={props.onOpenInReader}
					onClose={handleOverlayPopupClose}
				/>
			}
			{state[name + 'ViewFindState'].popupOpen &&
				<FindPopup
					params={state[name + 'ViewFindState']}
					onChange={handleFindStateChange}
					onFindNext={handleFindNext}
					onFindPrevious={handleFindPrevious}
					onAddAnnotation={props.onAddAnnotation}
					tools={props.tools}
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

	let stackedView = state.bottomPlaceholderHeight !== null;
	let showContextPaneToggle = state.showContextPaneToggle && (stackedView || !state.contextPaneOpen);

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
					appearancePopup={state.appearancePopup}
					findPopupOpen={findState.popupOpen}
					themes={state.themes}
					onChangeTheme={props.onChangeTheme}
					tool={state.tool}
					readOnly={state.readOnly}
					stackedView={stackedView}
					showContextPaneToggle={showContextPaneToggle}
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
					onToggleAppearancePopup={props.onToggleAppearancePopup}
					onToggleFind={props.onToggleFind}
					onToggleContextPane={props.onToggleContextPane}
				/>
				<div>
					{state.sidebarOpen === true &&
						<Sidebar
							type={props.type}
							view={state.sidebarView}
							filter={state.filter}
							outline={state.outline}
							outlineQuery={state.outlineQuery}
							onUpdateOutline={props.onUpdateOutline}
							onUpdateOutlineQuery={props.onUpdateOutlineQuery}
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
									currentOutlinePath={viewStats.outlinePath}
									onNavigate={props.onNavigate}
									onOpenLink={props.onOpenLink}
									onUpdate={props.onUpdateOutline}
								/>
							}
						/>
					}

				</div>
				{state.sidebarOpen === true && <SidebarResizer onResize={props.onResizeSidebar}/>}
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
			{state.appearancePopup && (
				// We always read the primaryViewState, but we write both view states
				<AppearancePopup
					customThemes={state.customThemes}
					colorScheme={state.colorScheme}
					lightTheme={state.lightTheme}
					darkTheme={state.darkTheme}
					splitType={state.splitType}
					viewStats={viewStats}
					onChangeSplitType={props.onChangeSplitType}
					onChangeScrollMode={props.onChangeScrollMode}
					onChangeSpreadMode={props.onChangeSpreadMode}
					onChangeFlowMode={props.onChangeFlowMode}
					onChangeAppearance={props.onChangeAppearance}
					onAddTheme={props.onAddTheme}
					onChangeTheme={props.onChangeTheme}
					onOpenThemeContextMenu={props.onOpenThemeContextMenu}
					onClose={() => props.onToggleAppearancePopup(false)}
				/>
			)}
			{state.themePopup && (
				<ThemePopup
					params={state.themePopup}
					customThemes={state.customThemes}
					colorScheme={state.colorScheme}
					lightTheme={state.lightTheme}
					darkTheme={state.darkTheme}
					onSaveCustomThemes={props.onSaveCustomThemes}
					onClose={props.onCloseThemePopup}
				/>
			)}
			<div id="a11yAnnouncement" aria-live="polite"></div>
		</Fragment>
	);
});

export default ReaderUI;
