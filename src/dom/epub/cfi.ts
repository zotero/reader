export function shortenCFI(cfi: string): string {
	return cfi.replace(/^epubcfi\((.+)\)$/, '$1');
}

export function lengthenCFI(cfi: string): string {
	if (cfi.startsWith('epubcfi(') && cfi.endsWith(')')) {
		return cfi;
	}
	else {
		return `epubcfi(${cfi})`;
	}
}
