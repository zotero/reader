import { isTextBox, isLinux, isMac } from './lib/utilities';
import { ANNOTATION_COLORS } from './defines';

export class KeyboardManager {
	constructor(options) {
		this._reader = options.reader;
		window.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		window.addEventListener('keyup', this._handleKeyUp.bind(this), true);
	}

	_handleKeyUp(event, view) {
		let { key } = event;
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		let mod = ctrl || cmd;
		let alt = event.altKey;
		let shift = event.shiftKey;
		this.shift = shift;
		this.mod = mod;
	}

	_handleKeyDown(event, view) {
		let { key } = event;
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		let mod = ctrl || cmd;
		let alt = event.altKey;
		let shift = event.shiftKey;

		this.shift = shift;
		this.mod = mod;

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
			let selectedIDs = this._reader._state.selectedAnnotationIDs;
			// Don't delete if some selected annotations are read-only
			let hasReadOnly = !!this._reader._state.annotations.find(x => selectedIDs.includes(x.id) && x.readOnly);
			if (hasReadOnly) {
				return;
			}
			// Allow deleting annotation from annotation comment with some exceptions
			if (selectedIDs.length === 1) {
				let annotation = this._reader._state.annotations.find(x => x.id === selectedIDs[0]);
				if (event.target.closest('.content')
					&& (
						event.target.closest('.highlight')
						|| annotation.comment
						|| !this._reader._enableAnnotationDeletionFromComment
					)
				) {
					return;
				}
			}
			// Focus next annotation if annotations were selected not from a view
			if (selectedIDs.length >= 1 && !this._reader._annotationSelectionTriggeredFromView) {
				let { annotations } = this._reader._state;
				let firstIndex = annotations.findIndex(x => selectedIDs.includes(x.id));
				let lastIndex = annotations.findLastIndex(x => selectedIDs.includes(x.id));
				let id;
				if (lastIndex + 1 < annotations.length) {
					id = annotations[lastIndex + 1].id;
				}
				if (firstIndex - 1 >= 0) {
					id = annotations[firstIndex - 1].id;
				}
				this._reader.deleteAnnotations(this._reader._state.selectedAnnotationIDs);
				if (id) {
					let sidebarItem = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
					if (sidebarItem) {
						setTimeout(() => sidebarItem.focus());
					}
				}
			}
			else {
				this._reader.deleteAnnotations(this._reader._state.selectedAnnotationIDs);
			}
		}
	}

	handleViewKeyDown(event) {
		this._handleKeyDown(event, true);
	}

	handleViewKeyUp(event) {
		this._handleKeyUp(event, true);
	}
}

