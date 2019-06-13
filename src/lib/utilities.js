export function copyToClipboard(str) {
  const el = document.createElement("textarea");
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function getClientRects (range, containerEl) {
  let clientRects = Array.from(range.getClientRects());
  
  const offset = containerEl.getBoundingClientRect();
  
  let rects = clientRects.map(rect => {
    return {
      top: rect.top + containerEl.scrollTop - offset.top - 10,
      left: rect.left + containerEl.scrollLeft - offset.left - 9,
      width: rect.width,
      height: rect.height
    };
  });

  rects = rects.map(rect => {
    return [
      rect.left,
      rect.top,
      rect.left + rect.width,
      rect.top + rect.height
    ];
  });
  
  return rects;
}

export function debounce(fn, wait) {
	let timeout;
	return function() {
		let context = this, args = arguments;
		let later = function() {
			timeout = null;
			fn.apply(context, args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
}
