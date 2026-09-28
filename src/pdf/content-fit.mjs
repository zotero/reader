// Detects the inked area of rendered PDF pages, so the view can zoom to the
// paper body instead of the full page. Outer bands that are thin and separated
// from the rest of the page are treated as marginalia and ignored, e.g. the
// rotated arXiv identifier, line numbers, running headers and page numbers.

// A pixel counts as ink when any channel is darker than this
const INK_THRESHOLD = 235;
// Rows and columns with fewer ink pixels are treated as empty (scan noise)
const MIN_INK_PIXELS = 2;
// Ink runs closer than this (fraction of page size) belong to the same band
const X_MERGE_GAP = 0.01;
const Y_MERGE_GAP = 0.012;
// Side bands narrower than this and at least this far from the rest are marginalia
const MARGINALIA_MAX_WIDTH = 0.06;
const MARGINALIA_MIN_GAP = 0.02;
// Top/bottom bands shorter than this and at least this far from the rest are headers/footers
const HEADER_FOOTER_MAX_HEIGHT = 0.03;
const HEADER_FOOTER_MIN_GAP = 0.02;
// Bottom bands wider than this are footnotes rather than page numbers, and are kept
const FOOTER_MAX_WIDTH = 0.25;
const MAX_TRIMMED_BANDS_PER_SIDE = 2;
// With at least this many sampled pages, one outlier per edge is ignored
const OUTLIER_MIN_SAMPLES = 5;

function isInk(data, index) {
	return data[index] < INK_THRESHOLD
		|| data[index + 1] < INK_THRESHOLD
		|| data[index + 2] < INK_THRESHOLD;
}

// Group profile indexes with ink into bands; `end` is exclusive
function getBands(profile, mergeGap) {
	let bands = [];
	let current = null;
	for (let i = 0; i < profile.length; i++) {
		if (profile[i] < MIN_INK_PIXELS) {
			continue;
		}
		if (current && i - current.end <= mergeGap) {
			current.end = i + 1;
		}
		else {
			current = { start: i, end: i + 1 };
			bands.push(current);
		}
	}
	return bands;
}

function trimOuterBands(bands, size, maxBandSize, minGap, { canTrimStart = () => true, canTrimEnd = () => true } = {}) {
	let first = 0;
	let last = bands.length - 1;
	let isTrimmable = (band, neighbor) => band.end - band.start < maxBandSize * size
		&& Math.max(neighbor.start - band.end, band.start - neighbor.end) >= minGap * size;
	for (let i = 0; i < MAX_TRIMMED_BANDS_PER_SIDE && first < last; i++) {
		if (!isTrimmable(bands[first], bands[first + 1]) || !canTrimStart(bands[first])) {
			break;
		}
		first++;
	}
	for (let i = 0; i < MAX_TRIMMED_BANDS_PER_SIDE && first < last; i++) {
		if (!isTrimmable(bands[last], bands[last - 1]) || !canTrimEnd(bands[last])) {
			break;
		}
		last--;
	}
	return bands.slice(first, last + 1);
}

/**
 * Get the body content bounds of a rendered page
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imageData RGBA pixels on white
 * @returns {number[] | null} [x0, y0, x1, y1] as fractions of the page size, or null for blank pages
 */
