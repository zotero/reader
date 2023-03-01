import BTree from "sorted-btree";
import SectionView from "../section-view";
import EPUBView from "../epub-view";
import { getAllTextNodes } from "../../common/lib/nodes";
import { EPUB_LOCATION_BREAK_INTERVAL } from "../defines";

class PageMapping {
	private readonly _tree = new BTree<Range, string>(
		undefined,
		(a, b) => a.compareBoundaryPoints(Range.START_TO_START, b) || a.compareBoundaryPoints(Range.END_TO_END, b)
	);
	
	get length(): number {
		return this._tree.length;
	}
	
	addPhysicalPages(views: Iterable<SectionView>): boolean {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		const startTime = performance.now();
		let consecutiveSectionsWithoutMatches = 0;
		for (const view of views) {
			let matchesFound = false;
			for (const matcher of MATCHERS) {
				const elems = view.container.querySelectorAll(matcher.selector);
				if (elems.length) {
					matchesFound = true;
					console.log(`Found ${elems.length} physical page numbers using selector '${matcher.selector}'`);
				}
				for (const elem of elems) {
					const pageNumber = matcher.extract(elem);
					const range = elem.ownerDocument.createRange();
					range.selectNode(elem);
					this._tree.set(range, pageNumber);
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
			((performance.now() - startTime) / 1000).toFixed(2)}s`);
		return !!this._tree.length;
	}
	
	addEPUBLocations(views: Iterable<SectionView>): boolean {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		const startTime = performance.now();
		let locationNumber = 0;
		for (const view of views) {
			const textNodes = getAllTextNodes(view.body);
			let remainingBeforeBreak = 0;
			for (const node of textNodes) {
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
					
					const range = node.ownerDocument.createRange();
					range.setStart(node, offset);
					range.collapse(true);
					this._tree.set(range, (locationNumber + 1).toString());
					
					remainingBeforeBreak = EPUB_LOCATION_BREAK_INTERVAL;
					locationNumber++;
				}
			}
		}
		console.log(`Added ${this._tree.length} EPUB location mappings in ${
			((performance.now() - startTime) / 1000).toFixed(2)}s`);
		return !!this._tree.length;
	}
	
	getPageIndex(range: Range): number | null {
		const pageStartRange = this._tree.getPairOrNextLower(range)?.[0];
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
		for (const [key, value] of this._tree.entries()) {
			if (value === pageNumber) {
				return key;
			}
		}
		return null;
	}
	
	save(view: EPUBView): string {
		return JSON.stringify(this._tree.toArray()
			.map(([range, label]) => [view.getCFI(range)?.toString(), label])
			.filter(([cfi, _]) => !!cfi));
	}
	
	load(saved: string, view: EPUBView): boolean {
		const array = JSON.parse(saved);
		if (!Array.isArray(array)) {
			throw new Error('Unable to load persisted page mapping:\n' + saved);
		}
		this._tree.setPairs(array
			.map(([cfi, label]) => [view.getRange(cfi), label])
			.filter(([range, label]) => !!range && typeof label === 'string') as [Range, string][]);
		return !!this._tree.length;
	}
}

type Matcher = {
	selector: string;
	extract: (el: Element) => string;
}

const MATCHERS: Matcher[] = [
	{
		selector: 'a[id^="PrintPage_"]',
		extract: el => el.id.split('_').pop()!
	}
];

export default PageMapping;
