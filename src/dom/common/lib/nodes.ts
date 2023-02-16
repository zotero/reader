export function getAllTextNodes(root: Node): Text[] {
	const nodeIterator = root.ownerDocument!.createNodeIterator(root, NodeFilter.SHOW_TEXT);
	const nodes = [];
	let next = null;
	while ((next = nodeIterator.nextNode())) {
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
