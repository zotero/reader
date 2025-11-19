export default class LRUCacheMap<K, V> extends Map<K, V> {
	private readonly _capacity: number;

	constructor(capacity = 500) {
		super();
		this._capacity = capacity;
	}

	override get(key: K): V | undefined {
		let value = super.get(key);
		if (value !== undefined) {
			super.delete(key);
			super.set(key, value);
		}
		return value;
	}

	override set(key: K, value: V): this {
		if (super.has(key)) {
			super.delete(key);
		}
		else if (super.size === this._capacity) {
			super.delete(super.keys().next().value!);
		}
		super.set(key, value);
		return this;
	}
}
