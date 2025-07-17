import { isFirefox, pressedNextKey, pressedPreviousKey } from './lib/utilities';

export class FocusManager {
	constructor(options) {
		this._reader = options.reader;
		this._onDeselectAnnotations = options.onDeselectAnnotations;
		// Methods to move focus to elements outside of the reader
		this._onToolbarShiftTab = options.onToolbarShiftTab;
		this._onIframeTab = options.onIframeTab;
		window.addEventListener('focusin', this._handleFocus.bind(this));
		window.addEventListener('pointerdown', this._handlePointerDown.bind(this));
		window.addEventListener('keydown', this._handleKeyDown.bind(this), true);
		window.addEventListener('copy', this._handleCopy.bind(this), true);

		// Some browsers (Chrome) trigger focus event when focusing an iframe and some not (Firefox),
		// therefore just use an interval because document.activeElement is always correct
		setInterval(() => {
			if (!this._preventFocus && document.activeElement !== document.body && !document.activeElement.closest('.context-menu-overlay')) {
				this._lastActiveElement = document.activeElement;
				this._preventFocus = false;
			}
		}, 100);

		if (isFirefox) {
			this._initFirefoxActivePseudoClassFix();
		}
	}

	restoreFocus() {
		let selectedAnnotationIDs = this._reader._state.selectedAnnotationIDs.slice();
		this._lastActiveElement?.focus();
		if (selectedAnnotationIDs.length > 1) {
			this._reader._updateState({ selectedAnnotationIDs });
		}
	}

	// Focus the first button from the toolbar
	focusToolbar() {
		document.querySelector(".toolbar .start .toolbar-button").focus();
	}

	_initFirefoxActivePseudoClassFix() {
		// Work around :active pseudo class being prevented by event.preventDefault() on Firefox.
		window.addEventListener('pointerdown', (event) => {
			let button = event.target.closest('button');
			if (button) {
				button.classList.add('active-pseudo-class-fix');
			}
		});
		window.addEventListener('pointerup', () => {
			document.querySelectorAll('button.active-pseudo-class-fix').forEach(x => x.classList.remove('active-pseudo-class-fix'));
		});
		window.addEventListener('pointerout', (event) => {
			if (event.buttons === 0) {
				document.querySelectorAll('button.active-pseudo-class-fix').forEach(x => x.classList.remove('active-pseudo-class-fix'));
			}
		});
	}

	_closeFindPopupIfEmpty() {
		let state = this._reader._state.primaryViewFindState;
		if (state && !state.query) {
			this._reader._updateState({ primaryViewFindState: { ...state, popupOpen: false } });
		}
		state = this._reader._state.secondaryViewState;
		if (state && !state.query) {
			this._reader._updateState({ secondaryViewState: { ...state, popupOpen: false } });
		}
	}

	_handleFocus(event) {
		if ('closest' in event.target) {
			if (!event.target.closest('.annotation, .annotation-popup, .selection-popup, .label-popup, .appearance-popup, .context-menu, iframe')) {
				this._onDeselectAnnotations();
			}
			// Close find popup on blur if search query is empty
			if (!event.target.closest('.find-popup')) {
				this._closeFindPopupIfEmpty();
			}
		}
	}

	_handlePointerDown(event) {
		if ('closest' in event.target) {
			// An ugly workaround to prevent delayed selection of annotation in the sidebar on right-click on Windows
			if (event.button === 2 && event.target.closest('.annotation')) {
				this._preventFocus = true;
				return;
			}

			if (!event.target.closest('input, textarea, [contenteditable="true"], .annotation, .thumbnails-view, .outline-view, .error-bar, .reference-row, .preview-popup, .appearance-popup, #selector')) {
				// Note: Doing event.preventDefault() also prevents :active class on Firefox
				event.preventDefault();
			}
			else if (event.target.closest('.annotation') && event.target.closest('.more, .page, .tags')) {
				event.preventDefault();
			}
		}
	}

