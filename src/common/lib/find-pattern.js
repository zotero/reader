// Find patterns use the strict Unicode-mode regex grammar, both for validation
// in the find popup and for matching in the view-specific find implementations
export function compileFindRegExp(source, flags = '') {
	try {
		return new RegExp(source, flags + 'u');
	}
	catch (e) {
		return null;
	}
}
