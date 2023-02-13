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
		this._backStack.push(value);
		this._forwardStack.length = 0;
	}
	
	popBack(): T {
		const value = this._backStack.pop();
		if (!value) {
			throw new Error('Back stack empty');
		}
		this._forwardStack.push(value);
		return value;
	}

	popForward(): T {
		const value = this._forwardStack.pop();
		if (!value) {
			throw new Error('Forward stack empty');
		}
		this._backStack.push(value);
		return value;
	}
}

export default NavStack;
