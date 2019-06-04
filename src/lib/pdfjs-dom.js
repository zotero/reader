export const getPageFromElement = (target) => {
  const node = target.closest(".page");
  
  if (!(node instanceof window.HTMLElement)) {
    return null;
  }
  
  const number = Number(node.dataset.pageNumber);
  
  return { node, number };
};

export const getPageFromRange = (range) => {
  const parentElement = range.startContainer.parentElement;
  
  if (!(parentElement instanceof window.HTMLElement)) {
    return;
  }
  
  return getPageFromElement(parentElement);
};

export const findOrCreateContainerLayer = (
  container,
  className
) => {
  let layer = container.querySelector(`.${className}`);
  
  if (!layer) {
    layer = document.createElement("div");
    layer.className = className;
    container.appendChild(layer);
  }
  
  return layer;
};
