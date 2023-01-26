import { isMac } from '../common/lib/utilities';
import PopupDelayer from '../common/lib/popup-delayer';

// - All views use iframe to render and isolate the view from the parent window
// - If need to add additional build steps, a submodule or additional files see pdfjs/
//   directory in the project root and "scripts" part in packages.json
// - If view needs styling, it should provide and load its own CSS file like pdfjs/viewer.css,
//   because SCSS in src/common/stylesheets is only for the main window
// - Update demo data in demo/epub and demo/snapshot directories:
//   - Add a real EPUB file demo.epub instead of demo.epub.html
//   - Add demo annotations

class EPUBView {
	constructor(options) {
		this._container = options.container;

		// The variables below are from reader._state and are constantly updated
		// using setTool, setAnnotation, etc.

		// Tool type can be 'highlight', 'note' or 'pointer' (no tool at all), also 'underline' in future
		this._tool = options.tool;
		this._selectedAnnotationIDs = options.selectedAnnotationIDs;
		this._annotations = options.annotations;
		// Don't show annotations if this is false
		this._showAnnotations = options.showAnnotations;
		this._annotationPopup = options.annotationPopup;
		this._selectionPopup = options.selectionPopup;
		this._overlayPopup = options.overlayPopup;
		this._findPopup = options.findPopup;

		// Events
		// Provides outline that is visible in the sidebar
		this._onSetOutline = options.onSetOutline;
		// Update view state that will be used to re-create the view
		this._onChangeViewState = options.onChangeViewState;
		// Update view stats that are used to render information in the UI, i.e. page label
		this._onChangeViewStats = options.onChangeViewStats;
		// Set text/plain, text/html and zotero/annotation data when copying/dragging annotation(s),
		// for the provided data transfer object
		this._onSetDataTransferAnnotations = options.onSetDataTransferAnnotations;
		// Create annotation
		this._onAddAnnotation = options.onAddAnnotation;
		// Update annotations. PDF view updates annotations when updating highlight range,
		// or saving rendered image. Unclear if this is needed for other views
		this._onUpdateAnnotations = options.onUpdateAnnotations;
		// Open external link
		this._onOpenLink = options.onOpenLink;
		// Select/deselect annotations
		this._onSelectAnnotations = options.onSelectAnnotations;
		this._onSetSelectionPopup = options.onSetSelectionPopup;
		this._onSetAnnotationPopup = options.onSetAnnotationPopup;
		this._onSetOverlayPopup = options.onSetOverlayPopup;
		this._onSetFindPopup = options.onSetFindPopup;
		this._onOpenViewContextMenu = options.onOpenViewContextMenu;
		// Inform main window that the view was focused
		this._onFocus = options.onFocus;
		// Calling this focuses the next focusable element in the main window
		this._onTabOut = options.onTabOut;
		// Pass keydown event to the main window to handle common keyboard shortcuts
		this._onKeyDown = options.onKeyDown;

		this._overlayPopupDelayer = new PopupDelayer({ open: !!this._overlayPopup });
		this._iframe = document.createElement('iframe');
		// sandbox="allow-same-origin" prevents executing JS inside iframe, but still allows parent
		// window to bind events inside iframe sandbox
		// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sect5
		// Although this doesn't work on Safari, which would be a problem on web-library
		// https://stackoverflow.com/questions/28414580/binding-javascript-events-inside-iframe-sandbox-in-chrome
		// https://caniuse.com/mdn-html_elements_iframe_sandbox-allow-same-origin (see notes)
		this._iframe.sandbox = "allow-same-origin";
		if (window.dev) {
			// This is just for the demo that uses HTML file instead of EPUB.
			let html = (new TextDecoder("utf-8")).decode(options.buf);
			this._iframe.srcdoc = html;
		}
		else {
			this._iframe.srcdoc = 'EPUB content will be here.';
		}

		this._iframe.addEventListener('load', () => {
			this._iframeWindow = this._iframe.contentWindow;
			this._setInitialViewState(options.viewState);
			this._init();
		});

		this._container.append(this._iframe);
	}

