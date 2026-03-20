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
	align-items: center;
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
}
