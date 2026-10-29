const LOOKUP_STATUSES = new Set([
	'strong',
	'no-match',
	'invalid',
	'offline',
	'rate-limited',
	'timeout',
	'cancelled',
	'error',
	'expired',
	'incomplete',
]);

const RESULT_ACTIONS = new Set([
	'add-to-library',
	'show-in-library',
	'open-attachment',
	'view-online',
]);

const ACTION_STATUSES = new Set([
	'ok',
	'existing',
	'saved',
	'stale',
	'failed',
	'duplicate-conflict',
]);

export const MAX_REFERENCE_PARTS = 64;
export const MAX_REFERENCE_PART_TEXT_LENGTH = 4096;

const MAX_OPAQUE_ID_LENGTH = 256;

let nextRequestID = 0;

function createRequestID() {
	return `reference-popup-${++nextRequestID}`;
}

function validOpaqueID(value) {
	return typeof value === 'string'
		&& value.length > 0
		&& value.length <= MAX_OPAQUE_ID_LENGTH;
}

function normalizeDisplay(display) {
	if (!display
			|| typeof display.itemType !== 'string'
			|| typeof display.title !== 'string') {
		return null;
	}
	let normalized = {
		itemType: display.itemType,
		title: display.title,
		firstCreator: typeof display.firstCreator === 'string' ? display.firstCreator : null,
		year: typeof display.year === 'string' ? display.year : null,
	};
	if (display.abstract === null || typeof display.abstract === 'string') {
		normalized.abstract = display.abstract;
	}
	return normalized;
}

export function normalizeReferenceResult(result) {
	if (!result
			|| !validOpaqueID(result.resultID)
			|| !['existing', 'unsaved'].includes(result.libraryState)) {
		return null;
	}
	let display = normalizeDisplay(result.display);
	if (!display) {
		return null;
	}
	let normalized = {
		resultID: result.resultID,
		libraryState: result.libraryState,
		display,
		actions: Array.isArray(result.actions)
			? [...new Set(result.actions.filter(action => RESULT_ACTIONS.has(action)))]
			: [],
	};
	return normalized;
}

function invalidLookupResponse(request, referenceKey = '') {
	return {
		requestID: request.requestID,
		referenceKey,
		status: 'invalid',
	};
}

export function normalizeReferenceLookupResponse(response, request) {
	if (!response
			|| response.requestID !== request.requestID
			|| (['strong', 'no-match'].includes(response.status) && !validOpaqueID(response.referenceKey))
			|| !LOOKUP_STATUSES.has(response.status)) {
		return invalidLookupResponse(request);
	}
	let normalized = {
		requestID: request.requestID,
		referenceKey: validOpaqueID(response.referenceKey) ? response.referenceKey : '',
		status: response.status,
	};
	if (response.status === 'strong') {
		normalized.result = normalizeReferenceResult(response.result);
		if (!normalized.result) return invalidLookupResponse(request, response.referenceKey);
	}
	if ((normalized.result || ['error', 'cancelled'].includes(normalized.status))
			&& response.lookupSource === 'online') {
		normalized.lookupSource = 'online';
	}
	return normalized;
}

export function normalizeReferenceActionResponse(response, request) {
	if (!response
			|| response.requestID !== request.requestID
			|| response.referenceKey !== request.referenceKey
			|| !ACTION_STATUSES.has(response.status)) {
		return {
			requestID: request.requestID,
			referenceKey: request.referenceKey,
			status: 'failed',
		};
	}
	let normalized = {
		requestID: request.requestID,
		referenceKey: request.referenceKey,
		status: response.status,
	};
	if (response.result) {
		let result = normalizeReferenceResult(response.result);
		if (!result) {
			return { ...normalized, status: 'failed' };
		}
		normalized.result = result;
	}
	if (['saved', 'existing'].includes(response.status)
			&& normalized.result?.libraryState !== 'existing') {
		return { ...normalized, status: 'failed', result: undefined };
	}
	return normalized;
}

function queue(callback) {
	Promise.resolve().then(callback);
}

export class ReferencePopupBridge {
	constructor(options = {}) {
		this._resultListeners = new Set();
		this._onMatchReference = options.onMatchReference;
		this._onFindReferenceOnline = options.onFindReferenceOnline;
		this._onCancelReferenceLookup = options.onCancelReferenceLookup;
		this._onPerformReferenceAction = options.onPerformReferenceAction;
	}

	get enabled() {
		return typeof this._onMatchReference === 'function';
	}

	subscribeResultUpdates(listener) {
		this._resultListeners.add(listener);
		return () => this._resultListeners.delete(listener);
	}

	updateReferenceResult({ referenceKey, result } = {}) {
		result = normalizeReferenceResult(result);
		if (!validOpaqueID(referenceKey) || result?.libraryState !== 'existing') return;
		// The host invokes the saved callback first. Share its FIFO delivery queue,
		// and never replay a notification into a newly opened popup.
		let listeners = [...this._resultListeners];
		queue(() => {
			for (let listener of listeners) {
				if (this._resultListeners.has(listener)) listener({ referenceKey, result });
			}
		});
	}

	get canFindOnline() {
		return typeof this._onFindReferenceOnline === 'function';
	}

	startLocalLookup({ sourceKey, referenceParts }, onResponse) {
		let parts = referenceParts.filter(part => typeof part?.text === 'string' && part.text);
		let request = { requestID: createRequestID() };
		// A clipped visible reference can hide conflicting identifiers and produce a false match.
		if (!validOpaqueID(sourceKey) || parts.length > MAX_REFERENCE_PARTS
				|| parts.some(part => part.text.length > MAX_REFERENCE_PART_TEXT_LENGTH)) {
			return this._startLookup((request, respond) => respond(invalidLookupResponse(request)), request, onResponse);
		}
		request.sourceKey = sourceKey;
		request.referenceParts = parts.map(part => ({ text: part.text }));
		return this._startLookup(this._onMatchReference, request, onResponse);
	}

	startOnlineLookup({ referenceKey }, onResponse) {
		let request = { requestID: createRequestID(), referenceKey };
		return this._startLookup(this._onFindReferenceOnline, request, onResponse);
	}

	_startLookup(handler, request, onResponse) {
		let cancel = this._startRequest(handler, request, onResponse,
			normalizeReferenceLookupResponse, this._onCancelReferenceLookup);
		return { requestID: request.requestID, cancel };
	}

	_startRequest(handler, request, onResponse, normalize, onCancel) {
		let active = true;
		let hostSettled = false;
		let deliver = (response) => {
			if (hostSettled) return;
			hostSettled = true;
			queue(() => {
				if (active) {
					onResponse(normalize(response, request));
				}
			});
		};
		try {
			handler(request, deliver);
		}
		catch (e) {
			deliver({ requestID: request.requestID, referenceKey: request.referenceKey || '', status: 'error' });
		}
		return () => {
			if (!active) return;
			active = false;
			if (!hostSettled && typeof onCancel === 'function') {
				onCancel.call(this, { requestID: request.requestID });
			}
		};
	}

	startAction({ referenceKey, resultID, action }, onResponse) {
		let request = {
			requestID: createRequestID(),
			referenceKey,
			resultID,
			action,
		};
		// Actions, especially save, continue in the host after popup teardown.
		let ignore = this._startRequest((request, respond) => this._onPerformReferenceAction(request, respond),
			request, onResponse, normalizeReferenceActionResponse);
		return { requestID: request.requestID, ignore };
	}
}
