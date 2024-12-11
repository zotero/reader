import Section from "epubjs/types/section";
import { getPotentiallyVisibleTextNodes } from "../common/lib/nodes";
import {
	sanitizeAndRender,
	CSSRewriter
} from "./lib/sanitize-and-render";
import { createSearchContext } from "../common/lib/find";

class SectionRenderer {
	readonly section: Section;

	readonly container: HTMLElement;

	readonly containerTemplate: HTMLTemplateElement;

	body!: HTMLElement;

	error = false;

	private readonly _document: Document;

	private readonly _sectionsContainer: HTMLElement;

	constructor(options: {
		section: Section,
		sectionsContainer: HTMLElement,
		document: Document,
	}) {
		this.section = options.section;
		this._sectionsContainer = options.sectionsContainer;
		this._document = options.document;

		let container = this._document.createElement('div');
		container.id = 'section-' + this.section.index;
		container.classList.add('section-container', 'cfi-stop');
		container.setAttribute('data-section-index', String(this.section.index));
		this.container = container;

		let containerTemplate = this._document.createElement('template');
		containerTemplate.setAttribute('data-section-index', String(this.section.index));
		this._sectionsContainer.append(containerTemplate);
		this.containerTemplate = containerTemplate;
	}

	unmount() {
		if (this.container.parentElement) {
			this.container.replaceWith(this.containerTemplate);
		}
	}

	mount() {
		if (this.containerTemplate.parentElement) {
			this.containerTemplate.replaceWith(this.container);
		}
	}

	get mounted() {
		return this.container.parentElement === this._sectionsContainer;
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	async render(requestFn: Function, cssRewriter: CSSRewriter): Promise<void> {
		if (this.body) {
			throw new Error('Already rendered');
		}
		if (!this.section.url) {
			console.error('Section has no URL', this.section);
			this._displayError('Missing content');
			return;
		}
		let xhtml = await this.section.render(requestFn);

		try {
			await sanitizeAndRender(xhtml, { container: this.container, cssRewriter });
			let body = this.container.querySelector('replaced-body') as HTMLElement | null;
			if (!body) {
				console.error('Section has no body', this.section);
				this._displayError('Missing content');
				return;
			}
			this.body = body;
		}
		catch (e) {
			console.error('Error rendering section ' + this.section.index + ' (' + this.section.href + ')', e);
			this._displayError('Invalid content');
		}
	}

	private _displayError(message: string) {
		let errorDiv = this._document.createElement('div');
		errorDiv.style.color = 'red';
		errorDiv.style.fontSize = '1.5em';
		errorDiv.style.fontWeight = 'bold';
		errorDiv.style.textAlign = 'center';
		errorDiv.append(`[Section ${this.section.index}: ${message}]`);
		this.container.replaceChildren(errorDiv);
		this.body = errorDiv;
		this.error = true;
	}

	get searchContext() {
		let searchContext = createSearchContext(getPotentiallyVisibleTextNodes(this.container));
		Object.defineProperty(this, 'searchContext', { value: searchContext });
		return searchContext;
	}
}

export default SectionRenderer;