	_init() {
		// Long-term goal is to make this reader touch friendly, which probably means using
		// not mouse* but pointer* or touch* events
		this._iframeWindow.addEventListener('contextmenu', this._handleContextMenu.bind(this));
		this._iframeWindow.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		this._iframeWindow.addEventListener('click', this._handleClick.bind(this));
		this._iframeWindow.addEventListener('mouseover', this._handleMouseEnter.bind(this));
		this._iframeWindow.addEventListener('mousedown', this._handlePointerDown.bind(this), true);
		this._iframeWindow.addEventListener('mouseup', this._handlePointerUp.bind(this));
		this._iframeWindow.addEventListener('dragstart', this._handleDragStart.bind(this), { capture: true });
		this._iframeWindow.addEventListener('copy', this._handleCopy.bind(this));
		this._iframeWindow.addEventListener('resize', this._handleResize.bind(this));
		this._iframeWindow.addEventListener('focus', this._handleFocus.bind(this));
		this._iframeWindow.document.addEventListener('scroll', this._handleScroll.bind(this));
		this._iframeWindow.document.addEventListener('selectionchange', this._handleSelectionChange.bind(this));

		this._updateViewStats();
		this._initOutline();
	}

	_initOutline() {
		let items = [{
			title: 'Some title',
			// The whole location will be passed to navigate() once user clicks the item
			location: {
				// position
			},
			items: [
				{
					title: 'Section 1',
					location: {},
					expanded: false,
					items: [
						{
							title: 'Section 1.1'
						}
					]
				},
				{
					title: 'Section 2',
					location: {}
				}
			],
			expanded: true
		}];

		this._onSetOutline(items);
	}

	_setInitialViewState(viewState) {
		// Validate viewState and its properties
		// Also make sure this doesn't trigger _updateViewState
		if (viewState) {
			this._iframeWindow.document.body.style.fontSize = viewState.scale + 'em';
			// this._iframeWindow._epub.setPageIndex(viewState.pageIndex);
		}
	}

	// View state is used to recreate the view.
	// For PDF file it's saved in .zotero-pdf-state inside PDF file directory and restored
	// when opening the PDF file. Additionally, pageIndex is stored as
	// attachmentItem.attachmentLastPageIndex and synced.
	// Do we really want to store EPUB view state on file?
	// Can we sync the last reading position (i.e. page index or text offset) between devices?
	_updateViewState() {
		let viewState = {
			// What else should be here?
			pageIndex: 0,
			scale: parseFloat(this._iframeWindow.document.body.style.fontSize || '1')
		};
		this._onChangeViewState(viewState);
	}

	// View stats provide information about the view
	_updateViewStats() {
		let viewStats = {
			pageIndex: 0,
			pageLabel: '1',
			pagesCount: 10,
			canCopy: !!this._selectedAnnotationIDs.length || !!this._iframeWindow.getSelection().toString().trim(),
			canZoomIn: true,
			canZoomOut: true,
			canZoomReset: parseFloat(this._iframeWindow.document.body.style.fontSize || '1') !== 1,
			canNavigateBack: false,
			canNavigateForward: false,
			canNavigateToFirstPage: false,
			canNavigateToLastPage: false,
			canNavigateToPreviousPage: false,
			canNavigateToNextPage: false
		};
		this._onChangeViewStats(viewStats);
	}

	// Currently type is only 'highlight' but later there will also be 'underline'
	_getAnnotationFromTextSelection(type, color) {
		let selection = this._iframeWindow.getSelection();
		let text = selection.toString();
		if (!text) {
			return null;
		}
		return {
			type,
			color,
			// In PDF view, sort index is "page index|text offset|top offset(for non-OCRed PDFs)".
			// It's used to sort annotations in the sidebar.
			// TODO: Figure out how to integrate sortIndex for EPUB and snapshot annotations
			sortIndex: '00000|000000|00000',
			pageLabel: '1',
			position: { /* Figure out how to encode highlight position */ },
			text
		};
	}

	// Popups:
	// - For each popup (except find popup) 'rect' bounding box has to be provided.
	// 	 The popup is then automatically positioned around this rect.
	// - If popup needs to be updated (i.e. its position), just reopen it.
	// - Popup has to be updated (reopened) each time when the view is scrolled or resized.
	// - annotation, selection and overlay popups are closed by calling this._onSetSomePopup()
	//   with no arguments

