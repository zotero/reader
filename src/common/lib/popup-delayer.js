
class PopupDelayer {
	constructor(options) {
		this._open = options.open;
		this._openingTimeout = null;
		this._lastRef = null;
		this._outside = false;
		window.addEventListener('pointermove', this._handlePointerMove);
	}

	_handlePointerMove = () => {
		this._outside = true;
	};

	destroy() {
		window.removeEventListener('pointermove', this._handlePointerMove);
	}

	setOpen(open) {
		this._open = open;
	}

	open(ref, callback) {
		this._outside = false;
		if (this._closingTimeout) {
			clearTimeout(this._closingTimeout);
			this._closingTimeout = null;
		}
		if (!this._openingTimeout || this._lastRef !== ref) {
			if (this._openingTimeout) {
				clearTimeout(this._openingTimeout);
			}
			this._openingTimeout = setTimeout(() => {
				this._openingTimeout = null;
				if (!this._outside) {
					callback();
				}
				if (this._closingTimeout) {
					clearTimeout(this._closingTimeout);
					this._closingTimeout = null;
				}
			}, 100);
		}
	}

	close(callback) {
		this._outside = false;
		if (this._openingTimeout) {
			clearTimeout(this._openingTimeout);
			this._openingTimeout = null;
		}
		if (this._open) {
			if (!this._closingTimeout) {
				this._closingTimeout = setTimeout(() => {
					this._closingTimeout = null;
					if (!this._outside) {
						callback();
					}
				}, 500);
			}
		}
	}
}

export default PopupDelayer;
