
class PopupDelayer {
	constructor(options) {
		this._open = options.open;
		this._openingTimeout = null;
		this._closeInitiationTime = null;
		this._lastRef = null;
	}

	setOpen(open) {
		this._open = open;
	}

	open(ref, callback) {
		this._closeInitiationTime = null;
		if (this._open) {
			return callback();
		}
		if (!this._openingTimeout || this._lastRef !== ref) {
			if (this._openingTimeout) {
				clearTimeout(this._openingTimeout);
			}
			this._openingTimeout = setTimeout(() => {
				this._openingTimeout = null;
				callback();
			}, 500);
		}
	}

	close(callback) {
		if (this._openingTimeout) {
			clearTimeout(this._openingTimeout);
			this._openingTimeout = null;
		}
		if (this._open) {
			if (this._closeInitiationTime) {
				if (Date.now() - this._closeInitiationTime >= 500) {
					this._closeInitiationTime = null;
					callback();
				}
			}
			else {
				this._closeInitiationTime = Date.now();
			}
		}
	}
}

export default PopupDelayer;
