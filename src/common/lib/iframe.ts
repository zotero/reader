/**
 * Load an HTML string into an iframe, resolving once the document and its subresources have loaded
 *
 * We write into about:blank rather than using srcdoc because Gecko prevents about:srcdoc loads in the parent process
 * (where the client reader runs) for security reasons.
 */
export async function loadIFrameHTML(iframe: HTMLIFrameElement, html: string): Promise<void> {
	await new Promise((resolve) => {
		iframe.addEventListener('load', resolve, { once: true });
		iframe.src = 'about:blank';
	});
	let doc = iframe.contentDocument!;
	doc.open();
	// Match srcdoc, which never uses quirks mode (the parser ignores any later doctype in the HTML)
	doc.write('<!DOCTYPE html>');
	doc.write(html);
	doc.close();
	// The iframe doesn't fire another load event after document.open(), so watch readyState instead
	await new Promise<void>((resolve) => {
		let check = () => {
			if (doc.readyState === 'complete') {
				doc.removeEventListener('readystatechange', check);
				resolve();
			}
		};
		doc.addEventListener('readystatechange', check);
		check();
	});
}
