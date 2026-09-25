import { fitRectIntoRect } from './utilities';
import { getBlockNodeByRef } from '../../common/sdt/position-mapper';
import { PDF_READING_MODE_CROP_DISPLAY_SCALE } from '../../common/defines';

const CSS_UNITS = 96 / 72;

// CSS pixels per PDF point at which Reading Mode displays block crops
export const SDT_BLOCK_CROP_DISPLAY_SCALE = CSS_UNITS * PDF_READING_MODE_CROP_DISPLAY_SCALE;

// Describe an SDT block's page crops without loading PDF pages.
export function getSDTBlockCropGeometry(sdtData, blockRef) {
	let block = getBlockNodeByRef(sdtData.content, blockRef);
	let byPage = new Map();
	for (let rect of block?.anchor?.pageRects ?? []) {
		if (!Array.isArray(rect) || rect.length !== 5 || !rect.every(Number.isFinite)) {
			return [];
		}
		let [pageIndex, x1, y1, x2, y2] = rect;
		let region = byPage.get(pageIndex);
		if (region) {
			region[0] = Math.min(region[0], x1);
			region[1] = Math.min(region[1], y1);
			region[2] = Math.max(region[2], x2);
			region[3] = Math.max(region[3], y2);
		}
		else {
			byPage.set(pageIndex, [x1, y1, x2, y2]);
		}
	}

	let crops = [];
	for (let [pageIndex, sourceRect] of [...byPage].sort((a, b) => a[0] - b[0])) {
		let page = sdtData.catalog.pages[pageIndex];
		let viewRect = page?.viewRect;
		if (!Array.isArray(viewRect)
				|| viewRect.length !== 4
				|| !viewRect.every(Number.isFinite)) {
			return [];
		}
		let rect = fitRectIntoRect(sourceRect, viewRect);
		let width = rect[2] - rect[0];
		let height = rect[3] - rect[1];
		let rotation = page.rotation ?? 0;
		let userUnit = page.userUnit ?? 1;
		if (!(width > 0) || !(height > 0)
				|| ![0, 90, 180, 270].includes(rotation)
				|| !Number.isFinite(userUnit) || !(userUnit > 0)) {
			return [];
		}
		if (rotation === 90 || rotation === 270) {
			[width, height] = [height, width];
		}
		let displayScale = SDT_BLOCK_CROP_DISPLAY_SCALE * userUnit;
		crops.push({
			pageIndex,
			rect,
			displayWidth: width * displayScale,
			displayHeight: height * displayScale,
		});
	}
	return crops;
}

/**
 * Build a crop provider for SDTView. All crop geometry is registered
 * synchronously before SDTView starts rendering, so crops on the same PDF
 * page can share one lazy render promise.
 *
 * @param {Object} sdtData
 * @param {function(number, number[][]): Promise<string[]>} renderCrops
 *   Renders the given page-coordinate rects of a page and resolves to one
 *   image URL per rect ('' for a rect that couldn't be rendered)
 */
export function createSDTBlockCropProvider(sdtData, renderCrops) {
	let batches = new Map();
	return blockRef => getSDTBlockCropGeometry(sdtData, blockRef).map((crop) => {
		let batch = batches.get(crop.pageIndex);
		if (!batch) {
			batch = { rects: [], promise: null };
			batches.set(crop.pageIndex, batch);
		}
		let index = batch.rects.push(crop.rect) - 1;
		return {
			displayWidth: crop.displayWidth,
			displayHeight: crop.displayHeight,
			render: () => {
				batch.promise ??= renderCrops(crop.pageIndex, batch.rects.slice());
				return batch.promise.then(images => images[index]);
			},
		};
	});
}
