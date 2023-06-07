class NavStack<T> {
	private _backStack: T[] = [];
	
	private _forwardStack: T[] = [];
	
	canPopBack(): boolean {
		return !!this._backStack.length;
	}

	canPopForward(): boolean {
		return !!this._backStack.length;
	}
	
	push(value: T) {
		if (this._backStack.length && value === this._backStack[this._backStack.length - 1]) {
			return;
		}
		this._backStack.push(value);
		this._forwardStack.length = 0;
	}
	
	popBack(): T {
		let value = this._backStack.pop();
		if (!value) {
			throw new Error('Back stack empty');
		}
		this._forwardStack.push(value);
		return value;
	}

	popForward(): T {
		let value = this._forwardStack.pop();
		if (!value) {
			throw new Error('Forward stack empty');
		}
		this._backStack.push(value);
		return value;
	}
}

export default NavStack;
