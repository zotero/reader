import { closestElement } from "./nodes";

/**
 * Generate a CSS selector uniquely pointing to node's closest Element ancestor, relative to root.
 */
export function getUniqueSelectorContaining(node: Node, root: Element): string | null {
	let doc = node.ownerDocument;
	if (!doc) {
		return null;
	}
	// Get the closest element to the node (which may be the node itself)
	let element = closestElement(node);
	if (!element) {
		return null;
	}
	let originalElement = element;

	let testSelector = (selector: string) => {
		return root.querySelectorAll(selector).length == 1 && root.querySelector(selector) == originalElement;
	};

	let selector = '';
	while (element && element !== root) {
		let joiner = selector ? ' > ' : '';
		if (element.id) {
			return `#${CSS.escape(element.id)}` + joiner + selector;
		}

		let tagName = element.tagName.toLowerCase();

		let prevSibling = element.previousElementSibling;
		if (prevSibling && prevSibling.id) {
			let prevSiblingIDSelector = `#${CSS.escape(prevSibling.id)} + ${tagName}${joiner}${selector}`;
			if (testSelector(prevSiblingIDSelector)) {
				return prevSiblingIDSelector;
			}
		}

		let childPseudoclass;
		if (element.matches(':only-of-type') || element.matches(':only-child')) {
			childPseudoclass = '';
		}
		else if (element.matches(':first-child')) {
			childPseudoclass = ':first-child';
		}
		else if (element.matches(':first-of-type')) {
			childPseudoclass = ':first-of-type';
		}
		else if (element.matches(':last-child')) {
			childPseudoclass = ':last-child';
		}
		else if (element.matches(':last-of-type')) {
			childPseudoclass = ':last-of-type';
		}
		else if (element.parentElement) {
			childPseudoclass = `:nth-child(${[...element.parentElement.children].indexOf(element) + 1})`;
		}
		else {
			break;
		}

		selector = tagName + childPseudoclass + joiner + selector;

		if (testSelector(selector)) {
			return selector;
		}

		element = element.parentElement;
	}
	return null;
}
