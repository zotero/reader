// PDF.js generic builds target browsers newer than some supported Android WebViews.
(() => {
function defineMethod(object, name, method) {
	if (typeof object[name] !== 'function') {
		Object.defineProperty(object, name, {
			configurable: true,
			writable: true,
			value: method
		});
	}
}

defineMethod(URL, 'parse', function parseURL(url, base) {
	try {
		return new URL(url, base);
	}
	catch (e) {
		return null;
	}
});

defineMethod(Promise, 'try', function promiseTry(callback, ...args) {
	return new this(resolve => resolve(callback(...args)));
});

defineMethod(Math, 'sumPrecise', function sumPrecise(numbers) {
	return numbers.reduce((sum, value) => sum + value, 0);
});

defineMethod(Uint8Array.prototype, 'toHex', function toHex() {
	let result = '';
	for (let value of this) {
		result += value.toString(16).padStart(2, '0');
	}
	return result;
});
})();
