import EpubView from "../epub-view";
import BTree from "sorted-btree";
import SectionView from "../section-view";

class PageMapping {
	private readonly _tree = new BTree<Range, string>(
		undefined,
		(a, b) => a.compareBoundaryPoints(Range.START_TO_START, b)
	);
	
	get length(): number {
		return this._tree.length;
	}
	
	addPhysicalPages(views: Iterable<SectionView>): boolean {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		let consecutiveSectionsWithoutMatches = 0;
		for (const view of views) {
			let matchesFound = false;
			for (const matcher of MATCHERS) {
				const elems = view.container.querySelectorAll(matcher.selector);
				if (elems.length) {
					matchesFound = true;
				}
				for (const elem of elems) {
					const pageNumber = matcher.extract(elem);
					const range = elem.ownerDocument.createRange();
					range.selectNode(elem);
					this._tree.set(range, pageNumber);
				}
			}
			if (!matchesFound) {
				if (++consecutiveSectionsWithoutMatches >= 3) {
					console.log('Aborting physical page mapping generation after 3 sections without matches');
					break;
				}
			}
			else {
				consecutiveSectionsWithoutMatches = 0;
			}
		}
		console.log(`Added ${this._tree.length} physical page mappings`);
		return !!this._tree.length;
	}
	
	addEPUBLocations(view: EpubView, locations: string[]): boolean {
		if (this._tree.length) {
			throw new Error('Page mapping already populated');
		}
		for (const [loc, cfi] of locations.entries()) {
			const range = view.getRange(cfi);
			if (!range) {
				continue;
			}
			this._tree.set(range, String(loc + 1));
		}
		console.log(`Added ${this._tree.length} EPUB location mappings`);
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
