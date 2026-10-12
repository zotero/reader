/* global globalThis */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { getStableAttachment } from '../../src/common/components/view-popup/common/stable-attachment.mjs';

registerHooks({
	load(url, context, next) {
		if (url.endsWith('/view-popup.js')) return { format: 'module', shortCircuit: true,
			source: transformSync(readFileSync(new URL(url), 'utf8'), { babelrc: false, configFile: false, presets: ['@babel/preset-react'] }).code };
		return next(url, context);
	},
});
let dom = new JSDOM('<!doctype html><div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let { createRoot } = await import('react-dom/client');
let { default: ViewPopup } = await import('../../src/common/components/view-popup/common/view-popup.js');

const constraints = { width: 400, height: 300, viewport: [900, 620], padding: 10 };
const anchors = {
	bottom: [434, 30, 466, 46], top: [434, 574, 466, 590],
	right: [30, 302, 62, 318], left: [838, 302, 870, 318],
};

test('stable placement keeps the pointer attached on all four sides as content grows', () => {
	for (let [side, rect] of Object.entries(anchors)) {
		let plan = getStableAttachment({ ...constraints, rect });
		assert.equal(plan.side, side);
		let pointer;
		for (let height of [40, 300]) {
			let actualHeight = Math.max(plan.style.minHeight || 0, Math.min(height, plan.style.maxHeight));
			let top = plan.style.top ?? 620 - plan.style.bottom - actualHeight;
			let tip = side === 'top' ? top + actualHeight : side === 'bottom' ? top
				: top + (plan.style.top !== undefined ? 20 : actualHeight - 20);
			assert.equal(tip, pointer ?? tip);
			pointer = tip;
			assert.ok(top >= 10 && top + actualHeight <= 610);
		}
	}
});

test('stable placement stays usable at pane edges, including narrow panes', () => {
	for (let viewport of [[900, 620], [320, 320]]) {
		for (let [x, y] of [[0, 0], viewport]) {
			let { style } = getStableAttachment({ ...constraints, viewport, rect: [x - 16, y - 8, x + 16, y + 8] });
			assert.ok(style.maxHeight > 0);
			assert.ok(style.left >= 10 && style.left + style.width <= viewport[0] - 10);
			assert.ok((style.top ?? style.bottom) >= 10);
		}
	}
});

async function mount(t, props) {
	let rootElement = document.getElementById('root');
	let viewport = [900, 620], size = [400, 100];
	t.mock.method(rootElement, 'getBoundingClientRect', () => ({ width: viewport[0], height: viewport[1] }));
	t.mock.getter(window.HTMLElement.prototype, 'offsetWidth', () => size[0]);
	t.mock.getter(window.HTMLElement.prototype, 'offsetHeight', () => size[1]);
	let root = createRoot(rootElement);
	let render = async (next = {}) => {
		props = { ...props, ...next };
		await act(async () => root.render(React.createElement(ViewPopup, { padding: 10, ...props }, 'Content')));
	};
	await render();
	t.after(() => act(() => root.unmount()));
	return { render, size, viewport, node: () => rootElement.firstChild };
}

test('mounted stable placement ignores content size, responds to pane resize and cleans up', async (t) => {
	let observer;
	globalThis.ResizeObserver = class {
		constructor(callback) { this.callback = callback; observer = this; }
		observe(target) { this.target = target; }
		disconnect() { this.disconnected = true; }
	};
	t.after(() => delete globalThis.ResizeObserver);
	let app = await mount(t, { stableAttachment: { width: 400, height: 300 }, rect: anchors.right });
	let initial = app.node().style.cssText;
	assert.equal(observer.target, document.getElementById('root'));
	app.size[1] = 300;
	await app.render({ uniqueRef: 'larger-content' });
	assert.equal(app.node().style.cssText, initial);
	app.viewport[1] = 500;
	await act(async () => observer.callback());
	assert.notEqual(app.node().style.cssText, initial);
	t.after(() => assert.equal(observer.disconnected, true));
});

test('legacy placement still measures delayed content without opting into stable placement', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let renders = 0;
	let app = await mount(t, { rect: [400, 300, 420, 312], onRender: () => renders++ });
	assert.equal(app.node().style.transform, 'translate(210px, 322px)');
	assert.equal(app.node().classList.contains('stable-attachment'), false);
	app.size[1] = 300;
	await act(async () => t.mock.timers.tick(0));
	assert.equal(app.node().style.transform, 'translate(430px, 156px)');
	assert.ok(renders >= 2, 'legacy render callbacks still follow measurement');
});
