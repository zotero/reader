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
		else if (elem.tagName == 'link' && elem.getAttribute('rel')?.toLowerCase() == 'stylesheet') {
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
		else if (elem.tagName == 'title') {
			toRemove.push(elem);
		}
	}

	for (let elem of toRemove) {
		elem.remove();
	}

	container.append(...sectionDoc.childNodes);

	// Add table-like class to elements matching selectors that set display: table or display: inline-table
	for (let selector of [...styleScoper.tableSelectors, 'table', 'mtable']) {
		try {
			for (let table of container.querySelectorAll(selector)) {
				table.classList.add('table-like');
				table.role = 'table';
			}
		}
		catch (e) {
			// Ignore
		}
	}

	return container.querySelector('replaced-body') as HTMLElement;
}

export class StyleScoper {
	tableSelectors = new Set<string>();

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
		let scopeClass = `__scope_${this._sheets.size}`;
		this._sheets.set(css, { scopeClass });

		let cssModified = this._rewriteEPUBProperties(css);

		let sheet;
		let added = false;
		try {
			sheet = new this._document.defaultView!.CSSStyleSheet();
			await sheet.replace(cssModified);
		}
		catch (e) {
			// Constructor not available
			let style = this._document.createElement('style');
			style.innerHTML = cssModified;
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

		this._visitStyleSheet(sheet, scopeClass);

		if (!added) {
			this._document.adoptedStyleSheets.push(sheet);
		}

		// Overwrite previous value now that the sheet is loaded
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

			// Keep track of selectors that set display: table, because we want to add a class to those elements
			// in sanitizeAndRender()
			if (styleRule.style.display === 'table' || styleRule.style.display === 'inline-table') {
				this.tableSelectors.add(styleRule.selectorText);
			}

			// If this rule sets a monospace font, make it !important so that it overrides the default content font
			if (styleRule.style.fontFamily && /\bmono(space)?\b/i.test(styleRule.style.fontFamily)) {
				styleRule.style.setProperty('font-family', styleRule.style.fontFamily, 'important');
			}
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

	private _rewriteEPUBProperties(css: string): string {
		for (let [re, replacement] of EPUB_CSS_REPLACEMENTS) {
			css = css.replace(re, replacement);
		}
		return css;
	}
}

// Mappings based on https://github.com/JayPanoz/postcss-epub-interceptor/blob/1aca86e1f4f996f9ec3a8735bd70e673f3e0f504/index.js
const EPUB_CSS_REPLACEMENTS: [RegExp, string][] = Object.entries({
	'text-transform': ['text-transform', {
		'-epub-fullwidth': 'full-width'
	}],
	'-epub-hyphens': ['hyphens', {}],
	'-epub-line-break': ['line-break', {}],
	'-epub-text-align-last': ['text-align-last', {}],
	'-epub-word-break': ['word-break', {}],
	'-epub-text-emphasis': ['text-emphasis', {}],
	'-epub-text-emphasis-color': ['text-emphasis-color', {}],
	'-epub-text-emphasis-style': ['text-emphasis-style', {}],
	'-epub-text-emphasis-position': ['text-emphasis-position', {}],
	'-epub-text-underline-position': ['text-underline-position', {
		alphabetic: 'auto'
	}],
	'-epub-ruby-position': ['ruby-position', {}],
	'-epub-writing-mode': ['writing-mode', {}],
	'-epub-text-orientation': ['text-orientation', {
		'vertical-right': 'mixed',
		'sideways-right': 'sideways',
		'rotate-right': 'sideways',
		'rotate-normal': 'sideways'
	}],
	'-epub-text-combine': ['text-combine-upright', {
		horizontal: 'all'
	}],
	'-epub-text-combine-horizontal': ['text-combine-upright', {}],
	'-epub-text-combine-upright': ['text-combine-upright', {}],
}).flatMap(([rule, [newRule, valueMapping]]) => {
	// That's right: we're parsing CSS with regular expressions
	// This is unlikely to cause false positives
	let ruleRe = new RegExp(`(^|[^a-zA-Z-])${rule}(\\s*:)`, 'gi');
	let ruleReplacement = '$1' + newRule + '$2';
	let valueReplacements: [RegExp, string][] = Object.entries(valueMapping).map(([value, newValue]) => {
		let valueRe = new RegExp(`((?:^|[^a-zA-Z-])${newRule}\\s*:\\s*)${value}($|[^a-zA-Z-])`, 'gi');
		return [valueRe, '$1' + newValue + '$2'];
	});
	return [[ruleRe, ruleReplacement], ...valueReplacements];
});

type SheetMetadata = {
	sheet?: CSSStyleSheet;
	scopeClass: string;
};
