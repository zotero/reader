import assert from 'node:assert/strict';
import test from 'node:test';
import { appendInkSamples, ensureInkDot, InkFrame, matchesInkPointer } from '../../src/pdf/ink-input.mjs';
import { smoothPath } from '../../src/pdf/lib/path.js';

let toPoint = event => [event.clientX, event.clientY];

test('preserves coalesced samples and the dispatched endpoint in order', () => {
	let path = [0, 0];
	appendInkSamples(path, {
		clientX: 3, clientY: 4,
		getCoalescedEvents: () => [
			{ clientX: 1, clientY: 2 },
			{ clientX: 2, clientY: 3 },
		],
	}, toPoint);
	assert.deepEqual(path, [0, 0, 1, 2, 2, 3, 3, 4]);
});

test('works with mouse input and empty coalesced event lists', () => {
	for (let event of [
		{ clientX: 1, clientY: 2 },
		{ clientX: 1, clientY: 2, getCoalescedEvents: () => [] },
	]) {
		let path = [0, 0];
		appendInkSamples(path, event, toPoint);
		assert.deepEqual(path, [0, 0, 1, 2]);
	}
});

test('does not duplicate endpoints or append invalid coordinates', () => {
	let path = [0, 0];
	appendInkSamples(path, {
		clientX: 2, clientY: 3,
		getCoalescedEvents: () => [
			{ clientX: NaN, clientY: 1 },
			{ clientX: 0, clientY: 0 },
			{ clientX: 2, clientY: 3 },
		],
	}, toPoint);
	assert.deepEqual(path, [0, 0, 2, 3]);
});

test('keeps a fast down/up stroke even when no move event was dispatched', () => {
	let path = [1, 1];
	appendInkSamples(path, { type: 'pointerup', clientX: 1.1, clientY: 1.2 }, toPoint);
	assert.deepEqual(path, [1, 1, 1.1, 1.2]);
});

test('represents a pen tap as a drawable zero-length segment', () => {
	assert.deepEqual(ensureInkDot([1, 2]), [1, 2, 1, 2]);
	assert.deepEqual(ensureInkDot([1, 2, 3, 4]), [1, 2, 3, 4]);
});

test('a second pointer cannot end or contaminate an active pen stroke', () => {
	assert.equal(matchesInkPointer({ pointerId: 7 }, { pointerId: 7 }), true);
	assert.equal(matchesInkPointer({ pointerId: 7 }, { pointerId: 8 }), false);
	assert.equal(matchesInkPointer({ pointerId: 7 }, {}), false);
	assert.equal(matchesInkPointer({}, { pointerId: 1 }), true);
});

test('smoothing preserves the endpoint of a sub-point stroke', () => {
	let path = smoothPath([10, 20, 10.1, 20.2]);
	assert.deepEqual(path.slice(0, 2), [10, 20]);
	assert.deepEqual(path.slice(-2), [10.1, 20.2]);
	assert.ok(path.length >= 4);
});

test('smoothing preserves the endpoint of a normal stroke', () => {
	assert.deepEqual(smoothPath([0, 0, 10, 0, 10.1, 0.1]).slice(-2), [10.1, 0.1]);
});

test('collects all samples while painting at most once per frame', () => {
	let callbacks = new Map();
	let paints = [];
	let nextId = 0;
	let frame = new InkFrame((callback) => {
		callbacks.set(++nextId, callback);
		return nextId;
	}, id => callbacks.delete(id), pages => paints.push(pages));
	let path = [0, 0];
	for (let i = 1; i <= 100; i++) {
		appendInkSamples(path, { clientX: i, clientY: i }, toPoint);
		frame.schedule(2);
	}
	assert.equal(callbacks.size, 1);
	assert.equal(path.length, 202);
	callbacks.get(1)();
	assert.deepEqual(paints, [[2]]);
	frame.schedule(3);
	assert.equal(nextId, 2);
	frame.cancel();
	assert.equal(callbacks.has(2), false);
});
