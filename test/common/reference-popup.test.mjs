import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_REFERENCE_PARTS, MAX_REFERENCE_PART_TEXT_LENGTH, ReferencePopupBridge,
	normalizeReferenceLookupResponse, normalizeReferenceActionResponse } from '../../src/common/reference-popup/bridge.mjs';
import { createReferenceParts } from '../../src/common/components/view-popup/overlay-popup/reference/reference-popup-state.mjs';

function nextTask() {
	return new Promise(resolve => setImmediate(resolve));
}

test('malformed successful responses cannot become a match or a saved item', () => {
	let request = { requestID: 'request', referenceKey: 'reference' };
	assert.equal(normalizeReferenceLookupResponse({ ...request, status: 'strong' }, request).status, 'invalid');
	assert.equal(normalizeReferenceLookupResponse({ ...request, requestID: 'stale', status: 'no-match' }, request).status, 'invalid');
	assert.equal(normalizeReferenceActionResponse({ ...request, status: 'saved' }, request).status, 'failed');
});

test('local lookup sends only reference text and keeps only the public result fields', async () => {
	let request;
	let bridge = new ReferencePopupBridge({
		onMatchReference(value, callback) {
			request = value;
			callback({
				requestID: value.requestID, sourceKey: 'replaced', referenceKey: 'reference', status: 'strong',
				result: {
					resultID: 'result', libraryState: 'unsaved', itemID: 123,
					display: { itemType: 'journalArticle', title: 'Title', firstCreator: 42, year: '2026', url: 'https://example.org' },
					actions: ['view-online', 'add-to-library', 'view-online', 'unknown'],
				},
			});
		},
	});
	let response = await new Promise(resolve => bridge.startLocalLookup({
		sourceKey: 'primary:1',
		referenceParts: [{ text: 'Article ' }, { text: 'DOI', attributes: { url: 'https://doi.org/example' } }],
	}, resolve));
	assert.deepEqual(request, { requestID: request.requestID, sourceKey: 'primary:1', referenceParts: [{ text: 'Article ' }, { text: 'DOI' }] });
	assert.deepEqual(response, {
		requestID: request.requestID, referenceKey: 'reference', status: 'strong',
		result: {
			resultID: 'result', libraryState: 'unsaved', actions: ['view-online', 'add-to-library'],
			display: { itemType: 'journalArticle', title: 'Title', firstCreator: null, year: '2026' },
		},
	});
});

test('an over-limit reference is rejected without reaching the host', async () => {
	let bridge = new ReferencePopupBridge({ onMatchReference: () => assert.fail('must not match a clipped reference') });
	for (let referenceParts of [
		Array.from({ length: MAX_REFERENCE_PARTS + 1 }, () => ({ text: 'x' })),
		[{ text: 'x'.repeat(MAX_REFERENCE_PART_TEXT_LENGTH + 1) }],
	]) {
		let response = await new Promise(resolve => bridge.startLocalLookup({ sourceKey: 'ref', referenceParts }, resolve));
		assert.equal(response.status, 'invalid');
	}
});

test('cancelling a pending lookup notifies the host once and drops the late response', async () => {
	let hostCallback;
	let cancelled = [];
	let delivered = [];
	let bridge = new ReferencePopupBridge({
		onMatchReference: (request, callback) => hostCallback = callback,
		onCancelReferenceLookup: request => cancelled.push(request),
	});
	let handle = bridge.startLocalLookup({ sourceKey: 'ref', referenceParts: [{ text: 'Reference' }] }, response => delivered.push(response));
	handle.cancel();
	handle.cancel();
	assert.deepEqual(cancelled, [{ requestID: handle.requestID }]);
	hostCallback({ requestID: handle.requestID, referenceKey: 'late', status: 'no-match' });
	await nextTask();
	assert.deepEqual(delivered, []);
});

test('missing or throwing host callbacks settle asynchronously as failures', async () => {
	for (let handler of [undefined, () => {
		throw new Error('host failure');
	}]) {
		let bridge = new ReferencePopupBridge({ onMatchReference: handler, onPerformReferenceAction: handler });
		let lookup, action;
		bridge.startLocalLookup({ sourceKey: 'ref', referenceParts: [{ text: 'Citation' }] }, response => lookup = response);
		bridge.startAction({ referenceKey: 'ref', resultID: 'item', action: 'add-to-library' }, response => action = response);
		assert.equal(lookup, undefined);
		await nextTask();
		assert.equal(lookup.status, 'error');
		assert.equal(action.status, 'failed');
	}
});

test('reference parts keep linked runs and rejoin only a fully linked wrapped URL', () => {
	let url = 'https://doi.org/10.1016/j.cell.2019.01.001';
	assert.deepEqual(createReferenceParts({ chars: [
		{ c: 'A', bold: true }, { c: 'B', spaceAfter: true }, { c: 'X', ignorable: true },
		{ c: 'https://doi.org/10.1016/j.cell.2019.', lineBreakAfter: true, url }, { c: '01.001', url },
	] }), [{ text: 'AB ' }, { text: url, attributes: { url } }]);
	let unlinked = 'https://doi.org/10.1016/j.cell.2019. 01.001';
	assert.equal(createReferenceParts({ chars: [{ c: unlinked }] })[0].text, unlinked);
	assert.deepEqual(createReferenceParts({ text: 'Fallback', chars: [] }), [{ text: 'Fallback' }]);
});
