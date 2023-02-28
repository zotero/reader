import { isTextBox, isLinux, isMac } from './lib/utilities';
import { ANNOTATION_COLORS } from './defines';

export class KeyboardManager {
	constructor(options) {
		this._reader = options.reader;
		window.addEventListener('keydown', this._handleKeyDown.bind(this), true);
	}

	_handleKeyDown(event, view) {
		let { key } = event;
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		let mod = ctrl || cmd;
		let alt = event.altKey;
		let shift = event.shiftKey;

		if (event.repeat) {
			return;
		}

		if (view) {
			if ((cmd || ctrl && isLinux()) && key === '['
				|| (alt && !isMac() || cmd) && key === 'ArrowLeft') {
				this._reader.navigateBack();
			}
			else if ((cmd || ctrl && isLinux()) && key === ']'
				|| (alt && !isMac() || cmd) && key === 'ArrowRight') {
				this._reader.navigateForward();
			}
		}

		// Escape must be pressed alone. We basically want to prevent
		// Option-Escape (speak text on macOS) deselecting text
		if (key === 'Escape' && !(mod || alt || shift)) {
			this._reader._lastView.focus();
			this._reader.abortPrint();
			this._reader._updateState({
				selectedAnnotationIDs: [],
				labelOverlay: null,
				contextMenu: null,
				tool: {
					...this._reader._state.tool,
					type: 'pointer'
				},
				primaryViewFindState: {
					...this._reader._state.primaryViewFindState,
					popupOpen: false
				},
				secondaryViewFindState: {
					...this._reader._state.secondaryViewFindState,
					popupOpen: false
				}
			});
			this._reader.setFilter({
				query: '',
				colors: [],
				tags: [],
				authors: []
			});
		}

		if (mod && key === 'a') {
			// Prevent text selection if not inside a text box
			if (!isTextBox(event.target)) {
				event.preventDefault();
				// If sidebar is open and Mod-A was inside a view or sidebar, select visible annotations
				if (this._reader._state.sidebarOpen
					&& this._reader._state.sidebarView === 'annotations'
					&& (view || event.target.closest('#annotationsView'))) {
					this._reader.setSelectedAnnotations(this._reader._state.annotations.filter(x => !x._hidden).map(x => x.id));
				}
			}
		}
		else if (mod && key === 'f') {
			event.preventDefault();
			this._reader.toggleFindPopup({ open: true });
		}
		else if (mod && key === 'p') {
			event.preventDefault();
			event.stopPropagation();
			this._reader.print();
		}
		else if (mod && key === '=') {
			event.preventDefault();
			this._reader.zoomIn();
		}
		else if (mod && key === '-') {
			event.preventDefault();
			this._reader.zoomOut();
		}
		else if (mod && key === '0') {
			event.preventDefault();
			this._reader.zoomReset();
		}
		else if (['Delete', 'Backspace'].includes(key)) {
			this._reader.deleteAnnotations(this._reader._state.selectedAnnotationIDs);
			// // TODO: Auto-select the next annotation after deletion in sidebar
			// let id = selectedIDsRef.current[0];
			// let annotation = annotationsRef.current.find(x => x.id === id);
			//
			// let hasReadOnly = !!annotationsRef.current.find(x => selectedIDsRef.current.includes(x.id) && x.readOnly);
			// if (!hasReadOnly) {
			// 	if (['sidebar-annotation', 'view-annotation'].includes(focusManagerRef.current.zone.id)) {
			// 		props.onDeleteAnnotations(selectedIDsRef.current);
			// 	}
			// 	else if (['sidebar-annotation-comment', 'view-annotation-comment'].includes(focusManagerRef.current.zone.id)
			// 		&& annotation && !annotation.comment && !annotationCommentTouched.current) {
			// 		props.onDeleteAnnotations([id]);
			// 	}
			// }
		}



		// Cmd-a should select all annotations
	}

	handleViewKeyDown(event) {
		this._handleKeyDown(event, true);
	}
}

