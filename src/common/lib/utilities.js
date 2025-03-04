export function isMac() {
	return !!navigator && /Mac/.test(navigator.platform);
}

export function isLinux() {
	return !!navigator && /Linux/.test(navigator.platform);
}

export function isWin() {
	return !!navigator && /Win/.test(navigator.platform);
}

// https://stackoverflow.com/a/9851769
export let isFirefox = typeof InstallTrigger !== 'undefined';
export let isSafari = /constructor/i.test(window.HTMLElement)
	|| (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && window['safari'].pushNotification))
	|| !!navigator && navigator.userAgent.includes('Safari/') && !navigator.userAgent.includes('Chrome/');

export function isTextBox(node) {
	return ['INPUT'].includes(node.nodeName) && node.type === 'text' || node.getAttribute('contenteditable') === 'true';
}

export function pressedNextKey(event) {
	let { key } = event;
	return !window.rtl && key === 'ArrowRight' || window.rtl && key === 'ArrowLeft' || key === 'ArrowDown';
}

export function pressedPreviousKey(event) {
	let { key } = event;
	return !window.rtl && key === 'ArrowLeft' || window.rtl && key === 'ArrowRight' || key === 'ArrowUp';
}

/**
 * Return a-z if 'key' is A-Z or 'code' is KeyA-KeyZ, and the 'key' wasn't already a-z.
 *
 * For keyboard layouts that have a-z characters (QWERTY, AZERTY, etc.) it returns
 * 'key', while for other layouts like Hebrew or Arabic it converts physical 'code' KeyA-KeyZ
 * to a-z character. On macOS Firefox does this by itself, while on Window it doesn't.
 *
 * It also lowercases A-Z because it's not always consistent
 *
 * @param key
 * @param code
 * @returns {string}
 */
export function normalizeKey(key, code) {
	if (key.length === 1) {
		if ('A' <= key && key <= 'Z') {
			key = key.toLowerCase();
		}
		if ((key < 'a' || key > 'z') && code.length === 4 && code[3] >= 'A' && code[3] <= 'Z') {
			key = code[3].toLowerCase();
		}
	}
	return key;
}

/**
 * Key combination taking into account layout and modifier keys
 * @param {KeyboardEvent} event
 * @returns {string}
 */
export function getKeyCombination(event) {
	let modifiers = [];
	if (event.metaKey && isMac()) {
		modifiers.push('Cmd');
	}
	if (event.ctrlKey) {
		modifiers.push('Ctrl');
	}
	if (event.altKey) {
		modifiers.push('Alt');
	}
	if (event.shiftKey) {
		modifiers.push('Shift');
	}
	let key = normalizeKey(event.key, event.code);
	if (key === ' ') {
		key = 'Space';
	}

	if (['Shift', 'Control', 'Meta', 'Alt'].includes(key)) {
		key = '';
	}

	// Combine the modifiers and the normalized key into a single string
	if (key) {
		modifiers.push(key);
	}
	return modifiers.join('-');
}

/**
 * Physical key combination
 * @param {KeyboardEvent} event
 * @returns {string}
 */
export function getCodeCombination(event) {
	let modifiers = [];
	if (event.metaKey && isMac()) {
		modifiers.push('Cmd');
	}
	if (event.ctrlKey) {
		modifiers.push('Ctrl');
	}
	if (event.altKey) {
		modifiers.push('Alt');
	}
	if (event.shiftKey) {
		modifiers.push('Shift');
	}

	let { key, code } = event;

	if (['Shift', 'Control', 'Meta', 'Alt'].includes(key)) {
		code = '';
	}

	// Combine the modifiers and the normalized key into a single string
	if (code) {
		modifiers.push(code);
	}
	return modifiers.join('-');
}

export function setCaretToEnd(target) {
	let range = document.createRange();
	let sel = window.getSelection();
	range.selectNodeContents(target);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
	target.focus();
	range.detach();
}

