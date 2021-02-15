let cache = {};

function htmlSlice(node, data) {
	for (let i = 0; i < node.childNodes.length; i++) {
		let childNode = node.childNodes[i];
		if (childNode.nodeType === Node.ELEMENT_NODE) {

			if (childNode.nodeName === 'BR') {
				data.length += 1;
				if (data.length >= data.maxLength) {
					node.removeChild(childNode);
					i--;
				}
				continue;
			}

			htmlSlice(childNode, data)
		}
		else if (childNode.nodeType === Node.TEXT_NODE) {
			if (data.maxLength && data.length >= data.maxLength) {
				node.removeChild(childNode);
				i--;
			}
			else {
				data.length += childNode.textContent.length;
				let diffLength = data.length - data.maxLength;
				if (diffLength > 0) {
					childNode.textContent = childNode.textContent.slice(0, childNode.textContent.length - diffLength);
					if (!childNode.textContent.length) {
						node.removeChild(childNode);
						i--;
					}
				}
			}
		}
	}
}

export async function lineClamp(html, container) {
	return new Promise(function (resolve) {
		requestAnimationFrame(function () {
			setTimeout(function () {
				let lineHeight = parseFloat(window.getComputedStyle(container).lineHeight);
				let width = parseFloat(window.getComputedStyle(container).width);
				let height = parseFloat(window.getComputedStyle(container).height);
				let linesNum = height / lineHeight;

				if (cache[(width + html)]) return resolve(cache[(width + html)]);
				requestAnimationFrame(function write() {
					let outer = document.createElement('div');
					outer.className = 'outer';

					let rootElement = document.createElement('div');
					rootElement.className = 'inner';
					rootElement.innerHTML = html;
					outer.appendChild(rootElement)
					container.appendChild(outer);

					let data = { length: 0, maxLength: Math.floor(width / 2 * linesNum) };
					htmlSlice(rootElement, data);
					let originalHtml = rootElement.innerHTML;

					let start = 1;
					let end = data.length;
					let mid = null;
					let longestLength = 0;
					let longestHtml = null;

					function read() {
						if (mid) {
							if (Math.abs(rootElement.offsetHeight - outer.offsetHeight) <= 1) {
								if (mid > longestLength) {
									longestLength = mid;
									longestHtml = rootElement.innerHTML;
								}
								start = mid + 1;
							}
							else {
								end = mid - 1;
							}
						}
						else {
							if (Math.abs(rootElement.offsetHeight - outer.offsetHeight) <= 1) {
								let clampedHtml = rootElement.innerHTML;
								cache[(width + html)] = clampedHtml;
								container.removeChild(outer);
								return resolve(html);
							}
						}

						if (start > end) {
							return requestAnimationFrame(function write() {
								rootElement.innerHTML = longestHtml;
								let text = rootElement.textContent;
								let truncatedText = text.replace(/[ .,;!?'‘’“”\-–—\u2026]+$/, '');
								let diff = text.length - truncatedText.length - 1;
								if (diff) {
									rootElement.innerHTML = originalHtml;
									htmlSlice(rootElement, { length: 0, maxLength: longestLength - diff })
									rootElement.appendChild(document.createTextNode('\u2026'));
								}

								let clampedHtml = rootElement.innerHTML;

								cache[(width + html)] = clampedHtml;
								container.removeChild(outer);
								resolve(clampedHtml);
							});
						}

						mid = parseInt((start + end) / 2);

						window.requestAnimationFrame(function write() {
							rootElement.innerHTML = originalHtml;
							htmlSlice(rootElement, { length: 0, maxLength: mid })
							rootElement.appendChild(document.createTextNode('\u2026'));
							setTimeout(read, 0)
						});
					}

					setTimeout(read, 0);
				});
			}, 0)
		});
	});
}
