import { getLines } from './structure'

function isDash(c) {
  let re = /[\x2D\u058A\u05BE\u1400\u1806\u2010-\u2015\u2E17\u2E1A\u2E3A\u2E3B\u301C\u3030\u30A0\uFE31\uFE32\uFE58\uFE63\uFF0D]/;
  return re.test(c);
}

function quickIntersectRect(r1, r2) {
  return !(r2[0] > r1[2] ||
    r2[2] < r1[0] ||
    r2[1] > r1[3] ||
    r2[3] < r1[1]);
}

function getPoints(chs, rects) {
  let r;
  r = rects[0];
  let n = 0;
  
  let chStart = null;
  let chStartNum = Infinity;
  
  let chPrev = null;
  for (let ch of chs) {
    n++;
    let centerRect = [
      ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
      ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2,
      ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
      ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2
    ];
    if (quickIntersectRect(centerRect, r) && chStartNum > n) {
      chStart = ch;
      chStartNum = n;
    }
    chPrev = ch;
  }
  
  n = 0;
  r = rects.slice(-1)[0];
  let chEnd = null;
  let chEndNum = 0;
  
  chPrev = null;
  for (let i = 0; i < chs.length; i++) {
    let ch = chs[i];
    n++;
    let centerRect = [
      ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
      ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2,
      ch.rect[0] + (ch.rect[2] - ch.rect[0]) / 2,
      ch.rect[1] + (ch.rect[3] - ch.rect[1]) / 2
    ];
    
    if (quickIntersectRect(centerRect, r) && n > chEndNum) {
      chEnd = ch;
      chEndNum = n;
      chPrev = ch;
    }
  }
  
  if (chStartNum < chEndNum) {
    return { chStart, chEnd }
  }
  else {
    return null;
  }
}

function filter(chs) {
  return chs.filter(ch => {
    ch.rotation = ch.rotation / 90;
    if (ch.rotation && ch.rotation % 1 !== 0) return false;
    if (ch.c === ' ') return false;
    return true;
  })
}

export function extractRange(chs, rects) {
  if (!rects.length) return;
  chs = filter(chs);
  let lines = getLines(chs);
  let chPoints = getPoints(chs, rects);
  if (!chPoints) return;
  let { chStart, chEnd } = chPoints;
  
  let text = '';
  let extracting = false;
  for (let line of lines) {
    for (let j = 0; j < line.words.length; j++) {
      let word = line.words[j];
      for (let i = 0; i < word.chs.length; i++) {
        let ch = word.chs[i];
        
        if (ch === chStart) {
          extracting = true;
        }
        
        if (!extracting) continue;
        
        if (j === line.words.length - 1 && i === word.chs.length - 1) {
          if (isDash(ch.c)) {
            continue;
          }
        }
        
        text += ch.c;
        
        if (i === word.chs.length - 1 && word.spaceAfter) {
          text += ' ';
        }
        
        if (j === line.words.length - 1 && i === word.chs.length - 1 && text.slice(-1) !== ' ') {
          text += ' ';
        }
        
        if (ch === chEnd) {
          extracting = false;
        }
      }
    }
  }
  
  let allRects = [];
  extracting = false;
  let lineChStart = null;
  let lineChEnd = null;
  for (let line of lines) {
    for (let j = 0; j < line.words.length; j++) {
      let word = line.words[j];
      for (let i = 0; i < word.chs.length; i++) {
        let ch = word.chs[i];
        
        if (ch === chStart || extracting && !lineChStart) {
          extracting = true;
          lineChStart = ch;
        }
        
        if (extracting) {
          lineChEnd = ch;
        }
        
        if (ch === chEnd) {
          extracting = false;
          let rect;
          if (line.vertical) {
            rect = [line.rect[0], Math.min(lineChStart.rect[1], lineChEnd.rect[1]), line.rect[2], Math.max(lineChStart.rect[3], lineChEnd.rect[3])];
          }
          else {
            rect = [Math.min(lineChStart.rect[0], lineChEnd.rect[0]), line.rect[1], Math.max(lineChStart.rect[2], lineChEnd.rect[2]), line.rect[3]];
          }
          
          allRects.push(rect);
        }
      }
    }
    
    if (extracting) {
      let rect;
      if (line.vertical) {
        rect = [line.rect[0], Math.min(lineChStart.rect[1], lineChEnd.rect[1]), line.rect[2], Math.max(lineChStart.rect[3], lineChEnd.rect[3])];
      }
      else {
        rect = [Math.min(lineChStart.rect[0], lineChEnd.rect[0]), line.rect[1], Math.max(lineChStart.rect[2], lineChEnd.rect[2]), line.rect[3]];
      }
      lineChStart = null;
      allRects.push(rect);
      rect = null;
    }
  }
  
  return {
    offset: chs.indexOf(chStart),
    rects: allRects,
    text
  };
}
