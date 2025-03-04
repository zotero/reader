import React from 'react';
import ViewPopup from '../common/view-popup';
import cx from 'classnames';

function FootnotePopup({ params, onOpenLink }) {
	let iframeRef = React.useRef(null);
	let [loading, setLoading] = React.useState(true);

	React.useEffect(() => {
		setLoading(true);
	}, [params.content]);

	let handleLoad = () => {
		if (iframeRef.current) {
			let iframe = iframeRef.current;

			let contentStyleSheet = new iframe.contentWindow.CSSStyleSheet();
			contentStyleSheet.replaceSync(params.css);
			iframe.contentDocument.body.classList.add('footnote-popup-content');
			iframe.contentDocument.adoptedStyleSheets.push(contentStyleSheet);

			iframe.style.height = '0';
			iframe.style.height = iframe.contentWindow.document.documentElement.scrollHeight + 'px';

			let resizeObserver = new ResizeObserver(() => {
				if (!iframe.contentWindow) {
					resizeObserver.disconnect();
					return;
				}
				iframe.style.height = '0';
				iframe.style.height = iframe.contentWindow.document.documentElement.scrollHeight + 'px';
			});
			resizeObserver.observe(iframe.contentDocument.body);

			let handleClick = (event) => {
				event.preventDefault();
				let link = event.target.closest('a[href]');
				if (link) {
					onOpenLink(link.href);
				}
			};
			iframe.contentDocument.addEventListener('click', handleClick);
		}
		setLoading(false);
	};

	return (
		<ViewPopup
			className={cx('footnote-popup', { loading })}
			rect={params.rect}
			uniqueRef={loading ? {} : params.ref}
			padding={loading ? 0 : 10}
		>
			<iframe
				ref={iframeRef}
				sandbox="allow-same-origin"
				srcDoc={params.content}
				onLoad={handleLoad}
			/>
		</ViewPopup>
	);
}

export default FootnotePopup;
