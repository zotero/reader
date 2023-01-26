
const MAX_VELOCITY = 500;
const SENSITIVITY = 3;
const MARGIN = 25;

export class AutoScroll {
	constructor({ container }) {
		this._enabled = true;
		this._container = container;
		this._scrollVector = [0, 0];
		let previousTimeStamp;
		let deltaX = 0;
		let deltaY = 0;
		let scroll = (timestamp) => {
			if (previousTimeStamp) {
				let deltaTime = timestamp - previousTimeStamp;
				// scrollLeft
				if (this._scrollVector[0] !== 0) {
					deltaY += deltaTime / 1000 * this._scrollVector[0];
					let y = Math.floor(deltaY);
					deltaY -= y;
					container.scrollLeft += y;
				}
				// scrollTop
				if (this._scrollVector[1] !== 0) {
					deltaX += deltaTime / 1000 * this._scrollVector[1];
					let x = Math.floor(deltaX);
					deltaX -= x;
					container.scrollTop += x;
				}
			}
			previousTimeStamp = timestamp;
			container.ownerDocument.defaultView.requestAnimationFrame(scroll);
		};
		container.ownerDocument.defaultView.requestAnimationFrame(scroll);


		container.ownerDocument.defaultView.addEventListener('mousemove', this._handleMouseMove.bind(this));
		container.ownerDocument.defaultView.addEventListener('mouseup', () => this.disable.bind(this));

	}

	_handleMouseMove(event) {
		if (event.buttons !== 1) {
			this.disable();
			return;
		}
		if (!this._enabled) {
			return;
		}
		let rect = this._container.getBoundingClientRect();
		rect = [rect.left, rect.top, rect.right, rect.bottom];
		rect = [
			rect[0] + MARGIN,
			rect[1] + MARGIN,
			rect[2] - MARGIN,
			rect[3] - MARGIN
		];

		let p = [event.clientX, event.clientY];

		// Get absolute distance to rect
		var dx = Math.max(rect[0] - p[0], 0, p[0] - rect[2]);
		var dy = Math.max(rect[1] - p[1], 0, p[1] - rect[3]);

		dx *= SENSITIVITY;
		dy *= SENSITIVITY;

		if (dx > MAX_VELOCITY) {
			dx = MAX_VELOCITY;
		}

		if (dy > MAX_VELOCITY) {
			dy = MAX_VELOCITY;
		}

		// Return direction sign
		if (p[0] < rect[0]) {
			dx *= -1;
		}
		if (p[1] < rect[1]) {
			dy *= -1;
		}

		this._scrollVector = [dx, dy];
	}

	enable() {
		this._enabled = true;
	}

	disable() {
		this._enabled = false;
		this._scrollVector = [0, 0];
	}
}
