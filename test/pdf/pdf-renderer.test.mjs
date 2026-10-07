/* global globalThis */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';

// Webpack resolves the renderer's extensionless imports in the app.
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
			specifier += '.js';
		}
		return nextResolve(specifier, context);
	},
});
const { default: PDFRenderer } = await import('../../src/pdf/pdf-renderer.js');
hooks.deregister();

const originalWindow = globalThis.window;
after(() => {
	globalThis.window = originalWindow;
});

function fixture(dpr = 1) {
	globalThis.window = { devicePixelRatio: dpr };
	let dots = [];
	let ctx = {
		beginPath() {},
		arc: (x, y, radius) => dots.push([x, y, radius]),
		fill() {},
	};
	let canvas = {
		width: 0,
		height: 0,
		style: {},
		getContext: () => ctx,
		toDataURL: () => 'data:image/png;base64,preview',
	};
	let page = {
		getViewport({ scale }) {
			return {
				width: 120 * scale,
				height: 160 * scale,
				convertToViewportPoint: (x, y) => [x * scale, (160 - y) * scale],
			};
		},
		render: () => ({ promise: Promise.resolve() }),
	};
	let renderer = new PDFRenderer({
		pdfView: {
			_iframeWindow: {
				document: { createElement: () => canvas },
				PDFViewerApplication: {
					pdfDocument: { getPage: async () => page },
					pdfViewer: { _currentScale: 1, maxCanvasPixels: 1000000 },
				},
			},
		},
	});
	// Simulate trimming content bounds [20, 30, 100, 140] with 15px padding.
	renderer._trimCanvas = (canvas) => {
		let rect = [20 * dpr - 15, 30 * dpr - 15, 100 * dpr + 15, 140 * dpr + 15];
		canvas.width = rect[2] - rect[0];
		canvas.height = rect[3] - rect[1];
		return { canvas, rect };
	};
	return { renderer, dots };
}

test('preview dots follow the cropped target at normal and Retina resolution', async () => {
	for (let [dpr, expected] of [[1, [55, 45]], [2, [95, 75]]]) {
		let { renderer, dots } = fixture(dpr);
		let preview = await renderer.renderPreviewPage({ pageIndex: 0, rects: [[60, 100, 60, 100]] });
		assert.deepEqual(dots, [[...expected, 7]]);
		assert.deepEqual([preview.x, preview.y], expected.map(value => value / dpr));
	}
});

test('preview dots stay fully inside every edge of the cropped image', async () => {
	for (let [point, expected] of [
		[[10, 140], [7, 7]],
		[[115, 5], [103, 133]],
	]) {
		let { renderer, dots } = fixture();
		await renderer.renderPreviewPage({ pageIndex: 0, rects: [[...point, ...point]] });
		assert.deepEqual(dots, [[...expected, 7]], `Destination ${point}`);
	}
});
