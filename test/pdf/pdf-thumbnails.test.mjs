/* global globalThis */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { getThumbnailDimensions, PDFThumbnails } from '../../src/pdf/pdf-thumbnails.js';

globalThis.window = { devicePixelRatio: 1 };

const dimensions = ({ width, height }) => [width, height];

function createCanvas() {
	return {
		getContext: () => ({ drawImage() {} }),
		toDataURL: () => 'data:image/png;base64,thumbnail',
	};
}

async function createThumbnails() {
	let renderContexts = [];
	let rendered = [];
	let pageRequests = [];
	let pdfPage = {
		rotate: 90,
		getViewport({ scale, rotation = pdfPage.rotate }) {
			let rotated = rotation % 180 !== 0;
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
	let initialized = Promise.withResolvers();
	let thumbnails = new PDFThumbnails({
		pdfView: { renderPageAnnotationsOnCanvas: async () => {} },
		onInit: initialized.resolve,
		onRender: thumbnail => rendered.push(thumbnail),
		onUpdate() {},
		window: {
			document: { createElement: createCanvas },
			PDFViewerApplication: {
				eventBus: { dispatch() {} },
				pdfDocument: {
					numPages: 4,
					getPage: async (pageNumber) => {
						pageRequests.push(pageNumber);
						return pdfPage;
					},
				},
			},
		},
	});
	await initialized.promise;
	pageRequests.length = 0;
	return { pdfPage, renderContexts, rendered, thumbnails, pageRequests };
}

function holdNextRender(pdfPage) {
	let gate = Promise.withResolvers();
	let started = Promise.withResolvers();
	let render = pdfPage.render;
	pdfPage.render = (context) => {
		pdfPage.render = render;
		let task = render(context);
		started.resolve();
		return { promise: gate.promise.then(() => task.promise) };
	};
	return { started: started.promise, release: gate.resolve };
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

test('PDF thumbnails respect page rotation and cache dimensions', async () => {
	let { pdfPage, renderContexts, rendered, thumbnails } = await createThumbnails();

	await thumbnails._render(0, { maxWidth: 80, maxHeight: 64 });
	await thumbnails._render(0, { maxWidth: 80, maxHeight: 64 });
	assert.equal(renderContexts.length, 1);
	assert.equal(rendered.length, 2);
	assert.deepEqual(dimensions(rendered[0]), [80, 60]);
	assert.deepEqual(dimensions(renderContexts[0].viewport), [160, 120]);

	await thumbnails._render(0, { maxHeight: 32 });
	assert.equal(renderContexts.length, 2);
	assert.deepEqual(dimensions(rendered.at(-1)), [42, 32]);

	pdfPage.rotate = 0;
	await thumbnails._render(0, { maxHeight: 32 });
	assert.equal(renderContexts.length, 3);
});

test('annotation rerenders preserve the requested thumbnail bounds', async () => {
	let { renderContexts, rendered, thumbnails } = await createThumbnails();
	let options = { maxWidth: 80, maxHeight: 64 };
	let renderedFirst = once(thumbnails._renderQueue, 'end');
	thumbnails.render([0], options);
	await renderedFirst;

	let idle = once(thumbnails._renderQueue, 'end');
	thumbnails.rerender([0]);
	await idle;

	assert.equal(renderContexts.length, 2);
	assert.deepEqual(dimensions(rendered.at(-1)), [80, 60]);
});

test('host requests survive clears and use the latest bounds without overlapping renders', async () => {
	let { pdfPage, renderContexts, rendered, thumbnails } = await createThumbnails();
	let { started, release } = holdNextRender(pdfPage);
	let idle = once(thumbnails._renderQueue, 'end');
	thumbnails.render([0], { maxWidth: 80, maxHeight: 64 });
	await started;
	thumbnails.render([1], { maxWidth: 80 });
	thumbnails.render([1], { maxWidth: 160 });
	thumbnails.render([0], { maxWidth: 40 });
	thumbnails.clear();
	release();
	await idle;

	assert.deepEqual(rendered.map(x => x.pageIndex), [0, 0, 1, 1]);
	assert.equal(renderContexts.length, 3);
	assert.deepEqual(rendered.map(dimensions), [[40, 30], [40, 30], [160, 120], [160, 120]]);
});

test('desktop starts the latest viewport without waiting for an off-screen render', async () => {
	let { pdfPage, pageRequests, thumbnails } = await createThumbnails();
	thumbnails._onRender = undefined;
	let update = Promise.withResolvers();
	thumbnails._onUpdate = () => update.resolve();
	let { started, release } = holdNextRender(pdfPage);
	thumbnails.render([0, 1, 2]);
	await started;
	thumbnails.render([3]);
	assert.deepEqual(pageRequests, [1, 4]);
	await update.promise;
	assert.ok(thumbnails._thumbnails[3].image);
	update = Promise.withResolvers();
	release();
	await update.promise;
});

test('desktop clear drops waiting jobs and does not retry obsolete renders', async (t) => {
	let { pdfPage, pageRequests, thumbnails } = await createThumbnails();
	await thumbnails._render(0);
	thumbnails._onRender = undefined;
	let updates = 0;
	thumbnails._onUpdate = () => updates++;
	// clear() detaches the active job; await that job, not the queue's 'end' event.
	let render = t.mock.method(thumbnails, '_render');
	let { started, release } = holdNextRender(pdfPage);
	thumbnails.rerender([0]);
	await started;
	thumbnails.render([1, 2]);
	thumbnails.clear();
	release();
	await render.mock.calls[0].result;

	assert.deepEqual(pageRequests, [1, 1]);
	assert.equal(thumbnails._renderQueue.length, 0);
	assert.equal(updates, 1);
	assert.equal(thumbnails._thumbnails.some(x => x.image), false);
	assert.equal(thumbnails._thumbnails.some(x => x.forceRerender), false);

	thumbnails.render([1]);
	await render.mock.calls[1].result;
	assert.ok(thumbnails._thumbnails[1].image);
});

test('a failed page does not strand other native thumbnail requests', async (t) => {
	let { rendered, thumbnails } = await createThumbnails();
	let pdfDocument = thumbnails._window.PDFViewerApplication.pdfDocument;
	t.mock.method(pdfDocument, 'getPage', async () => {
		throw new Error('Cannot load PDF page');
	}, { times: 1 });
	t.mock.method(console, 'error', () => {});
	let idle = new Promise(resolve => thumbnails._renderQueue.once('end', resolve));
	thumbnails.render([0]);
	thumbnails.render([1]);
	await idle;
	assert.deepEqual(rendered.map(x => x.pageIndex), [1]);
});
