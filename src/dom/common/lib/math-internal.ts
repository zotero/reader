import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html";
import { mathjax } from "mathjax-full/js/mathjax";
import { TeX } from "mathjax-full/js/input/tex";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages";
import { HTMLDocument } from "mathjax-full/js/handlers/html/HTMLDocument";
import { CHTML } from "mathjax-full/js/output/chtml";
import { HTMLAdaptor } from "mathjax-full/js/adaptors/HTMLAdaptor";

let registered = false;

export function renderMathInternal(doc: Document) {
	if (!registered) {
		// MathJax wants nodeValue not to be nullable, so we have to cast to any. It'll be fine.
		RegisterHTMLHandler(new HTMLAdaptor((doc.defaultView ?? window) as any));
		registered = true;
	}

	let mjDoc = mathjax.document(doc, {
		InputJax: new TeX({ packages: AllPackages }),
		OutputJax: new CHTML({ fontURL: new URL('mathjax-fonts', document.location.href).toString() })
	}) as HTMLDocument<Node, Text, Document>;
	mjDoc.render();
	for (let item of mjDoc.math) {
		if (item.typesetRoot.nodeType === Node.ELEMENT_NODE) {
			(item.typesetRoot as HTMLElement).dataset.tex = item.math;
		}
	}
}
