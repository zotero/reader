/* global globalThis */

import assert from 'node:assert/strict';
import test from 'node:test';
import queue from 'queue';

import { getThumbnailDimensions, PDFThumbnails } from '../../src/pdf/pdf-thumbnails.js';

const dimensions = ({ width, height }) => [width, height];

function createCanvas() {
	return {
		width: 0,
		height: 0,
		getContext: () => ({ drawImage() {} }),
		toDataURL: () => 'data:image/png;base64,thumbnail',
	};
}

function createThumbnails() {
	let viewportCalls = [];
	let renderContexts = [];
	let rendered = [];
	let pdfPage = {
		rotate: 90,
		getViewport({ scale }) {
			viewportCalls.push({ scale });
			let rotated = pdfPage.rotate % 180 !== 0;
			return {
				width: (rotated ? 800 : 600) * scale,
				height: (rotated ? 600 : 800) * scale,
			};
		},
		render(context) {
			renderContexts.push(context);
			return { promise: Promise.resolve() };
		},
	};
	let thumbnails = Object.create(PDFThumbnails.prototype);
	Object.assign(thumbnails, {
		_pdfView: { renderPageAnnotationsOnCanvas: async () => {} },
		_onRender: thumbnail => rendered.push(thumbnail),
		_onUpdate() {},
		_generation: 0,
		_requested: new Map(),
		_inFlight: new Map(),
		_renderQueue: queue({ concurrency: 1, autostart: true }),
		_renderOptions: [],
		_thumbnails: [{ pageIndex: 0, width: 120, height: 160 }],
		_window: {
			document: { createElement: () => createCanvas() },
			PDFViewerApplication: {
				eventBus: { dispatch() {} },
				pdfDocument: { getPage: async () => pdfPage },
			},
		},
	});
	return { pdfPage, renderContexts, rendered, thumbnails, viewportCalls };
}

test('thumbnail dimensions preserve aspect ratio within optional bounds', () => {
	let cases = [
		[{ width: 600, height: 800 }, undefined, [120, 160]],
		[{ width: 600, height: 800 }, { maxHeight: 64 }, [48, 64]],
		[{ width: 800, height: 600 }, { maxWidth: 80, maxHeight: 64 }, [80, 60]],
	];
	for (let [viewport, options, expected] of cases) {
		assert.deepEqual(dimensions(getThumbnailDimensions(viewport, options)), expected);
	}
});

test('PDF thumbnails fit intrinsically rotated pages into the requested bounds', async () => {
	globalThis.window = { devicePixelRatio: 1 };
	let { renderContexts, rendered, thumbnails, viewportCalls } = createThumbnails();

	await thumbnails._render(0, { maxWidth: 80, maxHeight: 64 });

	assert.deepEqual(viewportCalls, [
		{ scale: 1 },
		{ scale: 0.2 },
	]);
	assert.equal(renderContexts.length, 1);
	assert.deepEqual(dimensions(rendered[0]), [80, 60]);
});

test('PDF thumbnails reuse only matching dimensions', async () => {
	globalThis.window = { devicePixelRatio: 1 };
	let { pdfPage, renderContexts, rendered, thumbnails } = createThumbnails();

	await thumbnails._render(0, { maxWidth: 80, maxHeight: 64 });
	await thumbnails._render(0, { maxWidth: 80, maxHeight: 64 });
	assert.equal(renderContexts.length, 1);
	assert.equal(rendered.length, 2);

	await thumbnails._render(0, { maxHeight: 32 });
	assert.equal(renderContexts.length, 2);
	assert.deepEqual(dimensions(rendered.at(-1)), [42, 32]);

	pdfPage.rotate = 0;
	await thumbnails._render(0, { maxHeight: 32 });
	assert.equal(renderContexts.length, 3);
});

test('annotation rerenders preserve the requested thumbnail bounds', async () => {
	globalThis.window = { devicePixelRatio: 1 };
	let { renderContexts, rendered, thumbnails } = createThumbnails();
	let options = { maxWidth: 80, maxHeight: 64 };
	await thumbnails._render(0, options);

	let tasks = [];
	thumbnails._renderQueue = {
		end() {},
		unshift: task => tasks.push(task),
	};
	thumbnails.rerender([0]);
	await tasks[0]();

	assert.equal(renderContexts.length, 2);
	assert.deepEqual(dimensions(rendered.at(-1)), [80, 60]);
});

test('thumbnails requested before a clear are rendered again and the stale render is discarded', async () => {
	globalThis.window = { devicePixelRatio: 1 };
	let { pdfPage, rendered, thumbnails } = createThumbnails();
	let release;
	let gate = new Promise((resolve) => {
		release = resolve;
	});
	thumbnails._window.PDFViewerApplication.pdfDocument.getPage = async () => {
		await gate;
		return pdfPage;
	};

	thumbnails.render([0], { maxWidth: 80, maxHeight: 64 });
	thumbnails.clear();
	release();
	await new Promise(resolve => setTimeout(resolve, 20));

	assert.equal(rendered.length, 1);
	assert.equal(rendered[0].pageIndex, 0);
	assert.equal(thumbnails._inFlight.size, 0);
});

test('requesting thumbnails keeps the requests that have not started yet', () => {
	let { thumbnails } = createThumbnails();
	let jobs = [];
	thumbnails._renderQueue = {
		end() {
			jobs.length = 0;
		},
		unshift: job => jobs.unshift(job),
	};

	thumbnails.render([0]);
	thumbnails.render([1]);

	assert.equal(jobs.length, 2);
	assert.deepEqual(Array.from(thumbnails._requested.keys()), [0, 1]);
});
