import Section from "epubjs/types/section";
import { EpubCFI } from "epubjs";
import { IGNORE_CLASS } from "./defines";
import StyleScoper from "./lib/style-scoper";

class SectionView {
	readonly section: Section;
	
	readonly container: HTMLElement;

	private readonly _window: Window & typeof globalThis;
	
	private readonly _document: Document;
	
	private readonly _styleScoper: StyleScoper;
	
	private readonly _onInternalLinkClick: (href: string) => void;
	
	constructor(options: {
		section: Section,
		container: HTMLElement,
		window: Window & typeof globalThis,
		document: Document,
		styleScoper: StyleScoper,
		onInternalLinkClick: (href: string) => void,
	}) {
		this.section = options.section;
		this.container = options.container;
		this._window = options.window;
		this._document = options.document;
		this._styleScoper = options.styleScoper;
		this._onInternalLinkClick = options.onInternalLinkClick;
	}

	async initWithHTML(html: string): Promise<void> {
		const onInternalLinkClick = (event: Event) => {
			event.preventDefault();
			let href = (event.target as Element).getAttribute('href')!;
			const canonical = this.section.canonical;
			// This is a hack - we're using the URL constructor to resolve the relative path based on the section's
			// canonical URL, but it'll error without a host. So give it one!
			const url = new URL(href, new URL(canonical, 'https://www.example.com/'));
			href = url.pathname + url.hash;
			this._onInternalLinkClick(href);
		};
		
		const rewriteLink = (a: HTMLAnchorElement) => {
			const href = a.getAttribute('href');
			if (href === null) {
				return;
			}
			if (href.startsWith('http://') || href.startsWith('https://')) {
				a.target = '_blank';
				return;
			}
			if (href.startsWith('mailto:')) {
				return;
			}
			a.addEventListener('click', onInternalLinkClick);
		};
		
		const sectionDoc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
		const walker = this._document.createTreeWalker(sectionDoc, NodeFilter.SHOW_ELEMENT);
		const toRemove = [];
		const toAwait = [];
		
		const REPLACE_TAGS = new Set(['html', 'head', 'body', 'base', 'meta']);
		
		let elem: Element | null = null;
		// eslint-disable-next-line no-unmodified-loop-condition
		while ((elem = walker.nextNode() as Element)) {
			if (REPLACE_TAGS.has(elem.tagName)) {
				const newElem = this._document.createElement('replaced-' + elem.tagName);
				for (const attr of elem.getAttributeNames()) {
					newElem.setAttribute(attr, elem.getAttribute(attr)!);
				}
				newElem.append(...elem.childNodes);
				elem.replaceWith(newElem);
				walker.currentNode = newElem;
			}
			else if (elem.tagName == 'style') {
				this.container.classList.add(
					await this._styleScoper.add(elem.innerHTML || '')
				);
				toRemove.push(elem);
			}
			else if (elem.tagName == 'link' && elem.getAttribute('rel') == 'stylesheet') {
				const link = elem as HTMLLinkElement;
				try {
					this.container.classList.add(
						await this._styleScoper.addByURL(link.href)
					);
				}
				catch (e) {
					console.error(e);
				}
				toRemove.push(elem);
			}
			else if (elem.tagName == 'a') {
				rewriteLink(elem as HTMLAnchorElement);
			}
			else if (elem.tagName == 'img') {
				// We'll wait for images to load (or error) before returning
				toAwait.push((elem as HTMLImageElement).decode());
			}
		}
		
		for (const elem of toRemove) {
			elem.remove();
		}
		
		this.container.append(...sectionDoc.childNodes);
		
		await Promise.allSettled(toAwait).catch();
	}
	
	getStartCFI(horizontal: boolean): EpubCFI | null {
		const iter = this._document.createNodeIterator(this.container, NodeFilter.SHOW_TEXT);
		let node: Node | null = null;
		const range = this._document.createRange();
		let found = false;
		while ((node = iter.nextNode())) {
			if (!node.nodeValue?.trim().length) {
				continue;
			}
			range.selectNodeContents(node);
			const rect = range.getBoundingClientRect();
			if (rect.width && rect.height && (horizontal ? rect.left : rect.top) >= 0) {
				found = true;
				break;
			}
		}
		if (!found) {
			return null;
		}
		return new EpubCFI(range, this.section.cfiBase, IGNORE_CLASS);
	}
}

export default SectionView;
