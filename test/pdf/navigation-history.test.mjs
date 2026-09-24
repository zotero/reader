/* global globalThis */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

globalThis.window ??= {};
registerHooks({
	resolve(specifier, context, nextResolve) {
		let stubs = {
			'common/view': 'export default {};',
			'common/sdt/position-mapper': 'export let getBlockNodeByRef = () => null;',
			'common/read-aloud/jump-button': 'export class ReadAloudJumpButton {};',
			'dom/common/lib/selector': 'export let isSelector = () => false;',
		};
		let stub = specifier.startsWith('!!raw-loader!')
			? 'export default "";'
			: Object.entries(stubs).find(([suffix]) => specifier.endsWith(suffix))?.[1];
		if (stub) return nextResolve('data:text/javascript,' + encodeURIComponent(stub), context);
		for (let suffix of ['', '.js', '.mjs', '.ts']) {
			try {
				return nextResolve(specifier + suffix, context);
			}
			catch {}
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.endsWith('/history.ts')) {
			return { format: 'module', shortCircuit: true, source: ts.transpileModule(
				readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }
			).outputText };
		}
		return nextLoad(url, context);
	},
});
const { default: PDFView } = await import('../../src/pdf/pdf-view.js');
const { History } = await import('../../src/common/lib/history.ts');
const pdfSource = ts.createSourceFile('pdf-view.js',
	readFileSync(new URL('../../src/pdf/pdf-view.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const viewAreaUpdate = pdfSource.statements.find(ts.isClassDeclaration).members
	.find(x => x.name?.getText(pdfSource) === '_handleViewAreaUpdate').initializer.getText(pdfSource);

function fixture(t, synchronous = false) {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
	let view = Object.create(PDFView.prototype);
	view._options = { platform: 'zotero' };
	view._handleViewAreaUpdate = compileFunction(`return ${viewAreaUpdate}`).call(view);
	view._onChangeViewState = view._updateViewStats = () => {};
	let container = new EventTarget();
	let viewer = {
		_location: { pageNumber: 9, left: 12, top: 345 },
		update() {
			if (this._location) view._handleViewAreaUpdate({ location: this._location });
		},
		scrollPageIntoView({ pageNumber }) {
			this._location = { pageNumber, left: 0, top: 0 };
			if (synchronous) this.update();
			container.dispatchEvent(new Event('scroll'));
		},
	};
	view._iframeWindow = { document: { getElementById: () => container },
		PDFViewerApplication: { pdfViewer: viewer } };
	view._onManualNavigation = () => {};
	view._iframeWindow.PDFViewerApplication.pdfLinkService = {
		goToDestination({ 0: pageIndex, 2: left, 3: top }) {
			viewer._location = { pageNumber: pageIndex + 1, left, top };
			container.dispatchEvent(new Event('scroll'));
		},
	};
	view._history = new History({ onUpdate() {}, onNavigate(location) {
		view.navigate(location, { skipHistory: true });
	} });
	view._history.save(view._getHistoryLocation(), true);
	let source = view._getHistoryLocation();
	return { view, viewer, source, async settle() {
		await Promise.resolve();
		t.mock.timers.tick(101);
		await Promise.resolve();
	} };
}

function androidFixture(t, synchronous = false) {
	let result = fixture(t);
	let { view, viewer } = result;
	view._options.platform = 'android';
	let container = view._iframeWindow.document.getElementById('viewerContainer');
	Object.assign(container, { scrollLeft: 8 * 2010 + 12, scrollTop: 345, clientWidth: 400, clientHeight: 600 });
	let pages = Array.from({ length: 31 }, (_, i) => ({
		id: i + 1,
		pdfPage: {},
		div: { offsetLeft: i * 2010, offsetTop: 0, clientLeft: 0, clientTop: 0, clientWidth: 2000, clientHeight: 2400 },
		getPagePoint: (x, y) => [x, y],
		setPdfPage(pdfPage) {
			this.pdfPage = pdfPage;
		},
	}));
	Object.assign(viewer, {
		container,
		scrollMode: 1,
		currentPageNumber: 9,
		getPageView: index => pages[index],
		update() {
			let page = pages[this.currentPageNumber - 1];
			this._location = { pageNumber: page.id,
				left: Math.round(container.scrollLeft - page.div.offsetLeft), top: Math.round(container.scrollTop) };
			view._handleViewAreaUpdate({ location: this._location });
		},
		scrollPageIntoView({ pageNumber }) {
			this.currentPageNumber = pageNumber;
			container.scrollLeft = pages[pageNumber - 1].div.offsetLeft;
			container.scrollTop = 0;
			if (synchronous) this.update();
			container.dispatchEvent(new Event('scroll'));
		},
	});
	view._iframeWindow.PDFViewerApplication.pdfLinkService.goToDestination = ({ 0: index, 2: left, 3: top }) => {
		viewer.scrollPageIntoView({ pageNumber: index + 1 });
		container.scrollLeft += left;
		container.scrollTop = top;
	};
	return result;
}

test('Android scrubber history waits for its final page, not a superseded load', async (t) => {
	let { view, viewer, source, settle } = androidFixture(t);
	let oldLoad = Promise.withResolvers(), finalLoad = Promise.withResolvers();
	viewer.getPageView(20).pdfPage = viewer.getPageView(30).pdfPage = null;
	viewer.pdfDocument = { getPage: id => (id === 21 ? oldLoad.promise : finalLoad.promise) };
	view.beginNavigation();
	let oldNavigation = view.navigate({ pageIndex: 20 });
	let finalNavigation = view.navigate({ pageIndex: 30 });
	let end = view.endNavigation();
	await settle();
	assert.equal(view._history.canNavigateBack, false);
	finalLoad.resolve({});
	await finalNavigation;
	await settle();
	assert.equal(view._history.canNavigateBack, true);
	await end;
	view.navigateBack();
	assert.deepEqual(view._getHistoryLocation(), source);
	oldLoad.resolve({});
	await oldNavigation;
	await settle();
	assert.equal(view._history.canNavigateForward, true);
	view.navigateForward();
	assert.equal(view._getHistoryLocation().dest[0], 30);
});

test('Android same-page jumps preserve history unless the position changes', async (t) => {
	let { view, viewer, source, settle } = androidFixture(t);
	let destination = { dest: [20, { name: 'XYZ' }, 12, 345, null] };
	view._history.saveNavigation(source, destination);
	view.navigateBack();
	t.mock.timers.tick(2100);
	// Fractional scroll positions have the same rounded PDF history coordinates.
	let top = viewer.container.scrollTop + 0.2;
	Object.defineProperty(viewer.container, 'scrollTop', {
		get: () => top,
		set: (value) => {
			top = Math.round(value);
		},
	});
	view._pageLabels = Array.from({ length: 31 }, (_, i) => String(i + 1));
	for (let location of [{ pageIndex: 8 }, { pageNumber: '9' }]) {
		await view.navigate(location);
		await settle();
		assert.deepEqual(view._history._backStack, []);
		assert.deepEqual(view._history._forwardStack, [destination]);
	}
	viewer.getPageView(8).div.clientHeight = 500;
	await view.navigate({ pageIndex: 8 });
	await settle();
	assert.equal(viewer.container.scrollTop, 0);
	assert.equal(view._history.canNavigateBack, true);
	assert.equal(view._history.canNavigateForward, false);
});

for (let location of [{ pageIndex: 30 }, { pageNumber: '31' }]) {
	test(`manual scrolling during an Android ${Object.keys(location)[0]} page load remains a return point`, async (t) => {
		let { view, viewer, source, settle } = androidFixture(t, true);
		let load = Promise.withResolvers();
		viewer.getPageView(30).pdfPage = null;
		viewer.pdfDocument = { getPage: () => load.promise };
		view._pageLabels = Array.from({ length: 31 }, (_, i) => String(i + 1));
		view.beginNavigation();
		await view.navigate({ pageIndex: 20 });
		view.endNavigation();
		let navigation = view.navigate(location);
		await settle();
		viewer.container.scrollTop += 200;
		let readingPosition = view._getHistoryLocation();
		t.mock.timers.tick(2100);
		load.resolve({});
		await navigation;
		await settle();
		assert.deepEqual(view._history._backStack, [source, readingPosition]);
		assert.equal(view._history._currentLocation.dest[0], 30);
		view.navigateBack();
		assert.deepEqual(view._getHistoryLocation(), readingPosition);
	});
}

test('live navigation records only source and final destination, including exact offsets', async (t) => {
	let { view, viewer, settle } = fixture(t);
	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	assert.equal(viewer._location.pageNumber, 21);
	await settle(); // Pausing while holding must not save a preview.
	assert.equal(view._history.canNavigateBack, false);
	view.beginNavigation(); // Repeated boundaries must not replace the source.
	await view.navigate({ pageIndex: 30 });
	view.endNavigation();
	view.endNavigation();
	await settle();
	view.navigateBack();
	assert.deepEqual(viewer._location, { pageNumber: 9, left: 12, top: 345 });
	assert.equal(view._history.canNavigateBack, false);
	view.navigateForward();
	assert.equal(viewer._location.pageNumber, 31);
});

test('overlapping jumps and drags preserve each gesture boundary', async (t) => {
	let { view, settle } = fixture(t);
	await view.navigate({ pageIndex: 15 });
	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	await settle();
	assert.ok(view._navigationGroup);
	assert.equal(view._history._currentLocation.dest[0], 15);
	// Start the next drag before the first one's save settles.
	view.endNavigation();
	view.beginNavigation();
	await view.navigate({ pageIndex: 30 });
	await settle();
	assert.ok(view._navigationGroup);
	assert.equal(view._history._currentLocation.dest[0], 20);
	view.endNavigation();
	// An ordinary jump must finish the released drag before moving.
	await view.navigate({ pageIndex: 40 });
	assert.equal(view._navigationGroup, null);
	assert.equal(view._history._currentLocation.dest[0], 30);
	await settle();
	assert.deepEqual(view._history._backStack.map(x => x.dest[0]), [8, 15, 20]);
	assert.equal(view._history._currentLocation.dest[0], 40);
});

test('after Back, an unchanged gesture preserves forward history and a changed one clears it', async (t) => {
	let { view, viewer, source, settle } = fixture(t);
	view._history.saveNavigation(source, { dest: [40, { name: 'XYZ' }, 0, 0, null] });
	view.navigateBack();
	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	viewer._location = { pageNumber: 9, left: 12, top: 345 };
	view.endNavigation();
	await settle();
	assert.equal(view._history.canNavigateBack, false);
	assert.equal(view._history.canNavigateForward, true);

	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	view.endNavigation();
	await settle();
	assert.equal(view._history.canNavigateForward, false);
	view.navigateBack();
	assert.deepEqual(view._history._currentLocation, source);
	view.navigateForward();
	assert.equal(view._history._currentLocation.dest[0], 20);
});

test('immediate Back saves fresh viewport coordinates and ignores the pending completion', async (t) => {
	let { view, viewer, settle } = fixture(t);
	let viewport = { pageNumber: 10, left: 23, top: 456 };
	viewer.update = () => {
		viewer._location = { ...viewport };
	};
	view.beginNavigation();
	let source = { dest: [9, { name: 'XYZ' }, 23, 456, null] };
	assert.deepEqual(view._navigationGroup.from, source);
	viewport = { pageNumber: 21, left: 4, top: 567 };
	view.endNavigation();
	view.navigateBack(); // End and Back in the same frame.
	await settle();
	assert.deepEqual(view._history._currentLocation, source);
	view.navigateForward();
	assert.deepEqual(viewer._location, { pageNumber: 21, left: 4, top: 567 });
});

test('ordinary navigation retains time-based grouping and waits for the latest save', async (t) => {
	let { view, settle } = fixture(t);
	await view.navigate({ pageIndex: 20 });
	await settle();
	await view.navigate({ pageIndex: 30 });
	await settle();
	assert.deepEqual(view._history._backStack.map(x => x.dest[0]), [8]);
	assert.equal(view._history._currentLocation.dest[0], 30);
	view._pushHistoryPoint();
	t.mock.timers.tick(50);
	view._pushHistoryPoint();
	t.mock.timers.tick(51);
	await Promise.resolve();
	assert.ok(view._pendingHistorySave);
	await settle();
	assert.equal(view._pendingHistorySave, null);
});

test('a jump after scrub release suppresses synchronous viewport updates until its save', async (t) => {
	let { view, viewer, source, settle } = fixture(t, true);
	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	view.endNavigation();
	await view.navigate({ pageIndex: 30 });
	await settle();
	assert.deepEqual(view._history._backStack, [source]);
	view.navigateBack();
	assert.deepEqual(view._history._currentLocation, source);
	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	view.endNavigation();
	viewer.scrollPageIntoView = () => {
		throw new Error('navigation failed');
	};
	await assert.rejects(view.navigate({ pageIndex: 30 }), /navigation failed/);
	assert.equal(view._pendingHistorySave, null);
});

test('an unavailable viewport does not leave history saving disabled', async (t) => {
	let { view, viewer, settle } = fixture(t);
	viewer._location = null;
	let save = assert.doesNotReject(view._pushHistoryPoint());
	await settle();
	await save;
	assert.equal(view._pendingHistorySave, null);
	view.beginNavigation();
	assert.equal(view._navigationGroup, null);
	viewer._location = { pageNumber: 9, left: 12, top: 345 };
	view.beginNavigation();
	await view.navigate({ pageIndex: 20 });
	view.endNavigation();
	await settle();
	assert.equal(view._history.canNavigateBack, true);
	viewer.update = () => {
		throw new Error('capture failed');
	};
	assert.throws(() => view.beginNavigation(), /capture failed/);
	assert.equal(view._navigationGroup, null);
	save = assert.rejects(view._pushHistoryPoint(), /capture failed/);
	await settle();
	await save;
	assert.equal(view._pendingHistorySave, null);
});

for (let kind of ['dest', 'pageLabel']) {
	test(`a group waits for a delayed ${kind} before saving its destination`, async (t) => {
		let { view, viewer, source, settle } = fixture(t);
		let resolve;
		let ready = new Promise(r => resolve = r);
		view._pageLabels = ['first', 'target'];
		view._pageLabelsPromise = ready;
		view._iframeWindow.PDFViewerApplication.pdfLinkService.goToDestination = async () => {
			await ready;
			viewer.scrollPageIntoView({ pageNumber: 2 });
		};
		view.beginNavigation();
		let navigation = view.navigate({ [kind]: 'target' });
		let end = view.endNavigation();
		await settle();
		assert.ok(view._navigationGroup);
		assert.deepEqual(view._history._currentLocation, source);
		resolve();
		await navigation;
		await settle();
		await end;
		assert.deepEqual(view._history._backStack, [source]);
		assert.equal(view._history._currentLocation.dest[0], 1);
	});
}

test('a failed old navigation cannot finish a newer gesture', async (t) => {
	let { view, settle } = fixture(t);
	let reject;
	view._iframeWindow.PDFViewerApplication.pdfLinkService.goToDestination
		= () => new Promise((resolve, r) => reject = r);
	view.beginNavigation();
	let navigation = assert.rejects(view.navigate({ dest: 'missing' }), /missing/);
	let end = view.endNavigation();
	view.beginNavigation();
	let group = view._navigationGroup;
	reject(new Error('missing'));
	await navigation;
	await end;
	await settle();
	assert.equal(view._navigationGroup, group);
	await view.navigate({ pageIndex: 20 });
	view.endNavigation();
	await settle();
	assert.equal(view._navigationGroup, null);
	assert.deepEqual(view._history._backStack.map(x => x.dest[0]), [8]);
});

for (let kind of ['pageLabel', 'pageNumber']) {
	test(`manual scrolling while ${kind} loads remains a return point`, async (t) => {
		let { view, viewer, settle } = fixture(t);
		let resolve;
		view._pageLabelsPromise = new Promise(r => resolve = r);
		view._pageLabels = Array(31).fill('');
		view._pageLabels[30] = 'target';
		view.beginNavigation();
		await view.navigate({ pageIndex: 20 });
		view.endNavigation();
		let navigation = view.navigate({ [kind]: kind === 'pageLabel' ? 'target' : '31' });
		await settle();
		viewer.scrollPageIntoView({ pageNumber: 26 });
		viewer.update();
		t.mock.timers.tick(2100);
		resolve();
		await navigation;
		await settle();
		assert.deepEqual(view._history._backStack.map(x => x.dest[0]), [8, 25]);
		assert.equal(view._history._currentLocation.dest[0], 30);
	});
}
