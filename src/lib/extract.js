'use strict';

import { extractRange as getRange } from './text/range';
import { getClosestOffset } from './text/offset';

export async function getAnnotationsCount() {
  let count = 0;
  
  for (let i = 1; i <= window.PDFViewerApplication.pdfDocument.numPages; i++) {
    let page = await window.PDFViewerApplication.pdfViewer.pdfDocument.getPage(i);
    let annotations = await page.getAnnotations();
    for (let annotation of annotations) {
      if (['Text', 'Highlight'].includes(annotation.subtype)) {
        count++;
      }
    }
  }
  
  return count;
}

async function getPageChs(pageIndex) {
  let page = await window.PDFViewerApplication.pdfViewer.pdfDocument.getPage(pageIndex + 1);
  let textContent = await page.getTextContent();
  
  let chs = [];
  for (let item of textContent.items) {
    for (let ch of item.chars) {
      chs.push(ch);
    }
  }
  return chs;
}

export async function extractRange(position) {
  let chs = await getPageChs(position.pageIndex);
  let range = getRange(chs, position.rects);
  if (!range) return;
  return {
    position: {
      pageIndex: position.pageIndex,
      rects: range.rects
    },
    text: range.text,
    offset: range.offset
  };
}

export async function getSortIndex(position) {
  let chs = await getPageChs(position.pageIndex);
  let page = position.pageIndex;
  let offset = getClosestOffset(chs, position.rects[0]);
  let pageHeight = (await PDFViewerApplication.pdfDocument.getPage(position.pageIndex + 1)).view[3];
  let top = pageHeight - position.rects[0][3];
  return [
    page.toString().padStart(6, '0'),
    offset.toString().padStart(7, '0'),
    parseFloat(top).toFixed(3).padStart(10, '0')
  ].join('|');
}
