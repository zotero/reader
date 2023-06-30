import BTree from "sorted-btree";
import SectionView from "../section-view";
import EPUBView from "../epub-view";
import { getVisibleTextNodes } from "../../common/lib/nodes";
import { EPUB_LOCATION_BREAK_INTERVAL } from "../defines";
import {
	lengthenCFI,
	shortenCFI
} from "../cfi";

class PageMapping {
	static readonly VERSION = 3;

	private readonly _tree = new BTree<Range, string>(
		undefined,
		(a, b) => a.compareBoundaryPoints(Range.START_TO_START, b) || a.compareBoundaryPoints(Range.END_TO_END, b)
	);

	private _isPhysical = false;

	get length(): number {
		return this._tree.length;
	}

	get isPhysical(): boolean {
		return this._isPhysical;
	}

	generate(views: Iterable<SectionView>) {
		this._addPhysicalPages(views);
		if (this._tree.length) {
			return;
		}
		this._addEPUBLocations(views);
	}

	private _addPhysicalPages(views: Iterable<SectionView>) {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		let startTime = new Date().getTime();
		let consecutiveSectionsWithoutMatches = 0;
		for (let view of views) {
			let matchesFound = false;
			for (let matcher of MATCHERS) {
				let elems = view.container.querySelectorAll(matcher.selector);
				let successes = 0;
				for (let elem of elems) {
					let pageNumber = matcher.extract(elem);
					if (!pageNumber) {
						continue;
					}
					let range = elem.ownerDocument.createRange();
					range.selectNode(elem);
					range.collapse(true);
					this._tree.set(range, pageNumber);
					successes++;
				}
				if (successes) {
					matchesFound = true;
					console.log(`Found ${successes} physical page numbers using selector '${matcher.selector}'`);
				}
			}
			if (matchesFound) {
				consecutiveSectionsWithoutMatches = 0;
			}
			else if (++consecutiveSectionsWithoutMatches >= 3) {
				console.log('Aborting physical page mapping generation after 3 sections without matches');
				break;
			}
		}
		console.log(`Added ${this._tree.length} physical page mappings in ${
			((new Date().getTime() - startTime) / 1000).toFixed(2)}s`);
		if (this._tree.length) {
			this._isPhysical = true;
		}
	}

	private _addEPUBLocations(views: Iterable<SectionView>) {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		let startTime = new Date().getTime();
		let locationNumber = 0;
		for (let view of views) {
			let textNodes = getVisibleTextNodes(view.body);
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
					this._tree.set(range, (locationNumber + 1).toString());

					remainingBeforeBreak = EPUB_LOCATION_BREAK_INTERVAL;
					locationNumber++;
				}
			}
		}
		console.log(`Added ${this._tree.length} EPUB location mappings in ${
			((new Date().getTime() - startTime) / 1000).toFixed(2)}s`);
	}

	getPageIndex(range: Range): number | null {
		let pageStartRange = this._tree.getPairOrNextLower(range)?.[0];
		if (!pageStartRange) {
			return null;
		}
		return this._tree.keysArray().indexOf(pageStartRange);
	}

	getPageLabel(range: Range): string | null {
		return this._tree.getPairOrNextLower(range)?.[1] ?? null;
	}

	getRange(pageNumber: string): Range | null {
		// This is slow, but only needs to be called when manually navigating to a physical page number
		for (let [key, value] of this._tree.entries()) {
			if (value === pageNumber) {
				return key;
			}
		}
		return null;
	}

	save(view: EPUBView): string {
		let version = PageMapping.VERSION;
		let mappings = this._tree.toArray()
			.map(([range, label]) => {
				let cfi = view.getCFI(range);
				if (!cfi) {
					return null;
				}
				return [shortenCFI(cfi.toString(true)), label];
			})
			.filter(Boolean);
		return JSON.stringify({ version, mappings });
	}

	load(saved: string, view: EPUBView): boolean {
		let obj = JSON.parse(saved);
		if (!obj) {
			return false;
		}
		if (!obj.version || obj.version < PageMapping.VERSION) {
			console.warn(`Page mappings are old: ${obj.version} < ${PageMapping.VERSION}`);
			return false;
		}
		let mappings = obj.mappings;
		if (!Array.isArray(mappings)) {
			console.error('Unable to load persisted page mapping', saved);
			return false;
		}
		this._tree.setPairs(mappings
			.map(([cfi, label]) => [view.getRange(lengthenCFI(cfi)), label])
			.filter(([range, label]) => !!range && typeof label === 'string') as [Range, string][]);
		return !!this._tree.length;
	}
}

type Matcher = {
	selector: string;
	extract: (el: Element) => string | undefined;
}

const MATCHERS: Matcher[] = [
	{
		selector: 'a[id*="page" i]:empty',
		extract: el => el.id.replace(/page[-_]?/i, '').replace(/^(.*_)+/, '')
	}
];

export default PageMapping;
