import BTree from "sorted-btree";
import EPUBView from "../epub-view";
import { getPotentiallyVisibleTextNodes } from "../../common/lib/nodes";
import { EPUB_LOCATION_BREAK_INTERVAL } from "../defines";
import {
	lengthenCFI,
	shortenCFI
} from "../cfi";
import { PersistentRange } from "../../common/lib/range";

class PageMapping {
	static generate(view: EPUBView): PageMapping {
		let mapping = new PageMapping(view);
		let sectionBodies = view.renderers.map(renderer => renderer.body);
		mapping._addPhysicalPages(sectionBodies);
		if (!mapping.tree.length) {
			mapping._addEPUBLocations(sectionBodies);
		}
		mapping.tree.freeze();
		return mapping;
	}

	static load(saved: string, view: EPUBView): PageMapping | null {
		let mapping = new PageMapping(view);

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
		mapping.tree.setPairs(mappings
			.map(([cfi, label]) => [view.getRange(lengthenCFI(cfi)), label])
			.filter(([range, label]) => !!range && typeof label === 'string')
			.map(([range, label]) => [new PersistentRange(range), label]) as [PersistentRange, string][]);
		mapping._isPhysical = obj.isPhysical;

		return mapping;
	}

	static readonly VERSION = 10;

	readonly tree = new BTree<PersistentRange, string>(
		undefined,
		(a, b) => EPUBView.compareBoundaryPoints(Range.START_TO_START, a.toRange(), b.toRange())
			|| EPUBView.compareBoundaryPoints(Range.END_TO_END, a.toRange(), b.toRange())
	);

	private _isPhysical = false;

	private _view: EPUBView;

	private constructor(view: EPUBView) {
		this._view = view;
	}

	get length(): number {
		return this.tree.length;
	}

	get isPhysical(): boolean {
		return this._isPhysical;
	}

	private _addPhysicalPages(sectionBodies: HTMLElement[]) {
		if (this.tree.length) {
			throw new Error('Page mapping already populated');
		}
		let startTime = new Date().getTime();
		for (let body of sectionBodies) {
			for (let matcher of MATCHERS) {
				let elems = body.querySelectorAll(matcher.selector);
				let successes = 0;
				for (let elem of elems) {
					let pageNumber = matcher.extract(elem);
					if (!pageNumber) {
						continue;
					}
					let range = elem.ownerDocument.createRange();
					range.selectNode(elem);
					range.collapse(true);
					this.tree.set(new PersistentRange(range), pageNumber);
					successes++;
				}
				if (successes) {
					console.log(`Found ${successes} physical page numbers using selector '${matcher.selector}'`);
				}
			}
		}
		console.log(`Added ${this.tree.length} physical page mappings in ${
			((new Date().getTime() - startTime) / 1000).toFixed(2)}s`);
		if (this.tree.length) {
			this._isPhysical = true;
		}
	}

	private _addEPUBLocations(sectionBodies: HTMLElement[]) {
		if (this.tree.length) {
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
					this.tree.set(new PersistentRange(range), (locationNumber + 1).toString());

					remainingBeforeBreak = EPUB_LOCATION_BREAK_INTERVAL;
					locationNumber++;
				}
			}
		}
		console.log(`Added ${this.tree.length} EPUB location mappings in ${
			((new Date().getTime() - startTime) / 1000).toFixed(2)}s`);
	}

	getPageIndex(range: AbstractRange): number | null {
		let pageStartRange = this.tree.getPairOrNextLower(new PersistentRange(range))?.[0];
		if (!pageStartRange) {
			return null;
		}
		return this.tree.keysArray().indexOf(pageStartRange);
	}

	getPageLabel(range: AbstractRange): string | null {
		return this.tree.getPairOrNextLower(new PersistentRange(range))?.[1] ?? null;
	}

	get firstRange(): Range | null {
		return this.tree.minKey()?.toRange() ?? null;
	}

	getRange(pageLabel: string): PersistentRange | null {
		// This is slow, but only needs to be called when manually navigating to a physical page number
		for (let [key, value] of this.tree.entries()) {
			if (value === pageLabel) {
				return key;
			}
		}
		return null;
	}

	save(): string {
		let version = PageMapping.VERSION;
		let isPhysical = this._isPhysical;
		let mappings = this.tree.toArray()
			.map(([range, label]) => {
				let cfi = this._view.getCFI(range.toRange());
				if (!cfi) {
					return null;
				}
				return [shortenCFI(cfi.toString(true)), label];
			})
			.filter(Boolean);
		return JSON.stringify({
			version,
			isPhysical,
			mappings,
		});
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
		selector: '[*|type="pagebreak"]',
		extract: el => el.getAttribute('title') ?? undefined
	}
];

export default PageMapping;
