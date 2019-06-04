
// https://github.com/agentcooper/react-pdf-highlighter
import optimizeClientRects from "./optimize-client-rects";

const getClientRects = (
  range,
  containerEl,
  shouldOptimize = true
) => {
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
  
  rects = optimizeClientRects(rects);
  
  rects = rects.map(rect => {
    return [
      rect.left,
      rect.top,
      rect.left + rect.width,
      rect.top + rect.height
    ];
  });
  
  return rects;
};

export default getClientRects;
