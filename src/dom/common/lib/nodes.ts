export function getVisibleTextNodes(root: Node): Text[] {
	const range = root.ownerDocument!.createRange();
	const nodeIterator = root.ownerDocument!.createNodeIterator(root, NodeFilter.SHOW_TEXT);
	const nodes = [];
	let next = null;
	while ((next = nodeIterator.nextNode())) {
		range.selectNodeContents(next);
		const rect = range.getBoundingClientRect();
		if (!rect.width || !rect.height) continue;
		nodes.push(next as Text);
	}
	return nodes;
}

export function closestElement(node: Node): Element | null {
	let currentNode: Node | null = node;
	while (currentNode && currentNode.nodeType !== Node.ELEMENT_NODE) {
		currentNode = node.parentNode;
	}
	return currentNode as Element | null;
}

export const DOMPURIFY_CONFIG = {
	ADD_TAGS: ['html', 'head', 'body', 'link', 'style'],
	// https://github.com/cure53/DOMPurify/blob/c420ec0f4034908a4aea9caf512fb8c1acdec270/src/regexp.js#L10
	// with blob: added
	ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};
