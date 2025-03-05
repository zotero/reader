import BTree from "sorted-btree";
import EPUBView from "../epub-view";
import { getPotentiallyVisibleTextNodes } from "../../common/lib/nodes";
import { EPUB_LOCATION_BREAK_INTERVAL } from "../defines";
import {
	lengthenCFI,
	shortenCFI
} from "../cfi";
import { moveRangeEndsIntoTextNodes, PersistentRange } from "../../common/lib/range";

class PageMapping {
	static generate(view: EPUBView): PageMapping {
		let mapping = new PageMapping();
		let sectionBodies = view.renderers.map(renderer => renderer.body);
		mapping._addPhysicalPages(sectionBodies);
		if (!mapping._tree.length) {
			mapping._addEPUBLocations(sectionBodies);
		}
		mapping._freeze(view);
		return mapping;
	}

	static load(saved: string, view: EPUBView): PageMapping | null {
		let mapping = new PageMapping();

		let obj = JSON.parse(saved);
		if (!obj) {
			return null;
		}
		if (!obj.version || obj.version < PageMapping.VERSION) {
			console.warn(`Page mappings are old: ${obj.version} < ${PageMapping.VERSION}`);
			return null;
		}

		let { mappings } = obj;
		if (!Array.isArray(mappings)) {
			console.error('Unable to load persisted page mapping', saved);
			return null;
		}
		mapping._tree.setPairs(mappings
			.map(([cfi, label]) => [view.getRange(lengthenCFI(cfi)), label])
			.filter(([range, label]) => !!range && typeof label === 'string')
			.map(([range, label]) => [new PersistentRange(range), label]) as [PersistentRange, string][]);
		mapping._isPhysical = obj.isPhysical;
		mapping._freeze(view);

		return mapping;
	}

	static readonly VERSION = 13;

	private readonly _tree = new BTree<PersistentRange, string>(
		undefined,
		(a, b) => EPUBView.compareBoundaryPoints(Range.START_TO_START, a, b)
			|| EPUBView.compareBoundaryPoints(Range.END_TO_END, a, b)
	);

	private _json!: string;

	private _isPhysical = false;

	// eslint-disable-next-line no-useless-constructor
	private constructor() {
		// Prevent construction from outside
	}

	get length(): number {
		return this._tree.length;
	}

	get isPhysical(): boolean {
		return this._isPhysical;
	}