export function getInkBounds({ data, width, height }) {
	if (!(width > 0) || !(height > 0)) {
		return null;
	}

	let columns = new Uint32Array(width);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (isInk(data, (y * width + x) * 4)) {
				columns[x]++;
			}
		}
	}
	let xBands = trimOuterBands(
		getBands(columns, Math.max(1, Math.round(width * X_MERGE_GAP))),
		width,
		MARGINALIA_MAX_WIDTH,
		MARGINALIA_MIN_GAP
	);
	if (!xBands.length) {
		return null;
	}
	let x0 = xBands[0].start;
	let x1 = xBands[xBands.length - 1].end;

	// Build the row profile only between the kept columns, so side marginalia
	// can't extend the body vertically
	let rows = new Uint32Array(height);
	let rowMinX = new Int32Array(height).fill(width);
	let rowMaxX = new Int32Array(height).fill(-1);
	for (let y = 0; y < height; y++) {
		for (let x = x0; x < x1; x++) {
			if (isInk(data, (y * width + x) * 4)) {
				rows[y]++;
				rowMinX[y] = Math.min(rowMinX[y], x);
				rowMaxX[y] = Math.max(rowMaxX[y], x);
			}
		}
	}
	let getBandWidth = (band) => {
		let min = width;
		let max = -1;
		for (let y = band.start; y < band.end; y++) {
			if (rows[y] >= MIN_INK_PIXELS) {
				min = Math.min(min, rowMinX[y]);
				max = Math.max(max, rowMaxX[y]);
			}
		}
		return max - min + 1;
	};
	let yBands = trimOuterBands(
		getBands(rows, Math.max(1, Math.round(height * Y_MERGE_GAP))),
		height,
		HEADER_FOOTER_MAX_HEIGHT,
		HEADER_FOOTER_MIN_GAP,
		{ canTrimEnd: band => getBandWidth(band) < FOOTER_MAX_WIDTH * width }
	);
	if (!yBands.length) {
		return null;
	}
	let y0 = yBands[0].start;
	let y1 = yBands[yBands.length - 1].end;

	// Tighten the sides to the rows that were kept
	let minX = width;
	let maxX = -1;
	for (let y = y0; y < y1; y++) {
		if (rows[y] >= MIN_INK_PIXELS) {
			minX = Math.min(minX, rowMinX[y]);
			maxX = Math.max(maxX, rowMaxX[y]);
		}
	}
	if (maxX >= minX) {
		x0 = minX;
		x1 = maxX + 1;
	}

	return [x0 / width, y0 / height, x1 / width, y1 / height];
}

/**
 * Combine per-page bounds into bounds covering the body of every page,
 * ignoring one outlier per edge when there are enough samples
 */
export function combineBounds(boundsList) {
	let list = boundsList.filter(Boolean);
	if (!list.length) {
		return null;
	}
	let skip = list.length >= OUTLIER_MIN_SAMPLES ? 1 : 0;
	let pick = (index, descending) => {
		let values = list.map(bounds => bounds[index]).sort((a, b) => (descending ? b - a : a - b));
		return values[skip];
	};
	return [pick(0), pick(1), pick(2, true), pick(3, true)];
}

/**
 * Pick up to `maxSamples` page indexes spread evenly across the document
 */
export function getSamplePageIndexes(pagesCount, maxSamples) {
	if (!(pagesCount > 0) || !(maxSamples > 0)) {
		return [];
	}
	if (pagesCount <= maxSamples) {
		return [...Array(pagesCount).keys()];
	}
	let indexes = new Set();
	for (let i = 0; i < maxSamples; i++) {
		indexes.add(Math.round(i * (pagesCount - 1) / (maxSamples - 1)));
	}
	return [...indexes];
}

/**
 * Get the scale at which the content fills the viewport, keeping `margin`
 * (a fraction of the smaller viewport side) around it
 *
 * @param {Object} options
 * @param {number} options.scale Current scale
 * @param {number} options.pageWidth Page width in CSS pixels at the current scale
 * @param {number} options.pageHeight Page height in CSS pixels at the current scale
 * @param {number[]} options.bounds Content bounds as fractions of the page size
 * @param {boolean} options.fitHeight Also fit the content height, not just the width
 */
export function getContentFitScale({
	scale,
	pageWidth,
	pageHeight,
	bounds,
	viewportWidth,
	viewportHeight,
	margin = 0,
	fitHeight,
}) {
	let contentWidth = (bounds[2] - bounds[0]) * pageWidth;
	let contentHeight = (bounds[3] - bounds[1]) * pageHeight;
	if (!(scale > 0) || !(contentWidth > 0) || !(contentHeight > 0)
			|| !(viewportWidth > 0) || !(viewportHeight > 0)) {
		return null;
	}
	let marginPx = getContentFitMarginPx(margin, viewportWidth, viewportHeight);
	let targetScale = scale * Math.max(1, viewportWidth - marginPx * 2) / contentWidth;
	if (fitHeight) {
		targetScale = Math.min(
			targetScale,
			scale * Math.max(1, viewportHeight - marginPx * 2) / contentHeight
		);
	}
	return targetScale;
}

export function getContentFitMarginPx(margin, viewportWidth, viewportHeight) {
	return Math.max(0, margin || 0) * Math.min(viewportWidth, viewportHeight);
}

/**
 * Get the scroll offset within the page that centers the content along one axis,
 * constrained to the page
 */
export function getContentFitOffset(start, end, pageSize, viewportSize) {
	let offset = (start + end) / 2 * pageSize - viewportSize / 2;
	return Math.max(0, Math.min(offset, pageSize - viewportSize));
}
