'use strict';

import { hy, p2v, wx } from '../lib/coordinates';

function getDragCanvas() {
  let node = document.getElementById('drag-canvas');
  if (!node) {
    node = document.createElement('canvas');
    node.id = 'drag-canvas';
    document.body.appendChild(node)
  }
  return { canvas: node, context: node.getContext('2d') }
}

function getDragNoteIcon(rect) {
  let node = document.getElementById('drag-note');
  if (!node) {
    node = document.createElement('div');
    let icon = `
      <svg width="24" height="24" viewBox="0 0 24 24">
        <polygon fill="currentColor" points="0.5 0.5 23.5 0.5 23.5 23.5 11.5 23.5 0.5 12.5 0.5 0.5"/>
        <polygon points="0.5 12.5 11.5 12.5 11.5 23.5 0.5 12.5" fill="#fff" opacity="0.4"/>
        <path d="M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z"/>
      </svg>`;
    node.id = 'drag-note';
    node.innerHTML = icon;
    document.body.appendChild(node);
  }
  let width = wx(rect);
  let height = hy(rect);
  node.style.width = width + 'px';
  node.style.height = height + 'px';
  return node;
}

function getDragMultiIcon() {
  let node = document.getElementById('drag-multi');
  if (!node) {
    node = document.createElement('div');
    node.id = 'drag-multi';
    document.body.appendChild(node);
  }
  return node;
}

function drawRects(canvas, context, rects, color) {
  let boundingRect = [
    Math.min(...rects.map(x => x[0])),
    Math.min(...rects.map(x => x[1])),
    Math.max(...rects.map(x => x[2])),
    Math.max(...rects.map(x => x[3]))
  ];

  rects = rects.map(rect => [
    rect[0] - boundingRect[0],
    rect[1] - boundingRect[1],
    rect[2] - boundingRect[0],
    rect[3] - boundingRect[1]
  ]);

  rects = rects.map(rect => [
    rect[0],
    (boundingRect[3] - boundingRect[1]) - rect[1],
    rect[2],
    (boundingRect[3] - boundingRect[1]) - rect[3]
  ]);

  let width = boundingRect[2] - boundingRect[0];
  let height = boundingRect[3] - boundingRect[1];

  canvas.width = width;
  canvas.height = height;

  context.fillStyle = color;
  for (let rect of rects) {
    context.fillRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
  }

  return { width, height };
}

export function setLayerSelectionDragPreview(event, rects, color, pointerPosition) {
  let { canvas, context } = getDragCanvas();

  drawRects(canvas, context, rects, color);

  let boundingRect = [
    Math.min(...rects.map(x => x[0])),
    Math.min(...rects.map(x => x[1])),
    Math.max(...rects.map(x => x[2])),
    Math.max(...rects.map(x => x[3]))
  ];

  let x = pointerPosition.rects[0][0] - boundingRect[0];
  let y = pointerPosition.rects[0][1] - boundingRect[1];
  y = (boundingRect[3] - boundingRect[1]) - y;

  event.dataTransfer.setDragImage(canvas, x, y);
}

export function setLayerSingleDragPreview(event, annotation) {
  let br = event.target.getBoundingClientRect();
  let offsetX = event.clientX - br.left;
  let offsetY = event.clientY - br.top;

  if (annotation.type === 'image') {
    let { canvas, context } = getDragCanvas();
    let x = 0;
    let y = 0;
    let img = document.querySelector('div[data-sidebar-id="' + annotation.id + '"] img');
    if (img) {
      let width = 200;
      let height = 200 * img.height / img.width;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(img, 0, 0, width, height);
      let width1 = event.target.offsetWidth;
      let height1 = event.target.offsetHeight;

      x = offsetX * canvas.width / width1;
      y = offsetY * canvas.height / height1;
    }
    else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    event.dataTransfer.setDragImage(canvas, x, y);
  }
  else if (annotation.type === 'highlight') {
    let { canvas, context } = getDragCanvas();
    drawRects(canvas, context, annotation.position.rects, annotation.color);
    let width = event.target.offsetWidth - 10;
    let height = event.target.offsetHeight - 10;

    let x = offsetX * canvas.width / width;
    let y = offsetY * canvas.height / height;

    event.dataTransfer.setDragImage(canvas, x, y);
  }
  else if (annotation.type === 'note') {
    let viewport = window.PDFViewerApplication.pdfViewer.getPageView(annotation.position.pageIndex).viewport;
    let position = p2v(annotation.position, viewport)
    let icon = getDragNoteIcon(position.rects[0]);
    let dashedBorderPadding = 5;
    let width = event.target.offsetWidth - dashedBorderPadding * 2;
    let height = event.target.offsetHeight - dashedBorderPadding * 2;
    let x = width / 2;
    let y = height / 2;
    icon.style.color = annotation.color;
    event.dataTransfer.setDragImage(icon, x, y);
  }
}

export function setSidebarSingleDragPreview(event) {
  let target = event.target.closest('.preview');

  let br = target.getBoundingClientRect();
  let offsetX = event.clientX - br.left;
  let offsetY = event.clientY - br.top;

  let x = offsetX;
  let y = offsetY;

  event.dataTransfer.setDragImage(event.target.closest('.annotation'), x, y);
}

export function setMultiDragPreview(event, num) {
  let icon = getDragMultiIcon();
  event.dataTransfer.setDragImage(icon, 0, 0);
}
