import {
	isTextBox,
	isLinux,
	isMac,
	getKeyCombination,
	isWin,
	getCodeCombination,
	setCaretToEnd
} from './lib/utilities';
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
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		// Primary modifier
		let pm = isMac() ? 'Cmd' : 'Ctrl';

		this.shift = event.shiftKey;
		this.mod = ctrl || cmd;

		if (event.repeat) {
			return;
		}

		let key = getKeyCombination(event);
		let code = getCodeCombination(event);

		let sidebarAnnotationFocused = document.activeElement.classList.contains('annotation');

		if (!isTextBox(event.target)) {
			if (
				// macOS (ANSI/ISO)
				(isMac() && ['Cmd-BracketLeft', 'Cmd-ArrowLeft'].includes(code))
				// Windows / Linux
				|| (isLinux() && code === 'Ctrl-BracketLeft')
				|| ((isLinux() || isWin()) && code === 'Alt-ArrowLeft')
				// Dedicated mouse / keyboard button
				|| code === 'BrowserBack'
			) {
				this._reader.navigateBack();
				event.preventDefault();
				return;
			}
			if (
				// macOS (ANSI/ISO)
				(isMac() && ['Cmd-BracketRight', 'Cmd-ArrowRight'].includes(code))
				// Windows / Linux
				|| (isLinux() && code === 'Ctrl-BracketRight')
				|| ((isLinux() || isWin()) && code === 'Alt-ArrowRight')
				// Dedicated mouse / keyboard button
				|| code === 'BrowserForward'
			) {
				this._reader.navigateForward();
				event.preventDefault();
				return;
			}
		}

		// Focus on the last view if an arrow key is pressed in an empty annotation comment within the sidebar,
		// and the annotation was selected from the view
		let content = document.activeElement?.closest('.comment .content');
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)
			&& (content && !content.innerText)
			&& this._reader._annotationSelectionTriggeredFromView
		) {
			setTimeout(() => this._reader._lastView.focus());
		}

		if (key === 'Escape') {
			// Blur annotation comment and focus either the last view or the annotation in the sidebar
			if (document.activeElement.closest('.annotation .content')) {
				// Restore focus to the last view if the comment was focused by clicking on
				// an annotation without a comment.
				if (this._reader._annotationSelectionTriggeredFromView) {
					this._reader._updateState({ selectedAnnotationIDs: [] });
					setTimeout(() => this._reader._lastView.focus());
				}
				// Focus sidebar annotation (this is necessary for when using Enter/Escape to quickly
				// focus/blur sidebar annotation comment
				else {
					setTimeout(() => document.activeElement.closest('.annotation').focus());
				}
			}
			// Close print popup and cancel print preparation
			else if (this._reader._state.printPopup) {
				event.preventDefault();
				this._reader.abortPrint();
				setTimeout(() => this._reader._lastView.focus());
			}
			// Close context menu
			else if (this._reader._state.contextMenu) {
				event.preventDefault();
				this._reader._updateState({ contextMenu: null });
				setTimeout(() => this._reader._lastView.focus());
			}
			// Close label popup
			else if (this._reader._state.labelPopup) {
				event.preventDefault();
				this._reader._updateState({ labelPopup: null });
				setTimeout(() => this._reader._lastView.focus());
			}
			// Close both overlay popups
			else if (
				this._reader._state.primaryViewOverlayPopup
				|| this._reader._state.secondaryViewOverlayPopup
			) {
				event.preventDefault();
				this._reader._updateState({
					primaryViewOverlayPopup: null,
					secondaryViewOverlayPopup: null
				});
				setTimeout(() => this._reader._lastView.focus());
			}
			// Close theme popup
			else if (this._reader._state.themePopup) {
				event.preventDefault();
				this._reader._updateState({ themePopup: null });
			}
			// Close appearance popup
			else if (this._reader._state.appearancePopup) {
				event.preventDefault();
				this._reader._updateState({ appearancePopup: null });
				setTimeout(() => this._reader._lastView.focus());
			}
			// Deselect annotations
			else if (this._reader._state.selectedAnnotationIDs.length) {
				event.preventDefault();
				this._reader._updateState({ selectedAnnotationIDs: [] });
				setTimeout(() => this._reader._lastView.focus());
			}
			// Switch off the current annotation tool
			else if (this._reader._state.tool !== this._reader._tools['pointer']) {
				this._reader._updateState({ tool: this._reader._tools['pointer'] });
				event.preventDefault();
				setTimeout(() => this._reader._lastView.focus());
			}
			else {
				setTimeout(() => this._reader._lastView.focus());
			}
		}

		// Focus sidebar annotation comment if pressed Enter
		if (key === 'Enter') {
			if (sidebarAnnotationFocused) {
				setTimeout(() => {
					let input = document.activeElement.querySelector('.comment .content');
					if (input) {
						input.focus();
						setCaretToEnd(input);
					}
				});
			}
		}

		if (key === `${pm}-a`) {
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
		else if ((view || sidebarAnnotationFocused) && key === `${pm}-z`) {
			event.preventDefault();
			this._reader._annotationManager.undo();
			this._reader.setSelectedAnnotations([]);
		}
		else if ((view || sidebarAnnotationFocused) && key === `${pm}-Shift-z`) {
			event.preventDefault();
			this._reader._annotationManager.redo();
			this._reader.setSelectedAnnotations([]);
		}
		else if (key === `${pm}-f`) {
			event.preventDefault();
			this._reader.toggleFindPopup({ open: true });
		}
		else if (key === `${pm}-Shift-g`) {
			event.preventDefault();
			event.stopPropagation();
			this._reader.findPrevious();
		}
		else if (key === `${pm}-g`) {
			event.preventDefault();
			event.stopPropagation();
			this._reader.findNext();
		}
		else if (key === `${pm}Alt-g`) {
			event.preventDefault();
			let pageNumberInput = document.getElementById('pageNumber');
			pageNumberInput.focus();
			pageNumberInput.select();
		}
		else if (key === `${pm}-p`) {
			event.preventDefault();
			event.stopPropagation();
			this._reader.print();
		}
		else if (key === `${pm}-=` || key === `${pm}-+` || code === `${pm}-NumpadAdd`) {
			event.preventDefault();
			event.stopPropagation();
			this._reader.zoomIn();
		}
		else if (key === `${pm}--` || code === `${pm}-NumpadSubtract`) {
			event.preventDefault();
			event.stopPropagation();
			this._reader.zoomOut();
		}
		else if (key === `${pm}-0` || code === `${pm}-Digit0`) {
			event.preventDefault();
			event.stopPropagation();
			this._reader.zoomReset();
		}
		else if (['Delete', 'Backspace'].includes(key)) {
			// Prevent the deletion of annotations when they are selected and the focus is within
			// an input or label popup. Normally, the focus should not be inside an input unless
			// it is within a label popup, which needs to indicate the annotations being modified
			if (
				event.target.closest('input, .label-popup')
				|| document.querySelector('.context-menu-overlay')
			) {
				return;
			}
			if (this._reader._state.readOnly) {
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
				let deletedNum = this._reader.deleteAnnotations(this._reader._state.selectedAnnotationIDs);
				if (deletedNum && id) {
					let sidebarItem = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
					if (sidebarItem) {
						setTimeout(() => sidebarItem.focus());
					}
				}
			}
			else {
				let deletedNum = this._reader.deleteAnnotations(this._reader._state.selectedAnnotationIDs);
				if (deletedNum) {
					this._reader._lastView.focus();
				}
			}
		}

		if (!isTextBox(event.target)) {
			if (code === 'Alt-Digit1') {
				this._reader.toggleTool('highlight');
			}
			else if (code === 'Alt-Digit2') {
				this._reader.toggleTool('underline');
			}
			else if (code === 'Alt-Digit3') {
				this._reader.toggleTool('note');
			}
			else if (this._reader._type === 'pdf' && code === 'Alt-Digit4') {
				this._reader.toggleTool('text');
			}
			else if (this._reader._type === 'pdf' && code === 'Alt-Digit5') {
				this._reader.toggleTool('image');
			}
			else if (this._reader._type === 'pdf' && code === 'Alt-Digit6') {
				this._reader.toggleTool('ink');
			}
			else if (this._reader._type === 'pdf' && code === 'Alt-Digit7') {
				this._reader.toggleTool('eraser');
			}
			else if ((
				this._reader._type === 'pdf' && code === 'Alt-Digit8'
				|| ['epub', 'snapshot'].includes(this._reader._type) && code === 'Alt-Digit4'
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
			else if (code.startsWith('Digit') && this._reader._state.tool.color) {
				let idx = parseInt(code.slice(5)) - 1;
				if (ANNOTATION_COLORS[idx]) {
					this._reader.setTool({ color: ANNOTATION_COLORS[idx][1] });
				}
			}
		}
	}

	_handlePointerDown(event) {
		this.pointerDown = true;

		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		this.mod = ctrl || cmd;
		this.shift = event.shiftKey;
	}

	_handlePointerUp(event) {
		this.pointerDown = false;

		let ctrl = event.ctrlKey;
		let cmd = event.metaKey && isMac();
		this.mod = ctrl || cmd;
		this.shift = event.shiftKey;
	}

	handleViewKeyDown(event) {
		this._handleKeyDown(event, true);
	}

	handleViewKeyUp(event) {
		this._handleKeyUp(event, true);
	}
}