// https://github.com/jashkenas/underscore/blob/master/underscore.js
// (c) 2009-2018 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
// Underscore may be freely distributed under the MIT license.
// Returns a function, that, when invoked, will only be triggered at most once
// during a given window of time. Normally, the throttled function will run
// as much as it can, without ever going more than once per `wait` duration;
// but if you'd like to disable the execution on the leading edge, pass
// `{leading: false}`. To disable execution on the trailing edge, ditto.
// Note: The function is modified to support dynamic wait by accept a function as wait argument
export function throttle(func, wait, options) {
	var context, args, result;
	var timeout = null;
	var previous = 0;
	if (!options) options = {};

	// Helper function to get the wait time dynamically
	var getWaitTime = function() {
		return typeof wait === 'function' ? wait() : wait;
	};

	var later = function () {
		previous = options.leading === false ? 0 : Date.now();
		timeout = null;
		result = func.apply(context, args);
		if (!timeout) context = args = null;
	};

	return function () {
		var now = Date.now();
		if (!previous && options.leading === false) previous = now;
		var remaining = getWaitTime() - (now - previous); // Use the helper function
		context = this;
		args = arguments;
		if (remaining <= 0 || remaining > getWaitTime()) { // Use the helper function
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			previous = now;
			result = func.apply(context, args);
			if (!timeout) context = args = null;
		}
		else if (!timeout && options.trailing !== false) {
			timeout = setTimeout(later, remaining);
		}
		return result;
	};
}

export function positionsEqual(p1, p2) {
	if (Array.isArray(p1.rects) !== Array.isArray(p2.rects)
		|| Array.isArray(p1.paths) !== Array.isArray(p2.paths)) {
		return false;
	}

	if (p1.pageIndex !== p2.pageIndex) {
		return false;
	}

	if (p1.rects) {
		return JSON.stringify(p1.rects) === JSON.stringify(p2.rects);
	}
	else if (p1.paths) {
		return JSON.stringify(p1.paths) === JSON.stringify(p2.paths);
	}

	return false;
}

export function getImageDataURL(img) {
	var canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	var ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
	return canvas.toDataURL('image/png');
}

export function getPopupCoordinatesFromClickEvent(event) {
	let x = event.clientX;
	let y = event.clientY;

	if (event.screenX) {
		return { x: event.clientX, y: event.clientY };
	}
	else {
		let br = event.currentTarget.getBoundingClientRect();
		return { x: br.left, y: br.bottom };
	}
}

function getDragMultiIcon() {
	let node = document.getElementById('drag-multi');
	if (!node) {
		node = document.createElement('div');
		node.id = 'drag-multi';
		document.body.appendChild(node);
	}
	return node;
}

export function setMultiDragPreview(dataTransfer) {
	let icon = getDragMultiIcon();
	dataTransfer.setDragImage(icon, 0, 0);
}

// https://stackoverflow.com/a/25456134
export function basicDeepEqual(x, y) {
	if (x === y) {
		return true;
	}
	else if ((typeof x === 'object' && x != null) && (typeof y === 'object' && y !== null)) {
		if (Object.keys(x).length !== Object.keys(y).length) {
			return false;
		}
		for (let prop in x) {
			if (y.hasOwnProperty(prop)) {
				if (!basicDeepEqual(x[prop], y[prop])) {
					return false;
				}
			}
			else {
				return false;
			}
		}
		return true;
	}
	return false;
}

/**
 *
 * @param oldAnnotations
 * @param newAnnotations
 * @param viewOnly Get annotations that only affect view i.e. position or color changes
 * @returns {{deleted: *[], created: *[], updated: *[]}}
 */
export function getAffectedAnnotations(oldAnnotations, newAnnotations, viewOnly) {
	let deleted = [];
	// Annotations that newly appeared or disappeared
	let ids = new Set(newAnnotations.map(x => x.id));
	for (let annotation of oldAnnotations) {
		if (!ids.has(annotation.id)) {
			deleted.push(annotation);
		}
	}
	let created = [];
	let updated = [];
	let refs = new Map(oldAnnotations.map(x => [x.id, x]));
	for (let newAnnotation of newAnnotations) {
		let oldAnnotation = refs.get(newAnnotation.id);
		if (!oldAnnotation) {
			created.push(newAnnotation);
		}
		// Annotation ref changed
		else if (newAnnotation !== oldAnnotation) {
			if (viewOnly) {
				if (newAnnotation.color !== oldAnnotation.color
					|| newAnnotation.comment !== oldAnnotation.comment
					|| !basicDeepEqual(newAnnotation.position, oldAnnotation.position)) {
					updated.push(newAnnotation);
				}
			}
			else {
				updated.push(newAnnotation);
			}
		}
	}
	return { created, updated, deleted };
}

/**
 * Wait until scroll is no longer being triggered
 * @param {Document | Element} container Scrollable container
 * @param {number} debounceTime For how long the scroll shouldn't be triggered
 * @returns {Promise<unknown>}
 */
