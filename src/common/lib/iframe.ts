/**
 * Load an HTML string into an iframe, resolving once the document and its subresources have loaded
 *
 * Gecko refuses to load about:srcdoc in the parent process, where the reader runs in the Zotero client,
 * so unless `useSrcDoc` is set, the iframe loads about:blank and the HTML is written into it.
 */
export function loadIFrameHTML(iframe: HTMLIFrameElement, html: string, useSrcDoc: boolean): Promise<void> {
	return new Promise<void>((resolve) => {
		if (useSrcDoc) {
			iframe.addEventListener('load', () => resolve(), { once: true });
			iframe.srcdoc = html;
			return;
		}
		iframe.addEventListener('load', () => {
			let doc = iframe.contentDocument!;
			doc.open();
			// srcdoc documents are never in quirks mode, so start with a doctype that selects standards mode
			// (the parser ignores any later doctype in the HTML)
			doc.write('<!DOCTYPE html>');
			doc.write(html);
			doc.close();
			// Calling document.open() inside the iframe's load handler suppresses the next iframe load event,
			// so wait for the document to finish loading via readyState instead
			if (doc.readyState === 'complete') {
				resolve();
				return;
			}
			let handleReadyStateChange = () => {
				if (doc.readyState === 'complete') {
					doc.removeEventListener('readystatechange', handleReadyStateChange);
					resolve();
				}
			};
			doc.addEventListener('readystatechange', handleReadyStateChange);
		}, { once: true });
		iframe.src = 'about:blank';
	});
}