	_handleKeyDown(e) {
		// Switch focus back to the view if trying to resize highlight/underline annotation,
		// but currently sidebar/popup comment is focused
		let emptyComment = true;
		let ids = this._reader._state.selectedAnnotationIDs;
		if (ids.length === 1) {
			let annotation = this._reader._state.annotations.find(x => x.id === ids[0]);
			if (annotation?.comment) {
				emptyComment = false;
			}
		}
		// Restore focus to the last view if
		if (this._reader._annotationSelectionTriggeredFromView
			&& e.target.closest('.comment [contenteditable="true"]')
			&& emptyComment
			&& e.shiftKey
			&& e.key.startsWith('Arrow')) {
			this._reader._lastView.focus();
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		if (e.shiftKey && e.key === 'Tab') {
			this.tabToGroup(true);
			e.preventDefault();
		}
		else if (e.key === 'Tab') {
			this.tabToGroup();
			e.preventDefault();
		}

		// Allow to expand/collapse outline items with left and right arrow keys
		if ((e.target.closest('.outline-view') || e.target.closest('input[type="range"]')) && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
			return;
		}
		if (pressedNextKey(e) && !e.target.closest('[contenteditable], input[type="text"], .preview-popup')) {
			e.preventDefault();
			this.tabToItem();
		}
		else if (pressedPreviousKey(e) && !e.target.closest('[contenteditable], input[type="text"], .preview-popup')) {
			e.preventDefault();
			this.tabToItem(true);
		}
		// If context menu is opened and a character is typed, forward the event to context menu
		// so it can select a menuitem, similar to how native menus do it.
		let contextMenu = document.querySelector('.context-menu');
		if (contextMenu && e.key.length == 1 && !e.forwardedToContextMenu && !contextMenu.contains(e.target)) {
			let eventCopy = new KeyboardEvent('keydown', {
				key: e.key,
				bubbles: true
			});
			// Mark the event to skip it when it gets captured here to avoid infinite loop
			eventCopy.forwardedToContextMenu = true;
			contextMenu.dispatchEvent(eventCopy);
		}
	}

	tabToGroup(reverse) {
		if (document.querySelector('.context-menu')) {
			return;
		}

		let item = document.activeElement;

		let group = item.closest('[data-tabstop]') || item;

		let scope = document;
		let overlay = Array.from(document.querySelectorAll('.overlay')).at(-1);
		if (overlay) {
			scope = overlay;
		}

		let groups = Array.from(scope.querySelectorAll('[data-tabstop]:not(.hidden)'));

		groups = groups.map((x) => {
			let proxy = x.getAttribute('data-proxy');
			if (proxy) {
				proxy = document.querySelector(proxy);
				return proxy;
			}
			return x;
		}).filter(group =>!group.closest(".viewWrapper.hidden"));


		if (reverse) {
			groups.reverse();
		}

		let groupIndex = groups.findIndex(x => x === group);

		if (groupIndex === groups.length - 1) {
			if (reverse) {
				// Shift-tab from the first group (toolbar)
				this._onToolbarShiftTab();
			}
			else {
				// Tab from the last group (reader iframe)
				this._onIframeTab();
			}
			return;
		}

		if (groupIndex === -1) {
			groupIndex = 0;
		}
		else {
			groupIndex++;
		}

		group = groups[groupIndex];

		// If jumping into the sidebar annotations view, focus the last selected annotation,
		// but don't trigger navigation in the view
		if (group.classList.contains('annotations')
			&& this._reader._lastSelectedAnnotationID
			// Make sure there are at least two annotations, otherwise it won't be possible to navigate to annotation
			&& this._reader._state.annotations.length >= 2
			// Make sure the annotation still exists
			&& this._reader._state.annotations.find(x => x.id === this._reader._lastSelectedAnnotationID)) {
			this._reader._updateState({ selectedAnnotationIDs: [this._reader._lastSelectedAnnotationID] });
			// It also needs to be focused, otherwise pressing TAB will shift the focus to an unexpected location
			setTimeout(() => group.querySelector(`[data-sidebar-annotation-id="${this._reader._lastSelectedAnnotationID}"]`)?.focus(), 100);
			return;
		}

		let focusableParent = item.parentNode.closest('[tabindex="-1"]');

		if (group.hasAttribute('tabindex')) {
			item = group;
		}
		else {
			if (reverse && focusableParent) {
				item = focusableParent;
			}
			else {
				item = group.querySelector('[tabindex="-1"]:not(:disabled):not(.hidden)');
			}
		}

		if (!item) {
			item = group;
		}

		item.focus();
	}

	tabToItem(reverse) {
		let item = document.activeElement;

		let group = item.closest('[data-tabstop]');

		// This is a special case for context menu. If there is a context menu
		// in the DOM, arrow up/down must focus it ignoring everything else
		let contextMenu = document.querySelector('.context-menu');
		if (contextMenu) {
			group = contextMenu;
		}

		if (!group) {
			return;
		}

		if (item === group) {
			return;
		}

		let items = Array.from(group.querySelectorAll('[tabindex="-1"]:not(:disabled):not([data-tabstop]):not(.hidden)'));

		if (!items) {
			return;
		}

		if (reverse) {
			items.reverse();
		}

		let itemIndex = items.findIndex(x => x === document.activeElement);

		if (itemIndex === -1) {
			itemIndex = 0;
		}
		else {
			itemIndex++;
		}

		if (itemIndex !== items.length) {
			item = items[itemIndex];

			item.focus();
			if (item.nodeName === 'INPUT' && item.type === 'text') {
				setTimeout(() => item.setSelectionRange(item.value.length, item.value.length));
			}
		}
	}

	// Allow copying annotations from sidebar
	_handleCopy(event) {
		if (document.activeElement?.closest('.error-bar')) {
			return;
		}
		let ids = this._reader._state.selectedAnnotationIDs;
		if (ids.length > 0) {
			let annotation = this._reader._state.annotations.find(x => x.id === ids[0]);
			if (!document.activeElement?.closest('.text, .comment')
				|| (
					document.activeElement?.closest('.comment')
					&& !annotation.comment
					&& this._reader._annotationSelectionTriggeredFromView
				)) {
				this._reader._handleSetDataTransferAnnotations(event.clipboardData, annotation);
				event.preventDefault();
			}
		}
	}
}
