/**
 * Generate a CSS selector uniquely pointing to node's closest Element ancestor, relative to root.
 */
export function getUniqueSelectorContaining(node: Node, root: Element): string | null {
	let doc = node.ownerDocument;
	if (!doc) {
		return null;
	}
	// Get the closest element to the node (which may be the node itself)
	let element = null;
	for (let n: Node | null = node; n !== null; n = n.parentNode) {
		if (n.nodeType == Node.ELEMENT_NODE) {
			element = n as Element;
			break;
		}
	}
	if (!element) {
		return null;
	}
	let selector = '';
	while (element && element !== root) {
		let joiner = selector ? ' > ' : '';
		if (element.id) {
			return `#${element.id.replace(/([^a-zA-Z0-9\u00A0-\uFFFF-_])/g, '\\$1')}` + joiner + selector;
		}
		let tagName = element.tagName.toLowerCase();
		let childSelector;
		if (element.matches(':only-of-type') || element.matches(':only-child')) {
			childSelector = '';
		}
		else if (element.matches(':first-child')) {
			childSelector = ':first-child';
		}
		else if (element.matches(':first-of-type')) {
			childSelector = ':first-of-type';
		}
		else if (element.matches(':last-child')) {
			childSelector = ':last-child';
		}
		else if (element.matches(':last-of-type')) {
			childSelector = ':last-of-type';
		}
		else if (element.parentElement) {
			childSelector = `:nth-child(${[...element.parentElement.children].indexOf(element) + 1})`;
		}
		else {
			break;
		}
		selector = tagName + childSelector + joiner + selector;
		element = element.parentElement;

		if (root.querySelectorAll(selector).length == 1) {
			return selector;
		}
	}
	return null;
}
