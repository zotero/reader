import { isSafari } from "../../../common/lib/utilities";
import DOMPurify from "dompurify";
import { DOMPURIFY_CONFIG } from "../../common/lib/nodes";
import parser from "postcss-selector-parser";

const REPLACE_TAGS = new Set(['html', 'head', 'body', 'base', 'meta']);

export async function sanitizeAndRender(xhtml: string, options: {
	container: Element,
	styleScoper: StyleScoper,
}): Promise<HTMLElement> {
	let { container, styleScoper } = options;

	let doc = container.ownerDocument;
	let sectionDoc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
	let walker = doc.createTreeWalker(sectionDoc, NodeFilter.SHOW_ELEMENT);
	let toRemove = [];
	let toAwait = [];

	// Work around a WebKit bug - see DOMView constructor for details
	if (isSafari) {
		DOMPurify.sanitize(sectionDoc.documentElement, {
			...DOMPURIFY_CONFIG,
			IN_PLACE: true,
		});
	}

	let elem: Element | null = null;
	// eslint-disable-next-line no-unmodified-loop-condition
	while ((elem = walker.nextNode() as Element)) {
		if (REPLACE_TAGS.has(elem.tagName)) {
			let newElem = doc.createElement('replaced-' + elem.tagName);
			for (let attr of elem.getAttributeNames()) {
				newElem.setAttribute(attr, elem.getAttribute(attr)!);
			}
			newElem.append(...elem.childNodes);
			elem.replaceWith(newElem);
			walker.currentNode = newElem;
		}
		else if (elem.tagName == 'style') {
			container.classList.add(
				await styleScoper.add(elem.innerHTML || '')
			);
			toRemove.push(elem);
		}
		else if (elem.tagName == 'link' && elem.getAttribute('rel') == 'stylesheet') {
			let link = elem as HTMLLinkElement;
			try {
				container.classList.add(
					await styleScoper.addByURL(link.href)
				);
			}
			catch (e) {
				console.error(e);
			}
			toRemove.push(elem);
		}
		else if (elem.tagName == 'img') {
			// We'll wait for images to load (or error) before returning
			toAwait.push((elem as HTMLImageElement).decode());
		}
		else if (elem.tagName == 'title') {
			toRemove.push(elem);
		}
	}

	for (let elem of toRemove) {
		elem.remove();
	}

	container.append(...sectionDoc.childNodes);
	await Promise.allSettled(toAwait).catch(e => console.error(e));
	return container.querySelector('replaced-body') as HTMLElement;
}

export class StyleScoper {
	private _document: Document;

	private _sheets = new Map<string, SheetMetadata>();

	private _textCache = new Map<string, string>();

	constructor(document: Document) {
		this._document = document;
	}

	/**
	 * @param css CSS stylesheet code
	 * @return A class to add to the scope element
	 */
	async add(css: string): Promise<string> {
		if (this._sheets.has(css)) {
			return this._sheets.get(css)!.scopeClass;
		}

		let sheet;
		let added = false;
		try {
			sheet = new this._document.defaultView!.CSSStyleSheet();
			await sheet.replace(css);
		}
		catch (e) {
			// Constructor not available
			let style = this._document.createElement('style');
			style.innerHTML = css;
			if (style.sheet) {
				sheet = style.sheet;
			}
			else {
				let promise = new Promise<CSSStyleSheet>(
					resolve => style.addEventListener('load', () => resolve(style.sheet!))
				);
				this._document.head.append(style);
				sheet = await promise;
				added = true;
			}
		}

		if (!added && this._document.adoptedStyleSheets) {
			this._document.adoptedStyleSheets.push(sheet);
		}

		let scopeClass = `__scope_${this._sheets.size}`;
		this._sheets.set(css, { sheet, scopeClass });
		return scopeClass;
	}

	/**
	 * @param url The URL of a CSS stylesheet
	 * @return A class to add to the scope element
	 */
	async addByURL(url: string): Promise<string> {
		let css;
		if (this._textCache.has(url)) {
			css = this._textCache.get(url)!;
		}
		else {
			css = await (await fetch(url)).text();
			this._textCache.set(url, css);
		}
		return this.add(css);
	}

	rewriteAll() {
		for (let { sheet, scopeClass } of this._sheets.values()) {
			this._visitStyleSheet(sheet, scopeClass);
		}
	}

	private _visitStyleSheet(sheet: CSSStyleSheet, scopeClass: string) {
		for (let rule of sheet.cssRules) {
			this._visitRule(rule, scopeClass);
		}
	}

	private _visitRule(rule: CSSRule, scopeClass: string) {
		if (rule.constructor.name === 'CSSStyleRule') {
			let styleRule = rule as CSSStyleRule;
			styleRule.selectorText = parser((selectors) => {
				selectors.each((selector) => {
					selector.replaceWith(
						parser.selector({
							value: '',
							nodes: [
								parser.className({ value: scopeClass }),
								parser.combinator({ value: ' ' }),
								parser.selector({
									...selector,
									nodes: selector.nodes.map((node) => {
										if (node.type === 'tag' && REPLACE_TAGS.has(node.value.toLowerCase())) {
											return parser.tag({
												...node,
												value: 'replaced-' + node.value
											});
										}
										return node;
									})
								})
							],
							spaces: selector.spaces
						})
					);
				});
			}).processSync(styleRule.selectorText);
		}
		else if (rule.constructor.name === 'CSSImportRule') {
			let importRule = rule as CSSImportRule;
			this._visitStyleSheet(importRule.styleSheet, scopeClass);
		}

		// If this rule contains child rules, visit each of them
		if ('cssRules' in rule) {
			for (let childRule of rule.cssRules as CSSRuleList) {
				this._visitRule(childRule, scopeClass);
			}
		}
	}
}

type SheetMetadata = {
	sheet: CSSStyleSheet;
	scopeClass: string;
};
