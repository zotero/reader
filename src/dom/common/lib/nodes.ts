export function getAllTextNodes(root: Node): Text[] {
	const nodeIterator = root.ownerDocument!.createNodeIterator(root, NodeFilter.SHOW_TEXT);
	const nodes = [];
	let next = null;
	while ((next = nodeIterator.nextNode())) {
		nodes.push(next as Text);
	}
	return nodes;
}

export function getVisibleTextNodes(root: Node): Text[] {
	const range = root.ownerDocument!.createRange();
	return getAllTextNodes(root).filter((node) => {
		range.selectNodeContents(node);
		const rect = range.getBoundingClientRect();
		return rect.width && rect.height;
	});
}

export function isElement(node: Node): node is Element {
	return node.nodeType === Node.ELEMENT_NODE;
}

export function closestElement(node: Node): Element | null {
	let currentNode: Node | null = node;
	while (currentNode && !isElement(currentNode)) {
		currentNode = currentNode.parentNode;
	}
	return currentNode;
}

export const DOMPURIFY_CONFIG = {
	ADD_TAGS: ['html', 'head', 'body', 'link', 'style'],
	// https://github.com/cure53/DOMPurify/blob/c420ec0f4034908a4aea9caf512fb8c1acdec270/src/regexp.js#L10
	// with blob: added
	ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};
