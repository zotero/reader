/**
 * Owns the lifecycle decision for one PDF find session. SDT readiness is
 * deliberately separate from the active session: changing it can only affect
 * the next search signature.
 */
export class PDFSearchSession {
	constructor() {
		this._eligibleSDT = null;
		this._current = null;
		this._generation = 0;
	}

	get current() {
		return this._current;
	}

	setEligibleSDT(sdt) {
		this._eligibleSDT = sdt;
	}

	fallbackToPDF(session) {
		if (!this.isCurrent(session) || session.backend !== 'sdt') {
			return null;
		}
		let fallback = {
			generation: ++this._generation,
			signature: session.signature,
			backend: 'pdf',
			sdt: null,
		};
		this._current = fallback;
		return fallback;
	}

	transition(state) {
		if (!state.active || !state.query) {
			if (this._current) {
				this._current = null;
				return { type: 'close' };
			}
			return { type: 'update', session: null };
		}

		let signature = getSignature(state);
		if (!this._current || signature !== this._current.signature) {
			let session = {
				generation: ++this._generation,
				signature,
				backend: this._eligibleSDT ? 'sdt' : 'pdf',
				sdt: this._eligibleSDT,
			};
			this._current = session;
			return { type: 'start', session };
		}
		return { type: 'update', session: this._current };
	}

	isCurrent(session) {
		return !!session && this._current === session;
	}

	destroy() {
		this._current = null;
		this._eligibleSDT = null;
	}
}

function getSignature(state) {
	return JSON.stringify([
		state.query,
		!!state.caseSensitive,
		!!state.entireWord,
	]);
}
