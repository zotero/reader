import { p2v, v2p, wx, hy } from "./coordinates";


export async function renderSquareImage(position) {
  let page = await PDFViewerApplication.pdfDocument.getPage(position.pageNumber);
  let viewport = page.getViewport({ scale: 1.5 });
  
  position = p2v(position, viewport);
  
  let canvasWidth = viewport.width;
  let canvasHeight = viewport.height;
  
  let canvas = document.createElement("canvas");
  
  if (typeof PDFJSDev === "undefined" ||
    PDFJSDev.test("MOZCENTRAL || FIREFOX || GENERIC")) {
    canvas.mozOpaque = true;
  }
  let ctx = canvas.getContext("2d", { alpha: false });
  
  canvas.width = (canvasWidth * 1) | 0;
  canvas.height = (canvasHeight * 1) | 0;
  canvas.style.width = canvasWidth + "px";
  canvas.style.height = canvasHeight + "px";
  
  let renderContext = {
    canvasContext: ctx,
    viewport: viewport
  };
  
  await page.render(renderContext);
  
  const rect = position.rects[0];
  
  const left = rect[0];
  const top = rect[1];
  const width = wx(rect);
  const height = hy(rect);
  
  const newCanvas = document.createElement("canvas");
  
  if (!(newCanvas instanceof HTMLCanvasElement)) {
    return "";
  }
  
  newCanvas.width = width;
  newCanvas.height = height;
  
  const newCanvasContext = newCanvas.getContext("2d");
  
  if (!newCanvasContext || !canvas) {
    return "";
  }
  
  newCanvasContext.drawImage(
    canvas,
    left,
    top,
    width,
    height,
    0,
    0,
    width,
    height
  );
  
  return newCanvas.toDataURL("image/jpeg", 1);
}
