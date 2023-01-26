/**
 * Approximate string matching in text
 *
 * @param {String} text A text to search for the pattern
 * @param {String} pattern An approximate string to search for
 * @param {Number} maxErrors Maximum errors (Levenshtein distance)
 * @return {Array} An array of matches containing 'start', 'end' and 'errors' parameters
 */
export function approximateMatch(text, pattern, maxErrors) {
	/**
	 * https://github.com/robertknight/approx-string-match-js
	 *
	 * Implementation of Myers' online approximate string matching algorithm [1].
	 *
	 * This has O((k/w) * n) complexity where `n` is the length of the text, `k` is
	 * the maximum number of errors allowed (always <= the pattern length) and `w`
	 * is the word size. Because JS only supports bitwise operations on 32 bit
	 * integers, `w` is 32.
	 *
	 * As far as I am aware, there aren't any online algorithms which are
	 * significantly better for a wide range of input parameters. The problem can be
	 * solved faster using "filter then verify" approaches which first filter out
	 * regions of the text that cannot match using a "cheap" check and then verify
	 * the remaining potential matches. The verify step requires an algorithm such
	 * as this one however.
	 *
	 * The algorithm's approach is essentially to optimize the classic dynamic
	 * programming solution to the problem by computing columns of the matrix in
	 * word-sized chunks (ie. dealing with 32 chars of the pattern at a time) and
	 * avoiding calculating regions of the matrix where the minimum error count is
	 * guaranteed to exceed the input threshold.
	 *
	 * The paper consists of two parts, the first describes the core algorithm for
	 * matching patterns <= the size of a word (implemented by `advanceBlock` here).
	 * The second uses the core algorithm as part of a larger block-based algorithm
	 * to handle longer patterns.
	 *
	 * [1] G. Myers, “A Fast Bit-Vector Algorithm for Approximate String Matching
	 * Based on Dynamic Programming,” vol. 46, no. 3, pp. 395–415, 1999.
	 */

	function reverse(s) {
		return s.split('').reverse().join('');
	}

	function fill(ary, x) {
		for (var i = 0; i < ary.length; i += 1) {
			ary[i] = x;
		}
		return ary;
	}

	/**
	 * Given the ends of approximate matches for `pattern` in `text`, find
	 * the start of the matches.
	 *
	 * @param findEndFn - Function for finding the end of matches in
	 * text.
	 * @return Matches with the `start` property set.
	 */
	function findMatchStarts(text, pattern, matches, findEndFn) {
		var minCost = Math.min.apply(Math, matches.map(function (m) {
			return m.errors;
		}));
		return matches
		.filter(function (m) {
			return m.errors === minCost;
		})
		.map(function (m) {
			// Find start of each match by reversing the pattern and matching segment
			// of text and searching for an approx match with the same number of
			// errors.
			var minStart = Math.max(0, m.end - pattern.length - m.errors);
			var textRev = reverse(text.slice(minStart, m.end));
			var patRev = reverse(pattern);
			// If there are multiple possible start points, choose the one that
			// maximizes the length of the match.
			var start = findEndFn(textRev, patRev, m.errors).reduce(function (min, rm) {
				if (m.end - rm.end < min) {
					return m.end - rm.end;
				}
				return min;
			}, m.end);
			return {
				start: start,
				end: m.end,
				errors: m.errors
			};
		});
	}

	/**
	 * Block calculation step of the algorithm.
	 *
	 * From Fig 8. on p. 408 of [1].
	 *
	 * @param b - The block level
	 * @param t - Character from the text, represented as
	 *        a value in the `ctx.peq` alphabet.
	 * @param hIn - Horizontal input delta ∈ {1,0,-1}
	 * @return Horizontal output delta
	 */
	function advanceBlock(ctx, b, t, hIn) {
		var pV = ctx.P[b];
		var mV = ctx.M[b];
		var eq = ctx.peq[t][b];
		var hOut = 0;
		// Step 1: Compute horizontal deltas.
		var xV = eq | mV;
		if (hIn < 0) {
			eq |= 1;
		}
		var xH = (((eq & pV) + pV) ^ pV) | eq;
		var pH = mV | ~(xH | pV);
		var mH = pV & xH;
		// Step 2: Update score (value of last row of this block).
		if (pH & ctx.lastRowMask[b]) {
			hOut += 1;
		}
		else if (mH & ctx.lastRowMask[b]) {
			hOut -= 1;
		}
		// Step 3: Update vertical deltas for use when processing next char.
		pH <<= 1;
		mH <<= 1;
		if (hIn < 0) {
			mH |= 1;
		}
		else if (hIn > 0) {
			pH |= 1;
		}
		pV = mH | ~(xV | pH);
		mV = pH & xV;
		ctx.P[b] = pV;
		ctx.M[b] = mV;
		return hOut;
	}

	/**
	 * Find the ends and error counts for matches of `pattern` in `text`.
	 *
	 * This is the block-based search algorithm from Fig. 9 on p.410 of [1].
	 */
	function findMatchEnds(text, pattern, maxErrors) {
		if (pattern.length === 0) {
			return [];
		}
		// Clamp error count so we can rely on the `maxErrors` and `pattern.length`
		// rows being in the same block below.
		maxErrors = Math.min(maxErrors, pattern.length);
		var matches = [];
		// Word size.
		var w = 32;
		// Index of maximum block level.
		var bMax = Math.ceil(pattern.length / w) - 1;
		// Context used across block calculations.
		var ctx = {
			bMax: bMax,
			P: fill(Array(bMax + 1), 0),
			M: fill(Array(bMax + 1), 0),
			peq: [],
			lastRowMask: fill(Array(bMax + 1), 1 << 31)
		};
		ctx.lastRowMask[bMax] = 1 << ((pattern.length - 1) % w);
		// Calculate `ctx.peq` - the locations of chars within the pattern.
		for (var c = 0; c < text.length; c += 1) {
			var val = text.charCodeAt(c);
			if (ctx.peq[val]) {
				// Duplicate char in text.
				continue;
			}
			// `ctx.peq[val]` is a bit-array where each int represents a 32-char slice
			// of the pattern.
			ctx.peq[val] = Array(bMax + 1);
			for (var b = 0; b <= bMax; b += 1) {
				ctx.peq[val][b] = 0;
				// Set all the bits where the pattern matches the current char (ch).
				// For indexes beyond the end of the pattern, always set the bit as if the
				// pattern contained a wildcard char in that position.
				for (var r = 0; r < w; r += 1) {
					var idx = (b * w) + r;
					if (idx >= pattern.length) {
						continue;
					}
					var match = pattern.charCodeAt(idx) === val;
					if (match) {
						ctx.peq[val][b] |= (1 << r);
					}
				}
			}
		}
		// Index of last-active block level in the column.
		var y = Math.max(0, Math.ceil(maxErrors / w) - 1);
		// Initialize maximum error count at bottom of each block.
		var score = [];
		for (var b = 0; b <= y; b += 1) {
			score[b] = (b + 1) * w;
		}
		score[bMax] = pattern.length;
		// Initialize vertical deltas for each block.
		for (var b = 0; b <= y; b += 1) {
			ctx.P[b] = ~0;
			ctx.M[b] = 0;
		}
		// Process each char of the text, computing the error count for `w` chars of
		// the pattern at a time.
		for (var j = 0; j < text.length; j += 1) {
			var ch = text.charCodeAt(j);
			// Calculate error count for blocks that we definitely have to process for
			// this column.
			var carry = 0;
			for (var b = 0; b <= y; b += 1) {
				carry = advanceBlock(ctx, b, ch, carry);
				score[b] += carry;
			}
			// Check if we also need to compute an additional block, or if we can reduce
			// the number of blocks processed for the next column.
			if ((score[y] - carry) <= maxErrors
				&& (y < ctx.bMax)
				&& ((ctx.peq[ch][y + 1] & 1)
					|| (carry < 0))) {
				// Error count for bottom block is under threshold, increase the number of
				// blocks processed for this column & next by 1.
				y += 1;
				ctx.P[y] = ~0;
				ctx.M[y] = 0;
				var maxBlockScore = y === bMax ? ((pattern.length % w) || w) : w;
				score[y] = score[y - 1] + maxBlockScore - carry + advanceBlock(ctx, y, ch, carry);
			}
			else {
				// Error count for bottom block exceeds threshold, reduce the number of
				// blocks processed for the next column.
				while (y > 0 && score[y] >= maxErrors + w) {
					y -= 1;
				}
			}
			// If error count is under threshold, report a match.
			if (y === ctx.bMax && score[y] <= maxErrors) {
				matches.push({
					end: j + 1,
					errors: score[y],
					start: -1
				});
			}
		}
		return matches;
	}

	var matches = findMatchEnds(text, pattern, maxErrors);
	return findMatchStarts(text, pattern, matches, findMatchEnds);
}
