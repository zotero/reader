import { READ_ALOUD_BASE_COLOR } from '../defines';
import SVG from '!!raw-loader!../../../res/icons/20/read-aloud.svg';

let CSS = `
:host {
	position: absolute;
	display: none;
	inset-inline-start: 0;
	z-index: 999999;
	min-width: 28px;
}

button {
	all: unset;
	dir: inherit;
	display: flex;
	align-items: flex-start;
	justify-content: flex-end;
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	cursor: pointer;
	color: ${READ_ALOUD_BASE_COLOR};
	opacity: 0.5;
	padding-inline-end: 8px;
	line-height: 0;
	transition: opacity 0.15s;
}

button:hover {
	opacity: 1;
}
`;

export class ReadAloudJumpButton {
	_el;

	/**
	 * @param {Document} doc
	 * @param options
	 * @param {HTMLElement} [options.container]
	 * @param {string} [options.title]
	 * @param {() => void} options.onClick
	 */
	constructor(doc, { container = null, title = '', onClick }) {
		let host = doc.createElement('div');
		let shadow = host.attachShadow({ mode: 'closed' });

		let style = doc.createElement('style');
		style.textContent = CSS;
		shadow.append(style);

		let button = doc.createElement('button');
		if (title) {
			button.title = title;
		}
		button.innerHTML = SVG;
		button.addEventListener('mousedown', (event) => {
			// Prevent focus on click, so Space doesn't jump again
			event.preventDefault();
		});
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		shadow.append(button);

		(container || doc.body).append(host);
		this._el = host;
	}

	contains(target) {
		return this._el.contains(target);
	}

	/**
	 * Position and show the button.
	 *
	 * @param {object} paragraph
	 * @param {string} paragraph.marginWidth
	 * @param {string} paragraph.top
	 * @param {string} paragraph.height
	 */
	show({ marginWidth, top, height }) {
		this._el.style.width = marginWidth;
		this._el.style.top = top;
		this._el.style.height = height;
		this._el.style.display = 'block';
	}

	hide() {
		this._el.style.display = 'none';
	}

	/**
	 * A DOMRect spanning the primary click target of the jump button.
	 * While the actual click target spans the entire margin from top to bottom,
	 * this rect is the only area that should prevent the jump button from moving
	 * while hovered, even if the pointer technically enters another paragraph.
	 *
	 * @return {DOMRect | null}
	 */
	get iconTargetRect() {
		if (this._el.style.display === 'none') {
			return null;
		}
		let hostRect = this._el.getBoundingClientRect();
		let rtl = getComputedStyle(this._el).direction === 'rtl';

		// The icon is 20x20, inset 8px from the paragraph-side edge of the host
		let iconSize = 20;
		let iconInlineEnd = 8;
		let verticalMargin = 4;

		let x, width;
		if (rtl) {
			// In RTL, paragraph edge is host's left edge, icon is near the left
			x = hostRect.left;
			width = iconInlineEnd + iconSize;
		}
		else {
			// In LTR, paragraph edge is host's right edge, icon is near the right
			x = hostRect.right - iconInlineEnd - iconSize;
			width = iconInlineEnd + iconSize;
		}

		let y = hostRect.top - verticalMargin;
		let height = iconSize + verticalMargin * 2;

		return new DOMRect(x, y, width, height);
	}
}
