class StyleScoper {
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
			const style = this._document.createElement('style');
			style.innerHTML = css;
			if (style.sheet) {
				sheet = style.sheet;
			}
			else {
				const promise = new Promise<CSSStyleSheet>(
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
		
		const scopeClass = `__scope_${this._sheets.size}`;
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
		for (const { sheet, scopeClass } of this._sheets.values()) {
			this._visitStyleSheet(sheet, scopeClass);
		}
	}
	
	private _visitStyleSheet(sheet: CSSStyleSheet, scopeClass: string) {
		for (const rule of sheet.cssRules) {
			this._visitRule(rule, scopeClass);
		}
	}
	
	private _visitRule(rule: CSSRule, scopeClass: string) {
		if (rule.constructor.name === 'CSSStyleRule') {
			const styleRule = rule as CSSStyleRule;
			styleRule.selectorText = `.${scopeClass} :is(${styleRule.selectorText})`;
		}
		else if (rule.constructor.name === 'CSSImportRule') {
			const importRule = rule as CSSImportRule;
			this._visitStyleSheet(importRule.styleSheet, scopeClass);
		}
		
		// If this rule contains child rules, visit each of them
		if ('cssRules' in rule) {
			for (const childRule of rule.cssRules as CSSRuleList) {
				this._visitRule(childRule, scopeClass);
			}
		}
	}
}

type SheetMetadata = {
	sheet: CSSStyleSheet;
	scopeClass: string;
};

export default StyleScoper;
