export async function renderMath(doc: Document) {
	// We use the text/x-mathjax-config script as a signal to detect MathJax
	// because that's what Calibre (and Apple Books?) does, but we don't
	// actually want to evaluate arbitrary JS.
	//
	// If your config is very bespoke, sorry about that!
	// Hopefully the defaults are OK.

	let mathjaxConfigScript = doc.querySelector('script[type="text/x-mathjax-config"]');
	if (!mathjaxConfigScript) {
		return;
	}

	(await import('./math-internal')).renderMathInternal(doc);
}

export function closestMathTeX(el: Element): string | null {
	return (el.closest('mjx-container') as HTMLElement | null)
		?.dataset.tex ?? null;
}