	_openAnnotationPopup(annotation) {
		// Note: Popup won't be visible if sidebar is opened
		let annotationNode = this._iframeWindow.document.querySelector(`[data-annotation-id="${annotation.id}"]`);
		if (annotationNode) {
			let annotationID = annotationNode.getAttribute('data-annotation-id');
			let rect = annotationNode.getBoundingClientRect();
			rect = [rect.left, rect.top, rect.right, rect.bottom];
			this._onSelectAnnotations([annotationID]);
			this._onSetAnnotationPopup({ rect, annotation });
		}
	}

	_openSelectionPopup() {
		let selection = this._iframeWindow.getSelection();
		let getRange = selection.getRangeAt(0);
		let rect = getRange.getBoundingClientRect();
		rect = [rect.left, rect.top, rect.right, rect.bottom];
		let annotation = this._getAnnotationFromTextSelection('highlight');
		this._onSetSelectionPopup({ rect, annotation });
	}

	_openExternalLinkOverlayPopup(linkNode) {
		let rect = linkNode.getBoundingClientRect();
		rect = [rect.left, rect.top, rect.right, rect.bottom];
		let overlayPopup = {
			type: 'external-link',
			url: linkNode.href,
			rect,
			ref: linkNode
		};
		this._onSetOverlayPopup(overlayPopup);
	}

	_getSelectedAnnotations() {
		return this._annotations.filter(x => this._selectedAnnotationIDs.includes(x.id));
	}

	// Called on scroll, resize, etc.
	_handleViewUpdate() {
		this._updateViewState();
		this._updateViewStats();
		// Update annotation popup position
		if (this._annotationPopup) {
			let { annotation } = this._annotationPopup;
			// Note: There is currently a bug in React components part therefore the popup doesn't
			// properly update its position when window is resized
			this._openAnnotationPopup(annotation);
		}
		// Update selection popup position
		if (this._selectionPopup) {
			this._openSelectionPopup();
		}
		// Close overlay popup
		this._onSetOverlayPopup();
	}

	// ***
	// Event handlers
	// ***

	_handleSelectionChange(event) {
		this._updateViewStats();
		// Open text selection popup if current tool is pointer
		if (this._tool.type === 'pointer') {
			let selection = this._iframeWindow.getSelection();
			let text = selection.toString();
			if (text.length) {
				this._openSelectionPopup();
				return;
			}
		}
		this._onSetSelectionPopup(null);
	}

	_handleClick(event) {
		// TODO: Still allow internal navigation using URI fragment
		let link = event.target.closest('a');
		if (link) {
			event.preventDefault();
			this._onOpenLink(link.href);
		}
	}

	_handleMouseEnter(event) {
		let link = event.target.closest('a');
		if (link) {
			this._overlayPopupDelayer.open(link, () => {
				this._openExternalLinkOverlayPopup(link);
			});
		}
		else {
			this._overlayPopupDelayer.close(() => {
				this._onSetOverlayPopup();
			});
		}
	}

	_handleContextMenu(event) {
		// Prevent native context menu
		event.preventDefault();
		let br = this._iframe.getBoundingClientRect();
		this._onOpenViewContextMenu({ x: br.x + event.clientX, y: br.y + event.clientY });
	}

	_handlePointerDown(event) {
		this._onSetOverlayPopup();

		if (event.button === 2) {
			return;
		}

		let annotationNode = event.target.closest('[data-annotation-id]');
		if (annotationNode) {
			let annotationID = annotationNode.getAttribute('data-annotation-id');
			let annotation = this._annotations.find(x => x.id === annotationID);
			this._onSelectAnnotations([annotationID]);
			this._openAnnotationPopup(annotation);
		}
		// Deselect annotations if clicked not on an annotation
		else if (this._selectedAnnotationIDs.length) {
			this._onSelectAnnotations([]);
		}

		// Create note annotation on pointer down event, if note tool is active.
		// The note tool will be automatically deactivated in reader.js,
		// because this is what we do in PDF reader
		if (this._tool.type === 'note') {
			this._onAddAnnotation({
				type: 'note',
				color: this._tool.color,
				sortIndex: '00000|000000|00000',
				pageLabel: '1',
				position: { /* Figure out how to encode note position */ },
			}, true);
		}
	}