export function debounceUntilScrollFinishes(container, debounceTime = 100) {
	return new Promise((resolve) => {
		let debounceTimeout;
		let resolveAndCleanup = () => {
			container.removeEventListener('scroll', scrollListener);
			clearTimeout(debounceTimeout);
			resolve();
		};
		let scrollListener = () => {
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(resolveAndCleanup, debounceTime);
		};
		container.addEventListener('scroll', scrollListener);
		// Start the debounce timeout immediately
		debounceTimeout = setTimeout(resolveAndCleanup, debounceTime);
	});
}

// findLastIndex polyfill
if (!Array.prototype.findLastIndex) {
	Array.prototype.findLastIndex = function (callback, thisArg) {
		if (this == null) {
			throw new TypeError('"this" is null or not defined');
		}

		var o = Object(this);
		var len = o.length >>> 0;

		if (typeof callback !== 'function') {
			throw new TypeError('callback must be a function');
		}

		var k = len - 1;

		while (k >= 0) {
			var kValue = o[k];
			if (callback.call(thisArg, kValue, k, o)) {
				return k;
			}
			k--;
		}

		return -1;
	};
}

export function sortTags(tags) {
	let collator = new Intl.Collator(['en-US'], { numeric: true, sensitivity: 'base' });
	tags.sort((a, b) => {
		if (!a.color && !b.color) return collator.compare(a.name, b.name);
		if (!a.color && !b.color) return -1;
		if (!a.color && b.color) return 1;
		return a.position - b.position;
	});
	return tags;
}


/**
 * @param {ColorScheme | null} colorScheme
 * @returns {ColorScheme}
 */
export function getCurrentColorScheme(colorScheme) {
	let darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
	return (darkModeMediaQuery.matches || colorScheme === 'dark') ? 'dark' : 'light';
}

/**
 * Determines whether to use dark or light mode based on background and foreground colors.
 * @param {string} bgColor - Hex color code for the background (e.g., "#FFFFFF").
 * @param {string} fgColor - Hex color code for the foreground (e.g., "#000000").
 * @returns {ColorScheme} - "dark" if dark mode is recommended, "light" otherwise.
 */
export function getModeBasedOnColors(bgColor, fgColor) {
	// Helper to convert a hex color code to an array of RGB values
	function hexToRgbArray(hex) {
		const bigint = parseInt(hex.replace("#", ""), 16);
		return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
	}

	// Helper to calculate luminance directly from RGB values
	function calculateLuminance([r, g, b]) {
		return [r, g, b].map(value => {
			const normalized = value / 255;
			return normalized <= 0.03928
				? normalized / 12.92
				: Math.pow((normalized + 0.055) / 1.055, 2.4);
		}).reduce((luminance, channel, index) => {
			// Combine weighted luminance values
			const weights = [0.2126, 0.7152, 0.0722];
			return luminance + channel * weights[index];
		}, 0);
	}

	// Convert hex colors to RGB arrays and calculate their luminance
	const bgLuminance = calculateLuminance(hexToRgbArray(bgColor));
	const fgLuminance = calculateLuminance(hexToRgbArray(fgColor));

	// Determine and return mode based on luminance comparison
	return bgLuminance > fgLuminance ? "light" : "dark";
}

/**
 * Explicitly focus a given node within the view to force screen readers to move
 * their virtual cursors to that element. Screen readers just look at rendered content
 * so without this any navigation done via outline/Find in/page input in toolbar gets
 * undone by virtual cursor either remaining where it was or even jumping to the beginning of content.
 * @param target - node to focus from the view. Views keep track of it in  _a11yVirtualCursorTarget obj.
 */
export async function placeA11yVirtualCursor(target) {
	// Can't focus a textnode, so grab its parent (e.g. <p>)
	if (target?.nodeType === Node.TEXT_NODE) {
		target = target.parentNode;
	}
	if (!target) return;
	let doc = target.ownerDocument;
	let previousTarget =  doc.querySelector('.a11y-cursor-target');
	// if the target did not change, do nothing
	if (target == previousTarget && doc.activeElement == target) return;
	let oldTabIndex = target.getAttribute('tabindex');
	function blurHandler() {
		if (oldTabIndex) {
			target.setAttribute('tabindex', oldTabIndex);
		}
		else {
			target.removeAttribute('tabindex');
		}
		target.classList.remove('a11y-cursor-target');
	}
	// Make it temporarily focusable
	target.setAttribute('tabindex', '-1');
	target.classList.add('a11y-cursor-target');
	target.focus({ preventScroll: true });
	// Remove all a11y props if the element is blurred
	target.addEventListener('blur', blurHandler, { once: true });
	// Cleanup if the focus did not take
	if (doc.activeElement != target) {
		blurHandler({ target });
		return;
	}
}