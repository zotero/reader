const fs = require('fs');

function modifyWeb() {
	let filename = './build/web/viewer.html';
	let html = fs.readFileSync(filename).toString();
	
	let ins = `
<link rel="resource" type="application/l10n" href="data:text/plain,">
<script src="pdf.js"></script>
<script src="viewer.js"></script>
<script src="annotator.js"></script>
`;
	
	html = html.replace(/<!-- This snippet(.*)<\/head>/s, ins + "</head>");
	
	fs.writeFileSync(filename, html);
}

function modifyZotero() {
	let filename = './build/zotero/viewer.html';
	let html = fs.readFileSync(filename).toString();
	
	let ins = `
<link rel="resource" type="application/l10n" href="data:text/plain,">
<script src="pdf.js"></script>
<script src="viewer.js"></script>


<style>
  * {
    transition-property: none !important;
  }
</style>
<script>delete window.performance</script>
<script src="resource://zotero/react.js"></script>
<script src="resource://zotero/react-dom.js"></script>
<script src="resource://zotero/react-draggable.js"></script>
<script src="resource://zotero/re-resizable.js"></script>
<script src="annotator.js"></script>
`;
	
	html = html.replace(/<!-- This snippet(.*)<\/head>/s, ins + "</head>");
	
	fs.writeFileSync(filename, html);
}

modifyWeb();
modifyZotero();