	_handlePointerUp(event) {
		if (this._tool.type === 'highlight') {
			let annotation = this._getAnnotationFromTextSelection('highlight', this._tool.color);
			if (annotation) {
				this._onAddAnnotation(annotation);
			}
			this._iframeWindow.getSelection().removeAllRanges();
		}
	}

	_handleKeyDown(event) {
		let { key } = event;
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		let mod = ctrl || cmd;
		let alt = event.altKey;
		let shift = event.shiftKey;

		// Focusable elements in PDF view are annotations and overlays (links, citations, figures).
		// Once TAB is pressed, arrows can be used to navigate between them
		let focusableElements = Array.from(this._iframeWindow.document.querySelectorAll('[tabindex="-1"]'));
		let focusedElementIndex = focusableElements.findIndex(x => this._iframeWindow.document.activeElement === x);
		let focusedElement = focusableElements[focusedElementIndex];

		if (key === 'Escape') {
			if (this._selectedAnnotationIDs.length) {
				this._onSelectAnnotations([]);
			}
			else if (focusedElement) {
				this._iframeWindow.document.activeElement.blur();
			}
			// The keyboard shortcut was handled here, therefore no need to
			// pass it to this._onKeyDown(event) below
			return;
		}
		else if (shift && key === 'Tab') {
			if (focusedElement) {
				focusedElement.blur();
			}
			else {
				this._onTabOut(true);
			}
			event.preventDefault();
			return;
		}
		else if (key === 'Tab') {
			if (!focusedElement) {
				// In PDF view the first visible object (annotation, overlay) is focused
				if (focusableElements.length) {
					focusableElements[0].focus();
				}
				else {
					this._onTabOut();
				}
			}
			else {
				this._onTabOut();
			}
			event.preventDefault();
			return;
		}

		if (focusedElement) {
			if (!window.rtl && key === 'ArrowRight' || window.rtl && key === 'ArrowLeft' || key === 'ArrowDown') {
				focusableElements[focusedElementIndex + 1]?.focus();
				event.preventDefault();
				return;
			}
			else if (!window.rtl && key === 'ArrowLeft' || window.rtl && key === 'ArrowRight' || key === 'ArrowUp') {
				focusableElements[focusedElementIndex - 1]?.focus();
				event.preventDefault();
				return;
			}
			else if (['Enter', 'Space'].includes(key)) {
				if (focusedElement.classList.contains('highlight')) {
					let annotationID = focusedElement.getAttribute('data-annotation-id');
					let annotation = this._annotations.find(x => x.id === annotationID);
					this._onSelectAnnotations([annotationID]);
					this._openAnnotationPopup(annotation);
					return;
				}
			}
		}
		// Pass keydown even to the main window where common keyboard
		// shortcuts are handled i.e. Delete, Cmd-Minus, Cmd-f, etc.
		this._onKeyDown(event);
	}

	_handleDragStart(event) {
		if (event.target.nodeName === 'SPAN' && event.target.classList.contains('highlight')) {
			let annotationID = event.target.getAttribute('data-annotation-id');
			let annotation = this._annotations.find(x => x.id === annotationID);
			console.log('Dragging annotation', annotation);
			this._onSetDataTransferAnnotations(event.dataTransfer, annotation);
		}
		else {
			let annotation = this._getAnnotationFromTextSelection('highlight');
			console.log('Dragging text', annotation);
			this._onSetDataTransferAnnotations(event.dataTransfer, annotation, true);
		}
	}

	_handleCopy(event) {
		if (this._selectedAnnotationIDs.length) {
			// It's enough to provide only one of selected annotations,
			// others will be included automatically by _onSetDataTransferAnnotations
			let annotation = this._annotations.find(x => x.id === this._selectedAnnotationIDs[0]);
			console.log('Copying annotation', annotation);
			this._onSetDataTransferAnnotations(event.clipboardData, annotation);
		}
		else {
			let annotation = this._getAnnotationFromTextSelection('highlight');
			console.log('Copying text', annotation);
			this._onSetDataTransferAnnotations(event.clipboardData, annotation, true);
		}
		event.preventDefault();
	}

	_handleScroll(event) {
		this._handleViewUpdate();
	}

	_handleResize(event) {
		this._handleViewUpdate();
	}

