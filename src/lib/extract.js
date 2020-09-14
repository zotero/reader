'use strict';

import { extractRange as getRange } from './text/range';
import { getClosestOffset } from './text/offset';
import { getPageLabelPoints, getPageLabel } from './text/page';

window.chsCache = {};

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

export async function getPageChs(pageIndex) {
  if (window.chsCache[pageIndex]) return window.chsCache[pageIndex];

  let page = await window.PDFViewerApplication.pdfViewer.pdfDocument.getPage(pageIndex + 1);
  let textContent = await page.getTextContent();

  let chs = [];
  for (let item of textContent.items) {
    for (let ch of item.chars) {
      chs.push(ch);
    }
  }

  window.chsCache[pageIndex] = chs;
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
    page.toString().padStart(5, '0'),
    offset.toString().padStart(6, '0'),
    Math.round(parseFloat(top)).toString().padStart(5, '0')
  ].join('|');
}

export async function extractPageLabelPoints() {
  window.chsCache = {}; // TODO: Remove for production
  for (let i = 0; i < 5 && i + 3 < PDFViewerApplication.pdfDocument.numPages; i++) {
    let pageHeight = (await PDFViewerApplication.pdfDocument.getPage(i + 1)).view[3];
    let chs1 = await getPageChs(i);
    let chs2 = await getPageChs(i + 1);
    let chs3 = await getPageChs(i + 2);
    let chs4 = await getPageChs(i + 3);
    let res = await getPageLabelPoints(i, chs1, chs2, chs3, chs4, pageHeight);
    if (res) {
      return res;
    }
  }
  return null;
}

export async function extractPageLabel(pageIndex, points) {
  let chsPrev, chsCur, chsNext;
  if (pageIndex > 0) {
    chsPrev = await getPageChs(pageIndex - 1);
  }
  chsCur = await getPageChs(pageIndex);

  if (pageIndex < PDFViewerApplication.pdfDocument.numPages - 1) {
    chsNext = await getPageChs(pageIndex + 1);
  }
  return getPageLabel(pageIndex, chsPrev, chsCur, chsNext, points);
}
