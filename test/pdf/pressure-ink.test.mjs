import assert from 'node:assert/strict';
import test from 'node:test';
import { getInkPressure, PressureInk } from '../../src/pdf/pressure-ink.mjs';

let pen = pressure => ({ pointerType: 'pen', pressure, type: 'pointermove' });

test('clamps device pressure and retains pressure at pointerup', () => {
	assert.equal(getInkPressure(pen(2)), 1);
	assert.equal(getInkPressure(pen(-1)), 0);
	assert.equal(getInkPressure({ ...pen(0), type: 'pointerup' }, 0.8), 0.8);
	assert.equal(getInkPressure({ pointerType: 'mouse', pressure: 0.5 }, 0.7), 0.7);
});

test('pressure changes line width without extending the persisted schema', () => {
	let stroke = new PressureInk([0, 0], pen(0));
	stroke.add([10, 0], pen(1));
	let positions = stroke.getPositions(2, 4);
	assert.ok(positions.length > 1);
	assert.ok(positions.length <= 8);
	assert.ok(new Set(positions.map(position => position.width)).size > 1);
	for (let position of positions) {
		assert.deepEqual(Object.keys(position).sort(), ['pageIndex', 'paths', 'width']);
		assert.ok(position.paths.every(path => path.length >= 4 && path.length % 2 === 0));
		assert.ok(position.paths.flat().every(Number.isFinite));
		assert.ok(position.width > 0 && position.width <= 4);
	}
});

test('constant pressure stays in a single continuous annotation', () => {
	let stroke = new PressureInk([0, 0], pen(0.5));
	stroke.add([1, 2], pen(0.5));
	stroke.add([3, 4], pen(0.5));
	let positions = stroke.getPositions(0, 2);
	assert.equal(positions.length, 1);
	assert.deepEqual(positions[0].paths, [[0, 0, 1, 2, 3, 4]]);
});

test('a stationary pressure tap remains visible', () => {
	let stroke = new PressureInk([1, 2], pen(0.1));
	stroke.add([1, 2], pen(1));
	stroke.add([1, 2], { ...pen(0), type: 'pointerup' });
	assert.deepEqual(stroke.getPositions(0, 2), [{ pageIndex: 0, width: 2, paths: [[1, 2, 1, 2]] }]);
});

test('smoothing keeps pressure and coordinates aligned and preserves endpoints', () => {
	let stroke = new PressureInk([0, 0], pen(0.1));
	stroke.add([1, 5], pen(0.8));
	stroke.add([7, 9], pen(1));
	let positions = stroke.getPositions(0, 2, true);
	let points = positions.flatMap(position => position.paths);
	assert.ok(points.some(path => path[0] === 0 && path[1] === 0));
	assert.ok(points.some(path => path[path.length - 2] === 7 && path[path.length - 1] === 9));
	assert.ok(positions.every(position => position.width > 0 && position.width <= 2));
});

test('grouped pressure paths cover the complete input without gaps', () => {
	let stroke = new PressureInk([0, 0], pen(0));
	stroke.add([10, 0], pen(1));
	stroke.add([20, 0], pen(0));
	let intervals = stroke.getPositions(0, 2).flatMap(position => position.paths)
		.map(path => [path[0], path[path.length - 2]])
		.sort((a, b) => a[0] - b[0]);
	assert.equal(intervals[0][0], 0);
	assert.equal(intervals[intervals.length - 1][1], 20);
	for (let i = 1; i < intervals.length; i++) {
		assert.equal(intervals[i][0], intervals[i - 1][1]);
	}
});
