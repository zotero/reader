export function getAllTextNodes(root: Node): Text[] {
	const nodeIterator = root.ownerDocument!.createNodeIterator(root, NodeFilter.SHOW_TEXT);
	const nodes = [];
	let next = null;
	while ((next = nodeIterator.nextNode())) {
		nodes.push(next as Text);
	}
	return nodes;
}
