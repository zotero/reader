// The code is adapted from Xpdf https://www.xpdfreader.com/opensource.html
// Original copyright: 1996-2019 Glyph & Cog, LLC.

// Inter-character spacing that varies by less than this multiple of
// font size is assumed to be equivalent.
const uniformSpacing = 0.07;

// Typical word spacing, as a fraction of font size.  This will be
// added to the minimum inter-character spacing, to account for wide
// character spacing.
const wordSpacing = 0.1;
// Compute the inter-word spacing threshold for a line of chars.
// Spaces greater than this threshold will be considered inter-word
// spaces.
export function computeWordSpacingThreshold(chs, rot) {
  let ch, ch2;
  let avgFontSize;
  let minAdjGap, maxAdjGap, minSpGap, maxSpGap, minGap, maxGap, gap, gap2;
  let i;
  
  avgFontSize = 0;
  minGap = maxGap = 0;
  minAdjGap = minSpGap = 1;
  maxAdjGap = maxSpGap = 0;
  for (i = 0; i < chs.length; ++i) {
    ch = chs[i];
    avgFontSize += ch.fontSize;
    if (i < chs.length - 1) {
      ch2 = chs[i + 1];
      gap = (rot & 1) ? (ch2.rect[1] - ch.rect[3]) : (ch2.rect[0] - ch.rect[2]);
      if (ch.spaceAfter) {
        if (minSpGap > maxSpGap) {
          minSpGap = maxSpGap = gap;
        }
        else if (gap < minSpGap) {
          minSpGap = gap;
        }
        else if (gap > maxSpGap) {
          maxSpGap = gap;
        }
      }
      else {
        if (minAdjGap > maxAdjGap) {
          minAdjGap = maxAdjGap = gap;
        }
        else if (gap < minAdjGap) {
          minAdjGap = gap;
        }
        else if (gap > maxAdjGap) {
          maxAdjGap = gap;
        }
      }
      if (i == 0 || gap < minGap) {
        minGap = gap;
      }
      if (gap > maxGap) {
        maxGap = gap;
      }
    }
  }
  avgFontSize /= chs.length;
  if (minGap < 0) {
    minGap = 0;
  }
  
  // if spacing is nearly uniform (minGap is close to maxGap), use the
  // SpGap/AdjGap values if available, otherwise assume it's a single
  // word (technically it could be either "ABC" or "A B C", but it's
  // essentially impossible to tell)
  if (maxGap - minGap < uniformSpacing * avgFontSize) {
    if (minAdjGap <= maxAdjGap &&
      minSpGap <= maxSpGap &&
      minSpGap - maxAdjGap > 0.01) {
      return 0.5 * (maxAdjGap + minSpGap);
    }
    else {
      return maxGap + 1;
    }
    
    // if there is some variation in spacing, but it's small, assume
    // there are some inter-word spaces
  }
  else if (maxGap - minGap < wordSpacing * avgFontSize) {
    return 0.5 * (minGap + maxGap);
    
    // if there is a large variation in spacing, use the SpGap/AdjGap
    // values if they look reasonable, otherwise, assume a reasonable
    // threshold for inter-word spacing (we can't use something like
    // 0.5*(minGap+maxGap) here because there can be outliers at the
    // high end)
  }
  else {
    if (minAdjGap <= maxAdjGap &&
      minSpGap <= maxSpGap &&
      minSpGap - maxAdjGap > uniformSpacing * avgFontSize) {
      gap = wordSpacing * avgFontSize;
      gap2 = 0.5 * (minSpGap - minGap);
      return minGap + (gap < gap2 ? gap : gap2);
    }
    else {
      return minGap + wordSpacing * avgFontSize;
    }
  }
}

// module.exports = {
// 	computeWordSpacingThreshold
// };
