'use strict';

export function copyToClipboard(str) {
  let el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
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
