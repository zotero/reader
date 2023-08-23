import { isTextBox, isLinux, isMac } from './lib/utilities';
import { ANNOTATION_COLORS } from './defines';

export class KeyboardManager {
	constructor(options) {
		this._reader = options.reader;
		window.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		window.addEventListener('keyup', this._handleKeyUp.bind(this), true);
		// TODO: Possibly the current file should be renamed to input-manager if also watching pointer state
		window.addEventListener('pointerdown', this._handlePointerDown.bind(this), true);
		window.addEventListener('pointerup', this._handlePointerUp.bind(this), true);
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
		let { key, code } = event;
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

		if ((cmd || ctrl && isLinux()) && key === '['
			|| (alt && !isMac() || cmd) && key === 'ArrowLeft') {
			this._reader.navigateBack();
			event.preventDefault();
			return;
		}
		else if ((cmd || ctrl && isLinux()) && key === ']'
			|| (alt && !isMac() || cmd) && key === 'ArrowRight') {
			this._reader.navigateForward();
			event.preventDefault();
			return;
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
				tool: this._reader._tools['pointer'],
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
					let selectedAnnotationIDs = this._reader._state.annotations.filter(x => !x._hidden).map(x => x.id);
					this._reader._updateState({ selectedAnnotationIDs });
				}
			}
		}
		else if (mod && key === 'f') {
			event.preventDefault();
			this._reader.toggleFindPopup({ open: true });
		}
		else if (shift && mod && key.toLowerCase() === 'g') {
			event.preventDefault();
			this._reader.findPrevious();
		}
		else if (mod && key.toLowerCase() === 'g') {
			event.preventDefault();
			this._reader.findNext();
		}
		// Focus page number input. Check for KeyG because alt/option key gives a different key
		else if (mod && alt && code === 'KeyG') {
			event.preventDefault();
			let pageNumberInput = document.getElementById('pageNumber');
			pageNumberInput.focus();
			pageNumberInput.select();
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
		else if (alt && code === 'Digit1') {
			this._reader.toggleTool('highlight');
		}
		else if (alt && code === 'Digit2') {
			this._reader.toggleTool('underline');
		}
		else if (alt && code === 'Digit3') {
			this._reader.toggleTool('note');
		}
		else if (alt && this._reader._type === 'pdf' && code === 'Digit4') {
			this._reader.toggleTool('text');
		}
		else if (alt && this._reader._type === 'pdf' && code === 'Digit5') {
			this._reader.toggleTool('image');
		}
		else if (alt && this._reader._type === 'pdf' && code === 'Digit6') {
			this._reader.toggleTool('ink');
		}
		else if (alt && this._reader._type === 'pdf' && code === 'Digit7') {
			this._reader.toggleTool('eraser');
		}
		else if (alt
			&& (
				this._reader._type === 'pdf' && code === 'Digit8'
				|| ['epub', 'snapshot'].includes(this._reader._type) && code === 'Digit4'
			) && this._reader._state.tool.color) {
			let idx = ANNOTATION_COLORS.findIndex(x => x[1] === this._reader._state.tool.color);
			if (idx === ANNOTATION_COLORS.length - 1) {
				idx = 0;
			}
			else {
				idx++;
			}
			this._reader.setTool({ color: ANNOTATION_COLORS[idx][1] });
		}
		else if (!alt && !mod && code.slice(0, 5) === 'Digit' && this._reader._state.tool.color) {
			let idx = parseInt(code.slice(5)) - 1;
			if (ANNOTATION_COLORS[idx]) {
				this._reader.setTool({ color: ANNOTATION_COLORS[idx][1] });
			}
		}
		else if (['Delete', 'Backspace'].includes(key)) {
			if (isTextBox(event.target) && event.target.closest('#findbar') || event.target.closest('.label-overlay')) {
				return;
			}
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
						event.target.closest('.text')
						|| annotation.comment
						|| !this._reader._enableAnnotationDeletionFromComment
					)
				) {
					return;
				}
			}
			// Focus next annotation if deleted annotations were selected not from a view
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

	_handlePointerDown(event) {
		this.pointerDown = true;
	}

	_handlePointerUp(event) {
		this.pointerDown = false;
	}

	handleViewKeyDown(event) {
		this._handleKeyDown(event, true);
	}

	handleViewKeyUp(event) {
		this._handleKeyUp(event, true);
	}
}

