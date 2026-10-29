function createEntry(reference) {
	return {
		reference,
		lookup: { status: 'idle' },
		expired: false,
		expanded: false,
		action: { status: 'idle' },
	};
}

export function createReferencePopupState(references) {
	let entries = {};
	for (let reference of references) entries[reference.sourceKey] ??= createEntry(reference);
	let sourceKeys = Object.keys(entries);
	return { selectedSourceKey: sourceKeys.length === 1 ? sourceKeys[0] : null, entries };
}

export function canStartReferenceLookup(entry, source, canFindOnline) {
	return !!entry && entry.lookup.status !== 'loading' && entry.action.status !== 'running'
		&& (source !== 'online' || canFindOnline);
}

export function canStartReferenceAction(entry, result, action) {
	return !entry.expired && entry.lookup.status === 'resolved'
		&& entry.action.status !== 'running' && result.actions.includes(action);
}

export function getReferencePopupPresentation(entry, canFindOnline) {
	let response = entry.lookup.response;
	let findOnline = !!canFindOnline && !entry.expired && !!response?.referenceKey
		&& entry.lookup.source === 'local' && ['no-match', 'incomplete'].includes(response.status);
	return {
		content: response?.result ? 'result' : !response ? 'loading' : 'message',
		findOnline,
		retry: entry.expired || !!response && (['offline', 'rate-limited', 'timeout', 'cancelled', 'error'].includes(response.status)
			|| response.status === 'incomplete' && !findOnline),
	};
}

function updateEntry(state, sourceKey, callback) {
	let entry = state.entries[sourceKey];
	if (!entry) return state;
	let nextEntry = callback(entry);
	return nextEntry === entry ? state : { ...state, entries: { ...state.entries, [sourceKey]: nextEntry } };
}

export function referencePopupReducer(state, action) {
	switch (action.type) {
		case 'reset':
			return createReferencePopupState(action.references);

		case 'select-reference':
			return action.sourceKey === null || state.entries[action.sourceKey]
				? { ...state, selectedSourceKey: action.sourceKey }
				: state;

		case 'set-expanded':
			return updateEntry(state, action.sourceKey, entry => ({ ...entry, expanded: action.expanded }));

		case 'lookup-started':
			return updateEntry(state, action.sourceKey, entry => ({
				...entry,
				lookup: { status: 'loading', source: action.source, requestID: action.requestID },
				expired: false,
				action: { status: 'idle' },
			}));

		case 'lookup-resolved':
			return updateEntry(state, action.sourceKey, (entry) => {
				if (entry.lookup.status !== 'loading' || entry.lookup.requestID !== action.response.requestID) return entry;
				return {
					...entry,
					lookup: {
						...entry.lookup,
						status: 'resolved',
						source: action.response.lookupSource || entry.lookup.source,
						response: action.response,
					},
					expanded: entry.lookup.source === 'online' && action.response.result ? false : entry.expanded,
					expired: action.response.status === 'expired',
				};
			});

		case 'result-updated': {
			let next = state;
			for (let [sourceKey, entry] of Object.entries(state.entries)) {
				let response = entry.lookup.response;
				if (entry.expired || entry.lookup.status !== 'resolved' || response.referenceKey !== action.referenceKey
						|| response.result?.resultID !== action.result.resultID || response.result.libraryState !== 'existing') continue;
				next = updateEntry(next, sourceKey, entry => ({
					...entry,
					lookup: { ...entry.lookup, response: { ...response, result: action.result } },
				}));
			}
			return next;
		}

		case 'action-started':
			return updateEntry(state, action.sourceKey, entry => ({
				...entry,
				action: { status: 'running', requestID: action.requestID, action: action.action, resultID: action.resultID },
			}));

		case 'action-resolved':
			return updateEntry(state, action.sourceKey, (entry) => {
				if (entry.action.status !== 'running' || entry.action.requestID !== action.response.requestID) return entry;
				let response = entry.lookup.response;
				return {
					...entry,
					lookup: action.response.result && response?.result?.resultID === entry.action.resultID
						? { ...entry.lookup, response: { ...response, result: action.response.result } }
						: entry.lookup,
					expired: entry.expired || action.response.status === 'stale',
					action: { ...entry.action, status: 'complete', response: action.response },
				};
			});

		default:
			return state;
	}
}

export function createReferenceParts(reference) {
	let parts = [];
	for (let char of reference.chars || []) {
		if (char.ignorable) continue;
		let url = char.url || null;
		let previous = parts.at(-1);
		if (!previous || (previous.attributes?.url || null) !== url) {
			previous = {
				text: '',
				...(url && { attributes: { url } }),
			};
			parts.push(previous);
		}
		previous.text += char.c || '';
		if ((char.spaceAfter || char.lineBreakAfter) && previous.text) {
			previous.text += ' ';
		}
	}
	parts = parts.filter(part => part.text);
	for (let part of parts) {
		let visible = part.text.trim();
		let unwrapped = visible.replace(/\s+/g, '');
		// Repair a wrapped visible URL only when every character agrees with its
		// link. Never supply missing identifier text from a hidden target.
		if (/^https?:\/\//i.test(unwrapped) && unwrapped === part.attributes?.url && unwrapped !== visible) {
			part.text = part.text.replace(visible, () => unwrapped);
		}
	}
	if (!parts.length && reference.text) {
		parts.push({ text: reference.text });
	}
	return parts;
}

export function getSelectedEntry(state) {
	return state.selectedSourceKey ? state.entries[state.selectedSourceKey] ?? null : null;
}
