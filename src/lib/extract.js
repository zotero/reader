
import {extractText, getRange} from "./extractText"

function quadPointsToRects(quadPoints) {
  let rects = [];
  for (let j = 0; j < quadPoints.length; j += 8) {
    let topLeft = { x: quadPoints[j + 4], y: quadPoints[j + 5] };
    let bottomRight = { x: quadPoints[j + 2], y: quadPoints[j + 3] };
    let x = Math.min(topLeft.x, bottomRight.x);
    let y = Math.min(topLeft.y, bottomRight.y);
    let width = Math.abs(topLeft.x - bottomRight.x);
    let height = Math.abs(topLeft.y - bottomRight.y);
    rects.push([x, y, x + width, y + height]);
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

export async function extractExternalAnnotations() {
  let supportedTypes = [
    "Text",
    "Line",
    "Square",
    "Circle",
    "PolyLine",
    "Polygon",
    "Ink",
    "Highlight",
    "Underline",
    "Squiggly",
    "StrikeOut",
    "Stamp",
    "FileAttachment"
  ];
  
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
          external: true,
          position: {
            pageNumber: i,
            rects: quadPointsToRects(quadPoints)
          },
          text: highlightedText,
          comment: annotation.contents,
          dateModified: pdfDateToIsoDate(annotation.dateModified),
          label: annotation.title,
          color: pdfColorToHex(annotation.color)
        });
      }
      else if (supportedTypes.includes(annotation.subtype) && annotation.rect) {
        externalAnnotations.push({
          type: annotation.subtype,
          external: true,
          position: {
            pageNumber: i,
            rects: [annotation.rect]
          },
          comment: annotation.contents,
          dateModified: pdfDateToIsoDate(annotation.dateModified),
          label: annotation.title,
          color: pdfColorToHex(annotation.color)
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
		text: range.text
	};
}
