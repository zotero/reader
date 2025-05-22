export function mode<T>(iter: Iterable<T>): T | undefined {
	let maxCount = 0;
	let maxValue: T | undefined;
	let map = new Map<T, number>();
	for (let value of iter) {
		let count = map.get(value) ?? 0;
		map.set(value, ++count);
		if (count > maxCount) {
			maxCount = count;
			maxValue = value;
		}
	}
	return maxValue;
}

export function* enumerate<T>(iter: Iterable<T>): Iterable<[number, T]> {
	let i = 0;
	for (let value of iter) {
		yield [i++, value];
	}
}
