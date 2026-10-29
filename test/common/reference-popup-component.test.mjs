/* global globalThis */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { transformSync } from '@babel/core';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { ReferencePopupBridge } from '../../src/common/reference-popup/bridge.mjs';

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.endsWith('.svg')) return nextResolve('data:text/javascript,export default () => null;', context);
		try {
			return nextResolve(specifier, context);
		}
		catch (error) {
			if (!specifier.startsWith('.')) throw error;
			return nextResolve(specifier + '.js', context);
		}
	},
	load(url, context, nextLoad) {
		if (url.startsWith(new URL('../../src/', import.meta.url).href) && url.endsWith('.js')) {
			return { format: 'module', shortCircuit: true, source: transformSync(readFileSync(new URL(url), 'utf8'), {
				babelrc: false, configFile: false, presets: ['@babel/preset-react'],
			}).code };
		}
		return nextLoad(url, context);
	},
});

const dom = new JSDOM('<!doctype html><body><button id="outside">Outside</button><div id="root"></div></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const localization = { getString: id => id };
const { createRoot } = await import('react-dom/client');
const { default: ReferencePopup } = await import('../../src/common/components/view-popup/overlay-popup/reference/reference-popup.js');

function candidate(id, changes = {}) {
	return {
		resultID: id, libraryState: 'unsaved', actions: ['add-to-library'],
		display: { itemType: 'journalArticle', title: `Title ${id}`, firstCreator: 'Author', year: '2026' },
		...changes,
	};
}

async function mount(t, {
	persistent = true, count = 1, bridge, referenceChars, onOpenLink = () => {},
	rootElement = document.getElementById('root'), owner = 'primary',
} = {}) {
	let calls = { local: [], online: [], action: [], cancel: [] };
	let capture = kind => (request, callback) => calls[kind].push({ request, callback });
	bridge ||= new ReferencePopupBridge({
		onMatchReference: capture('local'),
		onFindReferenceOnline: capture('online'),
		onPerformReferenceAction: capture('action'),
		onCancelReferenceLookup: capture('cancel'),
	});
	let references = Array.from({ length: count }, (_, index) => ({
		sourceKey: `source-${index}`, text: `Raw reference ${index}`,
		chars: referenceChars || [{ c: `Raw reference ${index}` }],
	}));
	let params = { references, persistent, rect: [10, 10, 20, 20] };
	let previewedReferences = new Set();
	let open = true;
	let closed = 0;
	let root = createRoot(rootElement);
	let render = () => root.render(React.createElement(LocalizationProvider, { l10n: localization },
		open && React.createElement(ReferencePopup, {
			params, referencePopupBridge: bridge, referencePopupOwner: owner, previewedReferences, onOpenLink,
			onPreviewReference: (reference) => {
				previewedReferences = new Set([...previewedReferences, reference.sourceKey]);
				render();
			},
			onClose: () => closed++,
			onSetPersistent: (value) => {
				params = { ...params, persistent: value };
				render();
			},
		})));
	await act(async () => render());
	t.after(() => act(() => root.unmount()));
	return {
		bridge, calls,
		get closed() {
			return closed;
		},
		async setReferences(value) {
			params = { ...params, references: value };
			await act(async () => render());
		},
		async setOpen(value) {
			open = value;
			await act(async () => render());
		},
		async respond(kind, index, response) {
			let { request, callback } = calls[kind][index];
			await act(async () => callback({ requestID: request.requestID, referenceKey: request.referenceKey || 'token', ...response }));
		},
	};
}

function button(label) {
	return [...document.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label);
}

async function click(node) {
	assert.ok(node, 'expected rendered control');
	await act(async () => {
		node.focus();
		node.click();
	});
}

test('a restored online result can be added to the library and picks up its attachment', async (t) => {
	let app = await mount(t);
	assert.ok(document.querySelector('.reference-popup').classList.contains('stable-attachment'));
	assert.equal(app.calls.local[0].request.sourceKey, 'primary:source-0');
	assert.deepEqual(app.calls.local[0].request.referenceParts, [{ text: 'Raw reference 0' }]);
	await app.respond('local', 0, { status: 'strong', lookupSource: 'online', result: candidate('A', { actions: ['add-to-library', 'view-online'] }) });
	assert.equal(document.querySelector('.metadata .title').textContent, 'Title A');
	assert.equal(document.querySelector('.author-year').textContent, 'Author (2026)');
	await click(button('reader-reference-action-add-to-library'));
	assert.equal(button('view-online').disabled, true, 'actions are blocked while saving');
	let { request } = app.calls.action[0];
	assert.deepEqual([request.referenceKey, request.resultID, request.action], ['token', 'A', 'add-to-library']);
	let saved = candidate('A', { libraryState: 'existing', actions: ['show-in-library'] });
	await app.respond('action', 0, { status: 'saved', result: saved });
	assert.equal(document.querySelector('.reference-lookup-announcer').textContent, 'reader-reference-existing');
	let withAttachment = { ...saved, actions: ['show-in-library', 'open-attachment'] };
	await act(async () => app.bridge.updateReferenceResult({ referenceKey: 'other', result: withAttachment }));
	assert.ok(!button('reader-reference-action-open-attachment'), 'an unrelated update must not expose Open Attachment');
	await act(async () => app.bridge.updateReferenceResult({ referenceKey: 'token', result: withAttachment }));
	await click(button('reader-reference-action-open-attachment'));
	assert.equal(app.calls.action[1].request.action, 'open-attachment');
});

test('no local match offers Find Online, and a failed online lookup retries online', async (t) => {
	let app = await mount(t);
	await app.respond('local', 0, { status: 'no-match' });
	assert.equal(app.calls.online.length, 0, 'online lookup must be explicit');
	await click(button('reader-reference-find-online'));
	assert.equal(app.calls.online[0].request.referenceKey, 'token');
	await app.respond('online', 0, { status: 'error' });
	await click(button('reader-reference-retry'));
	assert.equal(app.calls.online.length, 2);
	assert.equal(app.calls.local.length, 1);
	await app.respond('online', 1, { status: 'strong', result: candidate('B') });
	assert.equal(document.querySelector('.metadata .title').textContent, 'Title B');
	await app.setOpen(false);
	await app.setOpen(true);
	await app.respond('local', 1, { status: 'strong', lookupSource: 'online',
		result: candidate('cached-B', { libraryState: 'existing', actions: ['show-in-library'] }) });
	assert.equal(document.querySelector('.metadata .title').textContent, 'Title cached-B');
	assert.ok(button('general-show-in-library'));
	assert.ok(!button('reader-reference-action-add-to-library'), 'a saved result must not offer Add to Library');
	assert.ok(!button('reader-reference-find-online'), 'a restored result must not require Find Online');
	assert.equal(app.calls.online.length, 2, 'restoration does not repeat the online search');
});

test('an incomplete lookup offers explicit online recovery without claiming no match', async (t) => {
	let app = await mount(t);
	await app.respond('local', 0, { status: 'incomplete' });
	assert.ok(button('reader-reference-find-online'));
	assert.ok(!button('reader-reference-retry'), 'an incomplete local lookup offers Find Online, not Retry');
	assert.ok(!document.body.textContent.includes('reader-reference-no-match'));
	assert.equal(app.calls.online.length, 0);
	await click(button('reader-reference-find-online'));
	await app.respond('online', 0, { status: 'incomplete' });
	await click(button('reader-reference-retry'));
	assert.equal(app.calls.online.length, 2);
	assert.equal(app.calls.local.length, 1);
});

test('a stale action refreshes locally and never replays the action', async (t) => {
	let app = await mount(t);
	await app.respond('local', 0, { status: 'strong', result: candidate('A') });
	await click(button('reader-reference-action-add-to-library'));
	await app.respond('action', 0, { status: 'stale' });
	assert.ok(!button('reader-reference-action-add-to-library'), 'a stale result must not offer Add to Library');
	await click(button('reader-reference-retry'));
	await app.respond('local', 1, { status: 'strong', referenceKey: 'fresh', result: candidate('fresh-A') });
	assert.equal(app.calls.action.length, 1);
	await click(button('reader-reference-action-add-to-library'));
	assert.equal(app.calls.action[1].request.referenceKey, 'fresh');
});

test('selecting from a citation group pins the popup and Back restores the list', async (t) => {
	let app = await mount(t, { persistent: false, count: 2 });
	let row = index => document.querySelector(`.reference-row[data-source-key="source-${index}"]`);
	await act(async () => row(1).focus());
	await act(async () => row(1).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
	assert.ok(document.activeElement === document.querySelector('.reference-preview .header'), 'selection focuses the preview header');
	await click(button('general-back'));
	assert.ok(document.activeElement === row(1), 'Back restores focus to the selected citation');
	assert.ok(row(1).classList.contains('previewed'));
	assert.equal(row(0).classList.contains('previewed'), false);
	assert.equal(app.calls.local.length, 2, 'selection does not repeat lookups');
	await click(row(1));
	assert.equal(document.querySelectorAll('.reference-row').length, 0, 'close from the selected citation, not the list');
	await act(() => document.getElementById('outside').dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
	assert.equal(app.closed, 1, 'a pinned popup closes on outside click');
	await app.setOpen(false);
	await app.setOpen(true);
	await app.respond('local', 3, { status: 'strong', lookupSource: 'online', result: candidate('cached-B') });
	assert.equal(document.querySelectorAll('.reference-row').length, 2, 'a group reopens as a list');
	await click(row(1));
	assert.equal(document.querySelector('.metadata .title').textContent, 'Title cached-B');
	assert.equal(app.calls.online.length, 0);
});

test('two views isolate identical citation keys, cancellation and late results', async (t) => {
	let requests = [], cancelled = [];
	let bridge = new ReferencePopupBridge({
		onMatchReference: (request, callback) => requests.push({ request, callback }),
		onCancelReferenceLookup: request => cancelled.push(request.requestID),
	});
	let secondary = document.createElement('div');
	document.body.append(secondary);
	t.after(() => secondary.remove());
	let first = await mount(t, { bridge });
	await mount(t, { bridge, rootElement: secondary, owner: 'secondary' });
	assert.deepEqual(requests.map(call => call.request.sourceKey), ['primary:source-0', 'secondary:source-0']);
	await first.setOpen(false);
	await first.setOpen(true);
	assert.deepEqual(cancelled, [requests[0].request.requestID]);
	for (let index of [2, 1, 0]) {
		await act(async () => requests[index].callback({ requestID: requests[index].request.requestID,
			referenceKey: `token-${index}`, status: 'strong', result: candidate(`view-${index}`) }));
	}
	assert.equal(document.getElementById('root').querySelector('.metadata .title').textContent, 'Title view-2');
	assert.equal(secondary.querySelector('.metadata .title').textContent, 'Title view-1');
});

test('replacing or closing the popup cancels lookups, but not actions', async (t) => {
	let app = await mount(t, { count: 2 });
	await app.setReferences([{ sourceKey: 'source-0', text: 'Replacement', chars: [{ c: 'Replacement' }] }]);
	assert.deepEqual(app.calls.cancel.map(call => call.request.requestID), app.calls.local.slice(0, 2).map(call => call.request.requestID));
	await app.respond('local', 0, { status: 'strong', result: candidate('stale') });
	assert.ok(!document.querySelector('.metadata'), 'a cancelled lookup must not show stale metadata');
	await app.respond('local', 2, { status: 'strong', result: candidate('A') });
	await click(button('reader-reference-action-add-to-library'));
	await app.setOpen(false);
	await app.setOpen(true);
	await app.respond('action', 0, { status: 'saved', result: candidate('A', { libraryState: 'existing' }) });
	assert.equal(app.calls.cancel.length, 2);
	assert.ok(!document.querySelector('.metadata'), 'a late save does not reach the reopened popup');
});

test('Escape closes, but outside clicks leave an unpinned popup to the view', async (t) => {
	let app = await mount(t, { persistent: false });
	await act(() => document.getElementById('outside').dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
	assert.equal(app.closed, 0);
	let escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	await act(() => document.querySelector('.reference-popup .inner').dispatchEvent(escape));
	assert.equal(escape.defaultPrevented, true);
	assert.equal(app.closed, 1);
});

test('without a host matcher the popup shows linked references and never looks up', async (t) => {
	let url = 'https://example.org/reference';
	let opened = [];
	let app = await mount(t, {
		bridge: new ReferencePopupBridge(), referenceChars: [{ c: 'Reference', url }], onOpenLink: value => opened.push(value),
	});
	await click(document.querySelector('.reference-popup.legacy a'));
	assert.deepEqual(opened, [url]);
	assert.equal(app.calls.local.length, 0);
});
