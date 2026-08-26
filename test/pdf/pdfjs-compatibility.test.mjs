import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../pdfjs/compatibility.js', import.meta.url), 'utf8');
const buildSource = readFileSync(new URL('../../pdfjs/build', import.meta.url), 'utf8');

function createContext() {
	let ContextURL = class extends URL {};
	let context = vm.createContext({ URL: ContextURL });
	vm.runInContext(`
		URL.parse = undefined;
		Promise.try = undefined;
		Math.sumPrecise = undefined;
		Uint8Array.prototype.toHex = undefined;
	`, context);
	vm.runInContext(source, context);
	return context;
}

test('mobile PDF.js compatibility methods match the APIs used by the current viewer', async () => {
	let context = createContext();
	assert.equal(vm.runInContext(`URL.parse('https://example.com/a').href`, context), 'https://example.com/a');
	assert.equal(vm.runInContext(`URL.parse('not a URL')`, context), null);
	assert.equal(await vm.runInContext(`Promise.try((a, b) => a + b, 2, 3)`, context), 5);
	await assert.rejects(vm.runInContext(`Promise.try(() => { throw new Error('failure'); })`, context), /failure/);
	assert.equal(vm.runInContext(`Math.sumPrecise([0.1, 0.2, 0.3])`, context), 0.6000000000000001);
	assert.equal(vm.runInContext(`new Uint8Array([0, 15, 16, 255]).toHex()`, context), '000f10ff');
});

test('mobile PDF.js compatibility does not replace WebView implementations that already exist', () => {
	let ContextURL = class extends URL {};
	let context = vm.createContext({ URL: ContextURL });
	vm.runInContext(`
		URL.parse = () => 'native-url';
		Promise.try = () => 'native-promise';
		Math.sumPrecise = () => 'native-math';
		Uint8Array.prototype.toHex = () => 'native-hex';
	`, context);
	vm.runInContext(source, context);
	assert.equal(vm.runInContext(`URL.parse()`, context), 'native-url');
	assert.equal(vm.runInContext(`Promise.try()`, context), 'native-promise');
	assert.equal(vm.runInContext(`Math.sumPrecise()`, context), 'native-math');
	assert.equal(vm.runInContext(`new Uint8Array().toHex()`, context), 'native-hex');
});

test('mobile PDF.js builds prepend compatibility code to every executable viewer bundle', () => {
	let functionStart = buildSource.indexOf('add_generic_compatibility()');
	let mobileBuildStart = buildSource.indexOf('if [[ $PDFJS_CONFIG = "mobile"');
	assert.notEqual(functionStart, -1);
	assert.notEqual(mobileBuildStart, -1);
	let compatibilityFunction = buildSource.slice(functionStart, mobileBuildStart);
	for (let output of [
		'$BUILD_DIR/build/pdf.mjs',
		'$BUILD_DIR/build/pdf.worker.mjs',
		'$BUILD_DIR/web/viewer.mjs',
	]) {
		assert.equal(compatibilityFunction.includes(output), true, output);
	}
	let mobileBuild = buildSource.slice(mobileBuildStart);
	assert.match(mobileBuild, /add_generic_compatibility/);
});
