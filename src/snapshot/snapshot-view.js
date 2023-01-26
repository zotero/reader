// Basically just need to adapt most of the code from EPUB view

// How about pre-SingleFile web snapshots?
class SnapshotView {
	constructor(options) {
		this._options = options;
		this._iframe = document.createElement('iframe');
		var enc = new TextDecoder("utf-8");
		let text = enc.decode(options.buf);
		this._iframe.sandbox = "allow-same-origin";
		this._iframe.srcdoc = text;
		this._iframe.addEventListener('load', () => {
			this._iframeWindow = this._iframe.contentWindow;
		});
		this._options.container.append(this._iframe);
	}
}
export default SnapshotView;