	private _addPhysicalPages(sectionBodies: HTMLElement[]) {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		let startTime = new Date().getTime();
		let potentialMappings = MATCHERS.map((matcher) => {
			console.log('Trying matcher', matcher.selector);

			let mapping: [PersistentRange, string][] = [];
			let score = 0;
			let sectionsWithMatches = 0;
			for (let body of sectionBodies) {
				let elems = body.querySelectorAll(matcher.selector);
				let successes = 0;

				for (let elem of elems) {
					let pageNumber = matcher.extract(elem);
					if (!pageNumber) {
						continue;
					}
					let range = elem.ownerDocument.createRange();
					range.selectNode(elem);
					range = moveRangeEndsIntoTextNodes(range);
					range.collapse(true);
					mapping.push([new PersistentRange(range), pageNumber]);
					successes++;
				}

				if (successes) {
					score += successes;
					sectionsWithMatches++;
				}
			}

			// If less than half of all sections have locations, the mapping is bad
			if (sectionsWithMatches < sectionBodies.length / 2) {
				console.log(`Aborting due to insufficient sections with page numbers (${sectionsWithMatches}/${sectionBodies.length})`);
				return { mapping: [], score: 0, matcher };
			}

			let previous: string | null = null;
			for (let [, pageNumber] of mapping) {
				if (previous !== null) {
					let previousInt = parseInt(previous);
					let thisInt = parseInt(pageNumber);
					if (!Number.isNaN(previousInt) && !Number.isNaN(thisInt)) {
						// If page numbers are decreasing, dock three-quarters of the points
						if (thisInt < previousInt) {
							console.log(`Decreasing page numbers: ${previous} -> ${pageNumber}`);
							score /= 4;
							break;
						}
						// And if they skip more than two pages, dock half
						if (thisInt > previousInt + 3) {
							console.log(`Non-continuous page numbers: ${previous} -> ${pageNumber}`);
							score /= 2;
							break;
						}
					}
				}
				previous = pageNumber;
			}

			let seen = new Set<string>();
			for (let [, pageNumber] of mapping) {
				if (seen.has(pageNumber)) {
					// Non-numeric duplicates: We're matching something that isn't page numbers, so abort
					if (/^\D{2,}$/.test(pageNumber)) {
						console.log('Aborting due to non-numeric duplicate page number', pageNumber);
						return { mapping: [], score: 0, matcher };
					}
					// Numeric duplicates: Dock half the points, but potentially still use the mapping
					console.log('Duplicate page number', pageNumber);
					score /= 2;
					break;
				}
				seen.add(pageNumber);
			}

			console.log(`Score: ${score} (${mapping.length} matches)`);
			return { mapping, score, matcher };
		});
		potentialMappings = potentialMappings
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.mapping.length - a.mapping.length);
		let mapping = potentialMappings[0];
		if (mapping) {
			this._tree.setPairs(mapping.mapping);
			this._isPhysical = true;
			console.log(`Added ${this._tree.length} physical page mappings in ${
				((new Date().getTime() - startTime) / 1000).toFixed(2)}s using ${mapping.matcher.selector}`);
		}
		else {
			console.log('Not enough page numbers to be confident -- reverting to EPUB locations');
		}
	}

	private _addEPUBLocations(sectionBodies: HTMLElement[]) {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		let startTime = new Date().getTime();
		let locationNumber = 0;
		for (let body of sectionBodies) {
			let textNodes = getPotentiallyVisibleTextNodes(body);
			let remainingBeforeBreak = 0;
			for (let node of textNodes) {
				if (/^\s*$/.test(node.data)) continue;

				let offset = 0;
				let length = node.length;
				if (length <= remainingBeforeBreak) {
					remainingBeforeBreak -= length;
					continue;
				}
				while (length > remainingBeforeBreak) {
					offset += remainingBeforeBreak;
					length -= remainingBeforeBreak;

					let range = node.ownerDocument.createRange();
					range.setStart(node, offset);
					range.collapse(true);
					this._tree.set(new PersistentRange(range), (locationNumber + 1).toString());

					remainingBeforeBreak = EPUB_LOCATION_BREAK_INTERVAL;
					locationNumber++;
				}
			}
		}
		console.log(`Added ${this._tree.length} EPUB location mappings in ${
			((new Date().getTime() - startTime) / 1000).toFixed(2)}s`);
	}

	private _freeze(view: EPUBView) {
		this._tree.freeze();

		let version = PageMapping.VERSION;
		let isPhysical = this._isPhysical;
		let mappings = this._tree.toArray()
			.map(([range, label]) => {
				let cfi = view.getCFI(range.toRange());
				if (!cfi) {
					return null;
				}
				return [shortenCFI(cfi.toString(true)), label];
			})
			.filter(Boolean);
		this._json = JSON.stringify({
			version,
			isPhysical,
			mappings,
		});
	}

	getPageIndex(range: AbstractRange): number | null {
		let pageStartRange = this._tree.getPairOrNextLower(new PersistentRange(range))?.[0];
		if (!pageStartRange) {
			return null;
		}
		return this._tree.keysArray().indexOf(pageStartRange);
	}

	getPageLabel(range: AbstractRange): string | null {
		return this._tree.getPairOrNextLower(new PersistentRange(range))?.[1] ?? null;
	}

	get firstRange(): Range | null {
		return this._tree.minKey()?.toRange() ?? null;
	}

	getRange(pageLabel: string): PersistentRange | null {
		// This is slow, but only needs to be called when manually navigating to a physical page number
		for (let [key, value] of this._tree.entries()) {
			if (value === pageLabel) {
				return key;
			}
		}
		return null;
	}

	ranges(): IterableIterator<PersistentRange> {
		return this._tree.keys();
	}

	pageLabels(): IterableIterator<string> {
		return this._tree.values();
	}

	entries(): IterableIterator<[PersistentRange, string]> {
		return this._tree.entries();
	}

	toJSON() {
		if (!this._json) {
			throw new Error('Not yet frozen');
		}
		return this._json;
	}
}

type Matcher = {
	selector: string;
	extract: (el: Element) => string | undefined;
}

const MATCHERS: Matcher[] = [
	{
		selector: '[id*="page" i]:not(#pagetop):not(#pagebottom):empty',
		extract: el => el.id.replace(/page[-_]?/i, '').replace(/^(.*_)+/, '')
	},

	{
		selector: '[id*="page" i]:not(#pagetop):not(#pagebottom)',
		extract: el => el.id.replace(/page[-_]?/i, '').replace(/^(.*_)+/, '')
	},

	{
		selector: '[*|type="pagebreak"]',
		extract: el => el.getAttribute('title') ?? undefined
	}
];

export default PageMapping;
