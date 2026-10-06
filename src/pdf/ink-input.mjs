// Collect every available sample before scheduling a paint. Coalesced events
// carry coordinates even when they do not have a useful DOM target.
export function getInkSamples(event) {
	let samples = event.getCoalescedEvents?.() || [];
	return [...samples, event];
}

export function matchesInkPointer(action, event) {
	return action.pointerId === undefined || action.pointerId === event.pointerId;
}

export function appendInkSamples(path, event, toPoint) {
	for (let sample of getInkSamples(event)) {
		let point = toPoint(sample);
		if (!point || !point.every(Number.isFinite)) {
			continue;
		}
		let [x, y] = point;
		if (path[path.length - 2] !== x || path[path.length - 1] !== y) {
			path.push(x, y);
		}
	}
}

// A tap is a valid ink dot. SVG and PDF viewers need a segment to paint it.
export function ensureInkDot(path) {
	return path.length === 2 ? [...path, ...path] : path;
}

export class InkFrame {
	constructor(request, cancel, paint) {
		this._request = request;
		this._cancel = cancel;
		this._paint = paint;
		this._id = null;
		this._pages = new Set();
	}

	schedule(pageIndex) {
		this._pages.add(pageIndex);
		if (this._id === null) {
			this._id = this._request(() => {
				this._id = null;
				let pages = [...this._pages];
				this._pages.clear();
				this._paint(pages);
			});
		}
	}

	cancel() {
		if (this._id !== null) {
			this._cancel(this._id);
			this._id = null;
		}
		this._pages.clear();
	}
}
