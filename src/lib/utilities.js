'use strict';

export function copyToClipboard(str) {
  let el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

export function deselect() {
  let selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
  if (!!selection) selection.empty ? selection.empty() : selection.removeAllRanges();
}

export function getClientRects(range, containerEl) {
  let clientRects = Array.from(range.getClientRects());
  let offset = containerEl.getBoundingClientRect();
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
  return function () {
    let context = this, args = arguments;
    let later = function () {
      timeout = null;
      fn.apply(context, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// https://github.com/jashkenas/underscore/blob/master/underscore.js
// (c) 2009-2018 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
// Underscore may be freely distributed under the MIT license.
// Returns a function, that, when invoked, will only be triggered at most once
// during a given window of time. Normally, the throttled function will run
// as much as it can, without ever going more than once per `wait` duration;
// but if you'd like to disable the execution on the leading edge, pass
// `{leading: false}`. To disable execution on the trailing edge, ditto.
export function throttle(func, wait, options) {
  var context, args, result;
  var timeout = null;
  var previous = 0;
  if (!options) options = {};
  var later = function () {
    previous = options.leading === false ? 0 : Date.now();
    timeout = null;
    result = func.apply(context, args);
    if (!timeout) context = args = null;
  };
  return function () {
    var now = Date.now();
    if (!previous && options.leading === false) previous = now;
    var remaining = wait - (now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    }
    else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };
}

export function getPageFromElement(target) {
  let node = target.closest('.page');
  if (!node) {
    return null;
  }
  
  let number = parseInt(node.dataset.pageNumber);
  return { node, number };
}

export function getPageFromRange(range) {
  let parentElement = range.startContainer.parentElement;
  if (!parentElement) {
    return;
  }
  
  return getPageFromElement(parentElement);
}

export function findOrCreateContainerLayer(container, className) {
  let layer = container.querySelector('.' + className);
  
  if (!layer) {
    layer = document.createElement('div');
    layer.className = className;
    container.appendChild(layer);
  }
  
  return layer;
}

export function formatAnnotationText(annotation) {
  let parts = [];
  
  if (annotation.comment) {
    parts.push(annotation.comment + ':');
  }
  
  if (annotation.text) {
    parts.push('"' + annotation.text + '"');
  }
  
  return parts.join(' ');
}

export function equalPositions(annotation1, annotation2) {
  let p1 = annotation1.position;
  let p2 = annotation2.position;
  return (
    p1.pageIndex === p2.pageIndex &&
    JSON.stringify(p1.rects) === JSON.stringify(p2.rects)
  );
}
