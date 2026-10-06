// Experimental pressure support using the existing fixed-width ink format.
// The output consists entirely of ordinary ink positions, so older readers,
// synchronization and PDF export do not need a new annotation schema.
const PRESSURE_LEVELS = 8;

export function getInkPressure(event, previous = 0.5) {
	if (event.pointerType !== 'pen' || !Number.isFinite(event.pressure)) {
		return previous;
	}
	// Pointerup reports zero pressure even when the final down sample was heavy.
	if (event.type === 'pointerup' && event.pressure === 0) {
		return previous;
	}
	return Math.max(0, Math.min(1, event.pressure));
}

function smoothSamples(samples) {
	for (let iteration = 0; iteration < 2; iteration++) {
		let next = [samples[0]];
		for (let i = 1; i < samples.length; i++) {
			let a = samples[i - 1];
			let b = samples[i];
			next.push(a.map((value, j) => 0.75 * value + 0.25 * b[j]));
			next.push(a.map((value, j) => 0.25 * value + 0.75 * b[j]));
		}
		next.push(samples[samples.length - 1]);
		samples = next;
	}
	return samples;
}

export class PressureInk {
	constructor(point, event) {
		this.samples = [[...point, getInkPressure(event)]];
	}

	add(point, event) {
		if (!point.every(Number.isFinite)) return;
		let last = this.samples[this.samples.length - 1];
		let pressure = getInkPressure(event, last[2]);
		if (point[0] === last[0] && point[1] === last[1]) {
			// Retain the peak pressure of a stationary tap on pointer release.
			last[2] = Math.max(last[2], pressure);
		}
		else {
			this.samples.push([...point, pressure]);
		}
	}

	getPositions(pageIndex, size, smoothing = false) {
		let samples = smoothing && this.samples.length > 1
			? smoothSamples(this.samples)
			: this.samples;
		let groups = new Map();
		let previousLevel;
		let addSegment = (a, b, pressure) => {
			let level = Math.max(1, Math.round((0.2 + 0.8 * pressure) * PRESSURE_LEVELS));
			let group = groups.get(level);
			if (!group) {
				group = { pageIndex, width: size * level / PRESSURE_LEVELS, paths: [] };
				groups.set(level, group);
			}
			if (level === previousLevel) {
				group.paths[group.paths.length - 1].push(...b);
			}
			else {
				group.paths.push([...a, ...b]);
			}
			previousLevel = level;
		};
		if (samples.length === 1) {
			let [x, y, pressure] = samples[0];
			addSegment([x, y], [x, y], pressure);
		}
		for (let i = 1; i < samples.length; i++) {
			let a = samples[i - 1];
			let b = samples[i];
			// Subdivide rapid pressure changes rather than assigning a whole
			// long segment a single averaged width.
			let steps = Math.max(1, Math.ceil(Math.abs(a[2] - b[2]) * PRESSURE_LEVELS));
			let previous = a.slice(0, 2);
			for (let step = 1; step <= steps; step++) {
				let t = step / steps;
				let point = a.slice(0, 2).map((value, j) => value + (b[j] - value) * t);
				let pressure = a[2] + (b[2] - a[2]) * (step - 0.5) / steps;
				addSegment(previous, point, pressure);
				previous = point;
			}
		}
		return [...groups.values()];
	}
}
