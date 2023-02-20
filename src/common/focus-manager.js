import { pressedNextKey, pressedPreviousKey } from './lib/utilities';

export class FocusManager {
	constructor(options) {
		this._onDeselectAnnotations = options.onDeselectAnnotations;
		window.addEventListener('focusin', this._handleFocus.bind(this));
		window.addEventListener('mousedown', this._handleMouseDown.bind(this));
		window.addEventListener('keydown', this._handleKeyDown.bind(this), true);

		// Some browsers (Chrome) trigger focus event when focusing an iframe and some not (Firefox),
		// therefore just use an interval because document.activeElement is always correct
		setInterval(() => {
			if (document.activeElement !== document.body && !document.activeElement.closest('.context-menu')) {
				this._lastActiveElement = document.activeElement;
			}
		}, 100);
	}

	restoreFocus() {
		this._lastActiveElement?.focus();
	}

	_handleFocus(event) {
		if ('closest' in event.target && !event.target.closest('.annotation, .annotation-popup, .selection-popup, .find-popup .overlay-popup, .context-menu, iframe')) {
			this._onDeselectAnnotations();
		}
	}

	_handleMouseDown(event) {
		if ('closest' in event.target) {
			if (!event.target.closest('input, textarea, [contenteditable="true"], .annotation, .thumbnails-view, .outline-view')) {
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
		if (e.target.closest('.outline-view') && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
			return;
		}
		if (pressedNextKey(e)) {
			this.tabToItem();
		}
		else if (pressedPreviousKey(e)) {
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

		if (groupIndex === -1 || groupIndex === groups.length - 1) {
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



}
