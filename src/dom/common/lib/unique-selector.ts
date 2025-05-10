/**
 * Generate a CSS selector uniquely pointing to the element, relative to root.
 */
export function getUniqueSelectorContaining(element: Element): string | null {
	let root = element.closest('body');
	if (!root) {
		throw new Error('Element has no body ancestor');
	}

	let testSelector = (selector: string) => {
		return root.querySelectorAll(selector).length == 1 && root.querySelector(selector) == element;
	};

	let currentElement: Element | null = element;
	let selector = '';
	while (currentElement && currentElement !== root) {
		let joiner = selector ? ' > ' : '';
		if (currentElement.id) {
			return `#${CSS.escape(currentElement.id)}` + joiner + selector;
		}

		let tagName = currentElement.tagName.toLowerCase();

		let prevSibling = currentElement.previousElementSibling;
		if (prevSibling && prevSibling.id) {
			let prevSiblingIDSelector = `#${CSS.escape(prevSibling.id)} + ${tagName}${joiner}${selector}`;
			if (testSelector(prevSiblingIDSelector)) {
				return prevSiblingIDSelector;
			}
		}

		let childPseudoclass;
		if (currentElement.matches(':only-of-type') || currentElement.matches(':only-child')) {
			childPseudoclass = '';
		}
		else if (currentElement.matches(':first-child')) {
			childPseudoclass = ':first-child';
		}
		else if (currentElement.matches(':first-of-type')) {
			childPseudoclass = ':first-of-type';
		}
		else if (currentElement.matches(':last-child')) {
			childPseudoclass = ':last-child';
		}
		else if (currentElement.matches(':last-of-type')) {
			childPseudoclass = ':last-of-type';
		}
		else if (currentElement.parentElement) {
			childPseudoclass = `:nth-child(${[...currentElement.parentElement.children].indexOf(currentElement) + 1})`;
		}
		else {
			break;
		}

		selector = tagName + childPseudoclass + joiner + selector;

		if (testSelector(selector)) {
			return selector;
		}

		currentElement = currentElement.parentElement;
	}
	return null;
}