	_handleFocus(event) {
		this._onFocus();
	}

	// ***
	// Setters that get called once there are changes in reader._state
	// ***

	setSelectedAnnotationIDs(ids) {
		this._selectedAnnotationIDs = ids;
		// Close annotation popup each time when any annotation is selected, because the click is what opens the popup
		this._onSetAnnotationPopup();

		this._iframeWindow.getSelection().empty();
	}

	setTool(tool) {
		this._tool = tool;
	}

	setAnnotations(annotations) {
		// Individual annotation object reference changes only if that annotation was modified,
		// so it's possible to do rendering optimizations by skipping other annotations
		this._annotations = annotations;
	}

	setShowAnnotations(show) {
		this._showAnnotations = show;
	}

	setAnnotationPopup(popup) {
		this._annotationPopup = popup;
	}

	setSelectionPopup(popup) {
		this._selectionPopup = popup;
	}

	setOverlayPopup(popup) {
		this._overlayPopup = popup;
		this._overlayPopupDelayer.setOpen(!!popup);
	}

	// Unlike annotation, selection and overlay popups, find popup open state is determined
	// with .open property. All popup properties are preserved even when it's closed
	setFindPopup(popup) {
		let previousPopup = this._findPopup;
		this._findPopup = popup;
		if (!popup.open && previousPopup.open !== popup.open) {
			console.log('Closing find popup');
		}
		else if (popup.open) {
			if (previousPopup.query !== popup.query
				|| previousPopup.highlightAll !== popup.highlightAll
				|| previousPopup.caseSensitive !== popup.caseSensitive
				|| previousPopup.entireWord !== popup.entireWord) {
				console.log('Initiating new search', popup);
				// Be careful of infinite loop, because calling _onSetFindPopup calls this.setFindPopup as well
				this._onSetFindPopup({ ...popup, resultsCount: Math.floor(Math.random() * 1000), resultIndex: 0 });
			}
		}
	}

	// ***
	// Public methods to control the view from the outside
	// ***

	focus() {
		this._iframe.focus();
	}

	findNext() {
		console.log('Find next');
	}

	findPrevious() {
		console.log('Find previous');
	}

	zoomIn() {
		let scale = parseFloat(this._iframeWindow.document.body.style.fontSize || '1');
		scale += 0.1;
		this._iframeWindow.document.body.style.fontSize = scale + 'em';
		this._handleViewUpdate();
	}

	zoomOut() {
		let scale = parseFloat(this._iframeWindow.document.body.style.fontSize || '1');
		scale -= 0.1;
		this._iframeWindow.document.body.style.fontSize = scale + 'em';
		this._handleViewUpdate();
	}

	zoomReset() {
		this._iframeWindow.document.body.style.fontSize = '1em';
		this._handleViewUpdate();
	}

	navigate(location) {
		console.log('Navigating to', location);
		if (location.annotationID) {
			let annotationNode = this._iframeWindow.document.body.querySelector(`[data-annotation-id="${location.annotationID}"]`);
			if (annotationNode) {
				annotationNode.scrollIntoView();
			}
		}
		// At the moment only navigation from note-editor (Show on Page) triggers
		// navigation to position. We should highlight or blink/fade out it.
		// The original annotation may be deleted or never existed at all (if dragged from text),
		// therefore we need to indicate it
		else if (location.position) {
			this._highlightedPosition = location.position;
			setTimeout(() => {
				this._highlightedPosition = null;
			}, 2000);
		}
		// In PDF view we're using pageIndex and pageLabel and I guess one of them or both
		// could be used to open specific page in EPUB document
		// else if (location.pageIndex) {
		//
		// }
		// else if (location.pageLabel) {
		//
		// }
	}

	// This is like back/forward navigation in browsers. Try Cmd-ArrowLeft and Cmd-ArrowRight in PDF view
	navigateBack() {

	}

	navigateForward() {

	}

	// Possibly we want different navigation types as well.
	// I.e. Books.app has a concept of "chapters"
	navigateToFirstPage() {

	}

	navigateToLastPage() {

	}

	navigateToPreviousPage() {

	}

	navigateToNextPage() {

	}

	// Still need to figure out how this is going to work
	print() {

	}
}

export default EPUBView;
