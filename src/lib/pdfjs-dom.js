'use strict';

export function getPageFromElement(target) {
  let node = target.closest('.pdfViewer > .page');
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
