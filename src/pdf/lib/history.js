const MIN_TIME_BETWEEN_POINTS = 2000;

export class History {
	constructor(props) {
		this._onUpdate = props.onUpdate;
		this._onNavigate = props.onNavigate;
		this._backStack = [];
		this._forwardStack = [];
		this._currentLocation = null;
		this._lastPushIsTransient = false;
		this._lastSaveTime = 0;
	}

	get canNavigateBack() {
		return this._backStack.length > 0;
	}

	get canNavigateForward() {
		return this._forwardStack.length > 0;
	}

	/**
	 * Push a new point in history or replace the current one
	 *
	 * @param location
	 * @param transient Whether the location is temporary and not important enough
	 * 					to be saved as a standalone point in history
	 */
	save(location, transient) {
		// Check
		if (JSON.stringify(location) === JSON.stringify(this._currentLocation)) {
			return;
		}
		if (
			// Replace the current location if the new location is transient and
			// the previous was as well, or if currently on a pre vious point in history
			transient && (this._lastPushIsTransient || this.canNavigateForward)
			// Or if not enough time passed from the last hard point,
			// which we want to prevent when going through annotations or outline items
			|| !this._lastPushIsTransient && (Date.now() - this._lastSaveTime) < MIN_TIME_BETWEEN_POINTS
		) {
			this._currentLocation = location;
		}
		// Otherwise, push a new point in history
		else {
			if (this._currentLocation !== null) {
				this._backStack.push(this._currentLocation);
			}
			this._currentLocation = location;
			// Clear the forward stack when pushing a new location
			this._forwardStack = [];
			// Can be transient only if history was empty
			this._lastPushIsTransient = transient;
		}
		this._lastSaveTime = Date.now();
		this._onUpdate();
	}

	navigateBack() {
		if (this.canNavigateBack) {
			this._forwardStack.push(this._currentLocation);
			this._currentLocation = this._backStack.pop();
			this._onNavigate(this._currentLocation);
			this._onUpdate();
		}
	}

	navigateForward() {
		if (this.canNavigateForward) {
			this._backStack.push(this._currentLocation);
			this._currentLocation = this._forwardStack.pop();
			this._onNavigate(this._currentLocation);
			this._onUpdate();
		}
	}
}
