import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// src/common/lib/utilities.js sniffs the browser at module load
globalThis.window ??= {};

registerHooks({
	resolve(specifier, context, nextResolve) {
		// The DOM selector helpers are TypeScript that plain node can't load
		if (specifier.endsWith('dom/common/lib/selector')) {
			return nextResolve('data:text/javascript,export let isSelector = () => false;', context);
		}
		try {
			return nextResolve(specifier, context);
		}
		catch {
			// Extensionless internal imports are resolved by webpack in the app
			return nextResolve(specifier + '.js', context);
		}
	},
});
const { default: AnnotationManager } = await import('../../src/common/annotation-manager.js');
// Well past DEBOUNCE_MAX_TIME (10s), so the first save is never itself debounced
const START_TIME = 1_000_000;

function setup(options = {}) {
	let savedBatches = [];
	let manager = new AnnotationManager({
		annotations: [],
		onSave: annotations => savedBatches.push(annotations.map(x => x.id)),
		onDelete: () => {},
		onRender: () => {},
		onChangeFilter: () => {},
		...options,
	});
	return { manager, savedBatches };
}

function newAnnotation() {
	// The only properties addAnnotation() requires
	return { color: '#ffd400', sortIndex: '00000|000000|00000' };
}

// _triggerSaving() suspends at `await this._onSave(...)` with _savingInProgress
// still set; let its continuation run, as it would before the next user action
function drain() {
	return new Promise(resolve => setImmediate(resolve));
}

test('saveNewAnnotationsImmediately: every creation saves synchronously, even in quick succession', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setup({ saveNewAnnotationsImmediately: true });

	let first = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[first.id]]);
	await drain();

	// Still within both debounce windows of the previous save
	let second = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[first.id], [second.id]]);
});

test('without saveNewAnnotationsImmediately (desktop), rapid consecutive creations are debounced', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START_TIME });
	let { manager, savedBatches } = setup();

	let first = manager.addAnnotation(newAnnotation());
	assert.deepEqual(savedBatches, [[first.id]]);
	await drain();

	let second = manager.addAnnotation(newAnnotation());
	assert.equal(savedBatches.length, 1);

	t.mock.timers.tick(1000);
	assert.deepEqual(savedBatches, [[first.id], [second.id]]);
});
