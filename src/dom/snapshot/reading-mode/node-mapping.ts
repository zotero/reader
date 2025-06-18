export class NodeMapping {
	private readonly _preToPost = new Map<Node, Node>();

	private readonly _postToPre = new Map<Node, Node>();

	get size() {
		return this._preToPost.size;
	}

	[Symbol.iterator](): MapIterator<[Node, Node]> {
		return this._preToPost[Symbol.iterator]();
	}

	clear(): void {
		this._preToPost.clear();
		this._postToPre.clear();
	}

	deleteByPre(preKey: Node): boolean {
		if (!this._preToPost.has(preKey)) {
			return false;
		}
		let postKey = this._preToPost.get(preKey);
		this._preToPost.delete(preKey);
		this._postToPre.delete(postKey!);
		return true;
	}

	deleteByPost(postKey: Node): boolean {
		if (!this._postToPre.has(postKey)) {
			return false;
		}
		let preKey = this._postToPre.get(postKey);
		this._preToPost.delete(preKey!);
		this._postToPre.delete(postKey);
		return true;
	}

	entries(): MapIterator<[Node, Node]> {
		return this._preToPost.entries();
	}

	forEach(callbackfn: (value: Node, key: Node, map: Map<Node, Node>) => void, thisArg?: any): void {
		this._preToPost.forEach(callbackfn, thisArg);
	}

	getByPre(preKey: Node): Node | undefined {
		return this._preToPost.get(preKey);
	}

	getByPost(postKey: Node): Node | undefined {
		return this._postToPre.get(postKey);
	}

	hasByPre(preKey: Node): boolean {
		return this._preToPost.has(preKey);
	}

	hasByPost(postKey: Node): boolean {
		return this._postToPre.has(postKey);
	}

	preKeys(): MapIterator<Node> {
		return this._preToPost.keys();
	}

	postKeys(): MapIterator<Node> {
		return this._postToPre.keys();
	}

	setByPre(preKey: Node, postKey: Node): this {
		if (preKey.getRootNode() === postKey.getRootNode()) {
			throw new Error('Nodes are in same root');
		}
		this._preToPost.set(preKey, postKey);
		this._postToPre.set(postKey, preKey);
		return this;
	}
}
