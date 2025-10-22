import readingModeSCSS from '../stylesheets/reading-mode.scss';
import { Readability } from "@abejellinek/readability-keep-nodes";
import { iterateWalker } from "../../common/lib/nodes";
import { enumerate } from "../../common/lib/collection";
import { NodeMapping } from "./node-mapping";

export class ReadingMode {
	private readonly _doc: Document;

	private readonly _mapping = new NodeMapping();

	private readonly _fragment: DocumentFragment;

	private readonly _originalStyleSheets = new Map<CSSStyleSheet, Element | ProcessingInstruction | null>;

	private readonly _style: HTMLStyleElement;

	private _enabled = false;

	constructor(doc: Document) {
		this._doc = doc;
		this._fragment = doc.createDocumentFragment();
		this._style = doc.createElement('style');
		this._style.textContent = readingModeSCSS;

		for (let styleSheet of [...this._doc.styleSheets, ...this._doc.adoptedStyleSheets]) {
			if (styleSheet.disabled) {
				continue;
			}
			this._originalStyleSheets.set(styleSheet, styleSheet.ownerNode);
		}
	}

	get enabled() {
		return this._enabled;
	}

	set enabled(enabled: boolean) {
		if (enabled === this._enabled) {
			return;
		}
		if (enabled) {
			this._enable();
		}
		else {
			this._disable();
		}
		this._enabled = enabled;
	}

	get originalRoot(): DocumentFragment {
		if (!this._enabled) {
			throw new Error('Not enabled');
		}
		return this._fragment;
	}

	mapNodeToFocus(node: Node) {
		if (!this._enabled) {
			throw new Error('Not enabled');
		}
		let mappedNode = this._mapping.getByPre(node);
		if (!mappedNode || !this._doc.body.contains(mappedNode)) {
			return null;
		}
		return mappedNode;
	}

	mapRangeToFocus(range: Range) {
		let startContainer = this.mapNodeToFocus(range.startContainer);
		let endContainer = this.mapNodeToFocus(range.endContainer);
		if (!startContainer || !endContainer) {
			return null;
		}
		let newRange = this._doc.createRange();
		newRange.setStart(startContainer, range.startOffset);
		newRange.setEnd(endContainer, range.endOffset);
		return newRange;
	}

	mapNodeFromFocus(node: Node) {
		if (!this._enabled) {
			throw new Error('Not enabled');
		}
		let mappedNode = this._mapping.getByPost(node);
		if (!mappedNode || !this._fragment.contains(mappedNode)) {
			return null;
		}
		return mappedNode;
	}

	mapRangeFromFocus(range: Range) {
		let startContainer = this.mapNodeFromFocus(range.startContainer);
		let endContainer = this.mapNodeFromFocus(range.endContainer);
		if (!startContainer || !endContainer) {
			return null;
		}
		let newRange = this._doc.createRange();
		newRange.setStart(startContainer, range.startOffset);
		newRange.setEnd(endContainer, range.endOffset);
		return newRange;
	}

	private _enable() {
		let initMapping = () => {
			let clonedDoc = this._doc.cloneNode(true) as Document;

			let originalNodes = [...iterateWalker(this._doc.createTreeWalker(this._doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT))];
			for (let [i, mappedNode] of enumerate(iterateWalker(clonedDoc.createTreeWalker(clonedDoc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)))) {
				this._mapping.setByPre(originalNodes[i], mappedNode);
			}

			let fragmentBody = this._doc.createElement('body');
			for (let child of [...this._doc.body.childNodes]) {
				if (child.nodeType === Node.ELEMENT_NODE && (child as Element).id === 'annotation-overlay') {
					continue;
				}
				fragmentBody.append(child);
			}
			this._fragment.replaceChildren(fragmentBody);

			return clonedDoc;
		};

		let clonedDoc = initMapping();
		let readability = new Readability(clonedDoc, {
			serializer: node => node,
			reload: () => {
				this._disable();
				clonedDoc = initMapping();
				return clonedDoc;
			},
		});
		Object.defineProperty(readability, '_setNodeTag', {
			value: (node: Node, _newTagName: string) => {
				// We don't really care about the element changes Readability wants to make
				// (mostly h1 -> h2), and letting it make them would break our mappings
				return node;
			}
		});
		Object.defineProperty(readability, '_fixRelativeUris', {
			value: () => {
				// Leave links alone - we've already handled them
			}
		});
		let root = readability.parse()?.content;
		if (!root) {
			throw new Error('Readability failed');
		}
		this._doc.body.prepend(root);

		for (let [styleSheet, ownerNode] of this._originalStyleSheets) {
			styleSheet.disabled = true;
			ownerNode?.remove();
		}
		this._doc.head.append(this._style);
	}

	private _disable() {
		this._doc.body.replaceChildren(
			...this._fragment.firstElementChild!.childNodes,
			this._doc.body.querySelector(':scope > #annotation-overlay')!,
		);

		for (let [styleSheet, ownerNode] of this._originalStyleSheets) {
			styleSheet.disabled = false;
			if (ownerNode) {
				this._doc.head.append(ownerNode);
			}
		}
		this._style.remove();
		this._mapping.clear();
		this._fragment.replaceChildren();
	}
}
