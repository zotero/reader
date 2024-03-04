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
			if (document.activeElement !== document.body && !document.activeElement.closest('.context-menu')) {
				this._lastActiveElement = document.activeElement;
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

	_handleFocus(event) {
		if ('closest' in event.target) {
			if (!event.target.closest('.annotation, .annotation-popup, .selection-popup, .label-popup, .context-menu, iframe')) {
				this._onDeselectAnnotations();
			}
			// Close find popup on blur if search query is empty
			if (!event.target.closest('.find-popup')) {
				let state = this._reader._state.primaryViewFindState;
				if (state && !state.query) {
					this._reader._updateState({ primaryViewFindState: { ...state, popupOpen: false } });
				}
				state = this._reader._state.secondaryViewState;
				if (state && !state.query) {
					this._reader._updateState({ secondaryViewState: { ...state, popupOpen: false } });
				}
			}
		}
	}

	_handlePointerDown(event) {
		if ('closest' in event.target) {
			if (!event.target.closest('input, textarea, [contenteditable="true"], .annotation, .thumbnails-view, .outline-view, .error-bar')) {
				// Note: Doing event.preventDefault() also prevents :active class on Firefox
				event.preventDefault();
			}
			else if (event.target.closest('.annotation') && event.target.closest('.more, .page, .tags')) {
				event.preventDefault();
			}
		}
	}

	_handleKeyDown(e) {
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
		if (pressedNextKey(e) && !e.target.closest('[contenteditable], input[type="text"]')) {
			e.preventDefault();
			this.tabToItem();
		}
		else if (pressedPreviousKey(e) && !e.target.closest('[contenteditable], input[type="text"]')) {
			e.preventDefault();
			this.tabToItem(true);
		}
	}

	tabToGroup(reverse) {
		if (document.querySelector('.context-menu')) {
			return;
		}

		let item = document.activeElement;

		let group = item.closest('[data-tabstop]') || item;

		let scope = document;
		let overlay = document.querySelector('.overlay');
		if (overlay) {
			scope = overlay;
		}
		let groups = Array.from(scope.querySelectorAll('[data-tabstop]'));

		groups = groups.map((x) => {
			let proxy = x.getAttribute('data-proxy');
			if (proxy) {
				proxy = document.querySelector(proxy);
				return proxy;
			}
			return x;
		});


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


		let focusableParent = item.parentNode.closest('[tabindex="-1"]');

		if (group.hasAttribute('tabindex')) {
			item = group;
		}
		else {
			if (reverse && focusableParent) {
				item = focusableParent;
			}
			else {
				item = group.querySelector('[tabindex="-1"]:not(:disabled)');
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

		let contextMenu = document.querySelector('.context-menu');
		if (contextMenu) {
			group = contextMenu;
		}

		if (item === group) {
			return;
		}

		let items = Array.from(group.querySelectorAll('[tabindex="-1"]:not(:disabled):not([data-tabstop])'));

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
