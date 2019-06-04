export const p2v = (position, viewport) => {
  return {
    pageNumber: position.pageNumber,
    rects: position.rects.map(rect => {
      const [x1, y2] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y1] = viewport.convertToViewportPoint(rect[2], rect[3]);
      return [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2)
      ];
    })
  };
};

export const v2p = (position, viewport) => {
  return {
    pageNumber: position.pageNumber,
    rects: position.rects.map(rect => {
      const [x1, y2] = viewport.convertToPdfPoint(rect[0], rect[1]);
      const [x2, y1] = viewport.convertToPdfPoint(rect[2], rect[3]);
      return [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2)
      ];
    })
  };
};

export const wx = (rect) => {
  return rect[2] - rect[0];
};

export const hy = (rect) => {
  return rect[3] - rect[1];
};
