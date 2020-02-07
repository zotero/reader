
import {extractText, getRange} from "./extractText"

function quadPointsToRects(quadPoints) {
  let rects = [];
  if (quadPoints.length % 8 === 0) {
    for (let j = 0; j < quadPoints.length; j += 8) {
      let topLeft = {x: quadPoints[j + 4], y: quadPoints[j + 5]};
      let bottomRight = {x: quadPoints[j + 2], y: quadPoints[j + 3]};
      let x = Math.min(topLeft.x, bottomRight.x);
      let y = Math.min(topLeft.y, bottomRight.y);
      let width = Math.abs(topLeft.x - bottomRight.x);
      let height = Math.abs(topLeft.y - bottomRight.y);
      rects.push([x, y, x + width, y + height]);
    }
  }
  else {
    // Necessary because for some annotations pdf.js returns raw quadpoints
    // and for other processed
    // https://github.com/mozilla/pdf.js/blob/9791d7e4d3d077d03e119aa99f6f2dafc01f289d/src/core/annotation.js#L171
    for (let j = 0; j < quadPoints.length; j++) {
      let topLeft = quadPoints[j][0];
      let bottomRight = quadPoints[j][3];
      let x = Math.min(topLeft.x, bottomRight.x);
      let y = Math.min(topLeft.y, bottomRight.y);
      let width = Math.abs(topLeft.x - bottomRight.x);
      let height = Math.abs(topLeft.y - bottomRight.y);
      rects.push([x, y, x + width, y + height]);
    }
  }
  
  return rects;
}

function pdfDateToIsoDate(str) {
  if(typeof str !== "string") return;
  
  let m = str.match(/([0-9]{4})([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)/);
  if (!m) return;
  let d = [];
  for (let i = 1; i <= 6; i++) {
    if (!m[i]) break;
    d.push(parseInt(m[i]));
  }
  
  if (d[1]) {
    d[1] -= 1;
  }
  
  return (new Date(Date.UTC(...d))).toISOString();
}


function pdfColorToHex(color) {
  
  if (!color || color.length !== 3) return "";
  
  let result = "#";
  for (let c of color) {
    let hex = c.toString(16);
    result += hex.length === 1 ? "0" + hex : hex;
  }
  
  return result;
}


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

export async function extractExternalAnnotations() {
  let externalAnnotations = [];
  
  for (let i = 1; i <= window.PDFViewerApplication.pdfDocument.numPages; i++) {
    let page = await window.PDFViewerApplication.pdfViewer.pdfDocument.getPage(i);
    let annotations = await page.getAnnotations();
    
    let textContent = null;
    console.log(i, annotations);
    for (let annotation of annotations) {
      if (annotation.subtype === "Highlight") {
        if (!textContent) {
          textContent = await page.getTextContent();
        }
        
        let quadPoints = annotation.quadPoints;
        
        let chs = [];
        for (let item of textContent.items) {
          for (let ch of item.chars) {
            chs.push(ch);
          }
        }
  
        let highlightedText = extractText(chs, quadPointsToRects(quadPoints));
        
        externalAnnotations.push({
          type: "highlight",
          imported: true,
          position: {
            pageNumber: i,
            rects: quadPointsToRects(quadPoints)
          },
          text: highlightedText,
          comment: annotation.contents,
          dateModified: pdfDateToIsoDate(annotation.dateModified),
          label: annotation.title,
          color: pdfColorToHex(annotation.color),
          tags: []
        });
      }
      else if (['Text'].includes(annotation.subtype) && annotation.rect && annotation.contents) {
        externalAnnotations.push({
          type: 'text',
          imported: true,
          position: {
            pageNumber: i,
            rects: [annotation.rect]
          },
          comment: annotation.contents,
          dateModified: pdfDateToIsoDate(annotation.dateModified),
          label: annotation.title,
          color: pdfColorToHex(annotation.color),
          tags: []
        });
      }
    }
  }
  
  return externalAnnotations;
}

export async function extractRange(position) {
	let page = await window.PDFViewerApplication.pdfViewer.pdfDocument.getPage(position.pageNumber);
	let textContent = await page.getTextContent();
	
	let chs = [];
	for (let item of textContent.items) {
		for (let ch of item.chars) {
			chs.push(ch);
		}
	}
	let range = getRange(chs, position.rects);
	if(!range) return;
	return {
		position: {
			pageNumber: position.pageNumber,
			rects: range.rects
		},
		text: range.text,
		offset: range.offset
	};
}

function pointsDist([x1, y1], [x2, y2]) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
  let left = bx2 < ax1;
  let right = ax2 < bx1;
  let bottom = by2 < ay1;
  let top = ay2 < by1;
  
  if (top && left) {
    return pointsDist([ax1, ay2], [bx2, by1]);
  }
  else if (left && bottom) {
    return pointsDist([ax1, ay1], [bx2, by2]);
  }
  else if (bottom && right) {
    return pointsDist([ax2, ay1], [bx1, by2]);
  }
  else if (right && top) {
    return pointsDist([ax2, ay2], [bx1, by1]);
  }
  else if (left) {
    return ax1 - bx2;
  }
  else if (right) {
    return bx1 - ax2;
  }
  else if (bottom) {
    return ay1 - by2;
  }
  else if (top) {
    return by1 - ay2;
  }
  
  return 0;
}

export async function getClosestOffset(position) {
  let page = await window.PDFViewerApplication.pdfViewer.pdfDocument.getPage(position.pageNumber);
  let textContent = await page.getTextContent();
  let positionRect = position.rects[0];
  
  let chs = [];
  for (let item of textContent.items) {
    for (let ch of item.chars) {
      chs.push(ch);
    }
  }
  
  let minDist = Infinity;
  let minDistChIndex = 0;
  
  for (let i=0;i<chs.length;i++) {
    let ch = chs[i];
    
    let distance = rectsDist(ch.rect, positionRect);
    
    if (distance < minDist) {
      minDist = distance;
      minDistChIndex = i;
    }
  }

  return minDistChIndex;
}

export async function getSortIndex(position) {
  let page = position.pageNumber;
  let offset = await getClosestOffset(position);
  let pageHeight = (await PDFViewerApplication.pdfDocument.getPage(position.pageNumber)).view[3];
  let top = pageHeight - position.rects[0][3];
  return [
    page.toString().padStart(6,'0'),
    offset.toString().padStart(7,'0'),
    parseFloat(top).toFixed(3).padStart(10,'0')
  ].join('|');
}
