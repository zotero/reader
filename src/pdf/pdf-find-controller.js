/*
 *	Modified version of PDF.js pdf_find_controller.js
 */

/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

Promise.withResolvers || (Promise.withResolvers = function withResolvers() {
	var a, b, c = new this(function (resolve, reject) {
		a = resolve;
		b = reject;
	});
	return { resolve: a, reject: b, promise: c };
});

import { getRangeRects } from './lib/utilities';

// pdf_find_utils.js [
const CharacterType = {
	SPACE: 0,
	ALPHA_LETTER: 1,
	PUNCT: 2,
	HAN_LETTER: 3,
	KATAKANA_LETTER: 4,
	HIRAGANA_LETTER: 5,
	HALFWIDTH_KATAKANA_LETTER: 6,
	THAI_LETTER: 7,
};

function isAlphabeticalScript(charCode) {
	return charCode < 0x2e80;
}

function isAscii(charCode) {
	return (charCode & 0xff80) === 0;
}

function isAsciiAlpha(charCode) {
	return (
		(charCode >= /* a = */ 0x61 && charCode <= /* z = */ 0x7a) ||
		(charCode >= /* A = */ 0x41 && charCode <= /* Z = */ 0x5a)
	);
}

function isAsciiDigit(charCode) {
	return charCode >= /* 0 = */ 0x30 && charCode <= /* 9 = */ 0x39;
}

function isAsciiSpace(charCode) {
	return (
		charCode === /* SPACE = */ 0x20 ||
		charCode === /* TAB = */ 0x09 ||
		charCode === /* CR = */ 0x0d ||
		charCode === /* LF = */ 0x0a
	);
}

function isHan(charCode) {
	return (
		(charCode >= 0x3400 && charCode <= 0x9fff) ||
		(charCode >= 0xf900 && charCode <= 0xfaff)
	);
}

function isKatakana(charCode) {
	return charCode >= 0x30a0 && charCode <= 0x30ff;
}

function isHiragana(charCode) {
	return charCode >= 0x3040 && charCode <= 0x309f;
}

function isHalfwidthKatakana(charCode) {
	return charCode >= 0xff60 && charCode <= 0xff9f;
}

function isThai(charCode) {
	return (charCode & 0xff80) === 0x0e00;
}

/**
 * This function is based on the word-break detection implemented in:
 * https://hg.mozilla.org/mozilla-central/file/tip/intl/lwbrk/WordBreaker.cpp
 */
function getCharacterType(charCode) {
	if (isAlphabeticalScript(charCode)) {
		if (isAscii(charCode)) {
			if (isAsciiSpace(charCode)) {
				return CharacterType.SPACE;
			}
			else if (
				isAsciiAlpha(charCode) ||
				isAsciiDigit(charCode) ||
				charCode === /* UNDERSCORE = */ 0x5f
			) {
				return CharacterType.ALPHA_LETTER;
			}
			return CharacterType.PUNCT;
		}
		else if (isThai(charCode)) {
			return CharacterType.THAI_LETTER;
		}
		else if (charCode === /* NBSP = */ 0xa0) {
			return CharacterType.SPACE;
		}
		return CharacterType.ALPHA_LETTER;
	}

	if (isHan(charCode)) {
		return CharacterType.HAN_LETTER;
	}
	else if (isKatakana(charCode)) {
		return CharacterType.KATAKANA_LETTER;
	}
	else if (isHiragana(charCode)) {
		return CharacterType.HIRAGANA_LETTER;
	}
	else if (isHalfwidthKatakana(charCode)) {
		return CharacterType.HALFWIDTH_KATAKANA_LETTER;
	}
	return CharacterType.ALPHA_LETTER;
}

let NormalizeWithNFKC;

function getNormalizeWithNFKC() {
	/* eslint-disable no-irregular-whitespace */
	NormalizeWithNFKC ||= ` ¨ª¯²-µ¸-º¼-¾Ĳ-ĳĿ-ŀŉſǄ-ǌǱ-ǳʰ-ʸ˘-˝ˠ-ˤʹͺ;΄-΅·ϐ-ϖϰ-ϲϴ-ϵϹևٵ-ٸक़-य़ড়-ঢ়য়ਲ਼ਸ਼ਖ਼-ਜ਼ਫ਼ଡ଼-ଢ଼ำຳໜ-ໝ༌གྷཌྷདྷབྷཛྷཀྵჼᴬ-ᴮᴰ-ᴺᴼ-ᵍᵏ-ᵪᵸᶛ-ᶿẚ-ẛάέήίόύώΆ᾽-῁ΈΉ῍-῏ΐΊ῝-῟ΰΎ῭-`ΌΏ´-῾ - ‑‗․-… ″-‴‶-‷‼‾⁇-⁉⁗ ⁰-ⁱ⁴-₎ₐ-ₜ₨℀-℃℅-ℇ℉-ℓℕ-№ℙ-ℝ℠-™ℤΩℨK-ℭℯ-ℱℳ-ℹ℻-⅀ⅅ-ⅉ⅐-ⅿ↉∬-∭∯-∰〈-〉①-⓪⨌⩴-⩶⫝̸ⱼ-ⱽⵯ⺟⻳⼀-⿕　〶〸-〺゛-゜ゟヿㄱ-ㆎ㆒-㆟㈀-㈞㈠-㉇㉐-㉾㊀-㏿ꚜ-ꚝꝰꟲ-ꟴꟸ-ꟹꭜ-ꭟꭩ豈-嗀塚晴凞-羽蘒諸逸-都飯-舘並-龎ﬀ-ﬆﬓ-ﬗיִײַ-זּטּ-לּמּנּ-סּףּ-פּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-﷼︐-︙︰-﹄﹇-﹒﹔-﹦﹨-﹫ﹰ-ﹲﹴﹶ-ﻼ！-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ￠-￦`;

	if (typeof PDFJSDev === "undefined" || PDFJSDev.test("TESTING")) {
		const ranges = [];
		const range = [];
		const diacriticsRegex = /^\p{M}$/u;
		// Some chars must be replaced by their NFKC counterpart during a search.
		for (let i = 0; i < 65536; i++) {
			const c = String.fromCharCode(i);
			if (c.normalize("NFKC") !== c && !diacriticsRegex.test(c)) {
				if (range.length !== 2) {
					range[0] = range[1] = i;
					continue;
				}
				if (range[1] + 1 !== i) {
					if (range[0] === range[1]) {
						ranges.push(String.fromCharCode(range[0]));
					}
					else {
						ranges.push(
							`${String.fromCharCode(range[0])}-${String.fromCharCode(
								range[1]
							)}`
						);
					}
					range[0] = range[1] = i;
				}
				else {
					range[1] = i;
				}
			}
		}
		if (ranges.join("") !== NormalizeWithNFKC) {
			throw new Error(
				"getNormalizeWithNFKC - update the `NormalizeWithNFKC` string."
			);
		}
	}
	return NormalizeWithNFKC;
}
// ]

/**
 * Use binary search to find the index of the first item in a given array which
 * passes a given condition. The items are expected to be sorted in the sense
 * that if the condition is true for one item in the array, then it is also true
 * for all following items.
 *
 * @returns {number} Index of the first array element to pass the test,
 *                   or |items.length| if no such element exists.
 */
function binarySearchFirstItem(items, condition, start = 0) {
	let minIndex = start;
	let maxIndex = items.length - 1;

	if (maxIndex < 0 || !condition(items[maxIndex])) {
		return items.length;
	}
	if (condition(items[minIndex])) {
		return minIndex;
	}

	while (minIndex < maxIndex) {
		const currentIndex = (minIndex + maxIndex) >> 1;
		const currentItem = items[currentIndex];
		if (condition(currentItem)) {
			maxIndex = currentIndex;
		}
		else {
			minIndex = currentIndex + 1;
		}
	}
	return minIndex; /* === maxIndex */
}


const FindState = {
	FOUND: 0,
	NOT_FOUND: 1,
	WRAPPED: 2,
	PENDING: 3,
};

const FIND_TIMEOUT = 250; // ms

const CHARACTERS_TO_NORMALIZE = {
	"\u2010": "-", // Hyphen
	"\u2018": "'", // Left single quotation mark
	"\u2019": "'", // Right single quotation mark
	"\u201A": "'", // Single low-9 quotation mark
	"\u201B": "'", // Single high-reversed-9 quotation mark
	"\u201C": '"', // Left double quotation mark
	"\u201D": '"', // Right double quotation mark
	"\u201E": '"', // Double low-9 quotation mark
	"\u201F": '"', // Double high-reversed-9 quotation mark
	"\u00BC": "1/4", // Vulgar fraction one quarter
	"\u00BD": "1/2", // Vulgar fraction one half
	"\u00BE": "3/4", // Vulgar fraction three quarters
};

// These diacritics aren't considered as combining diacritics
// when searching in a document:
//   https://searchfox.org/mozilla-central/source/intl/unicharutil/util/is_combining_diacritic.py.
// The combining class definitions can be found:
//   https://www.unicode.org/reports/tr44/#Canonical_Combining_Class_Values
// Category 0 corresponds to [^\p{Mn}].
const DIACRITICS_EXCEPTION = new Set([
	// UNICODE_COMBINING_CLASS_KANA_VOICING
	// https://www.compart.com/fr/unicode/combining/8
	0x3099, 0x309a,
	// UNICODE_COMBINING_CLASS_VIRAMA (under 0xFFFF)
	// https://www.compart.com/fr/unicode/combining/9
	0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d3b,
	0x0d3c, 0x0d4d, 0x0dca, 0x0e3a, 0x0eba, 0x0f84, 0x1039, 0x103a, 0x1714,
	0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0x1bf2, 0x1bf3, 0x2d7f,
	0xa806, 0xa82c, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed,
	// 91
	// https://www.compart.com/fr/unicode/combining/91
	0x0c56,
	// 129
	// https://www.compart.com/fr/unicode/combining/129
	0x0f71,
	// 130
	// https://www.compart.com/fr/unicode/combining/130
	0x0f72, 0x0f7a, 0x0f7b, 0x0f7c, 0x0f7d, 0x0f80,
	// 132
	// https://www.compart.com/fr/unicode/combining/132
	0x0f74,
]);
let DIACRITICS_EXCEPTION_STR; // Lazily initialized, see below.

const DIACRITICS_REG_EXP = /\p{M}+/gu;
const SPECIAL_CHARS_REG_EXP =
	/([.*+?^${}()|[\]\\])|(\p{P})|(\s+)|(\p{M})|(\p{L})/gu;
const NOT_DIACRITIC_FROM_END_REG_EXP = /([^\p{M}])\p{M}*$/u;
const NOT_DIACRITIC_FROM_START_REG_EXP = /^\p{M}*([^\p{M}])/u;

// The range [AC00-D7AF] corresponds to the Hangul syllables.
// The few other chars are some CJK Compatibility Ideographs.
const SYLLABLES_REG_EXP = /[\uAC00-\uD7AF\uFA6C\uFACF-\uFAD1\uFAD5-\uFAD7]+/g;
const SYLLABLES_LENGTHS = new Map();
// When decomposed (in using NFD) the above syllables will start
// with one of the chars in this regexp.
const FIRST_CHAR_SYLLABLES_REG_EXP =
	"[\\u1100-\\u1112\\ud7a4-\\ud7af\\ud84a\\ud84c\\ud850\\ud854\\ud857\\ud85f]";

const NFKC_CHARS_TO_NORMALIZE = new Map();

let noSyllablesRegExp = null;
let withSyllablesRegExp = null;

function normalize(text) {
	// The diacritics in the text or in the query can be composed or not.
	// So we use a decomposed text using NFD (and the same for the query)
	// in order to be sure that diacritics are in the same order.

	// Collect syllables length and positions.
	const syllablePositions = [];
	let m;
	while ((m = SYLLABLES_REG_EXP.exec(text)) !== null) {
		let { index } = m;
		for (const char of m[0]) {
			let len = SYLLABLES_LENGTHS.get(char);
			if (!len) {
				len = char.normalize("NFD").length;
				SYLLABLES_LENGTHS.set(char, len);
			}
			syllablePositions.push([len, index++]);
		}
	}

	let normalizationRegex;
	if (syllablePositions.length === 0 && noSyllablesRegExp) {
		normalizationRegex = noSyllablesRegExp;
	}
	else if (syllablePositions.length > 0 && withSyllablesRegExp) {
		normalizationRegex = withSyllablesRegExp;
	}
	else {
		// Compile the regular expression for text normalization once.
		const replace = Object.keys(CHARACTERS_TO_NORMALIZE).join("");
		const toNormalizeWithNFKC = getNormalizeWithNFKC();

		// 3040-309F: Hiragana
		// 30A0-30FF: Katakana
		const CJK = "(?:\\p{Ideographic}|[\u3040-\u30FF])";
		const HKDiacritics = "(?:\u3099|\u309A)";
		const regexp = `([${replace}])|([${toNormalizeWithNFKC}])|(${HKDiacritics}\\n)|(\\p{M}+(?:-\\n)?)|(\\S-\\n)|(${CJK}\\n)|(\\n)`;

		if (syllablePositions.length === 0) {
			// Most of the syllables belong to Hangul so there are no need
			// to search for them in a non-Hangul document.
			// We use the \0 in order to have the same number of groups.
			normalizationRegex = noSyllablesRegExp = new RegExp(
				regexp + "|(\\u0000)",
				"gum"
			);
		}
		else {
			normalizationRegex = withSyllablesRegExp = new RegExp(
				regexp + `|(${FIRST_CHAR_SYLLABLES_REG_EXP})`,
				"gum"
			);
		}
	}

	// The goal of this function is to normalize the string and
	// be able to get from an index in the new string the
	// corresponding index in the old string.
	// For example if we have: abCd12ef456gh where C is replaced by ccc
	// and numbers replaced by nothing (it's the case for diacritics), then
	// we'll obtain the normalized string: abcccdefgh.
	// So here the reverse map is: [0,1,2,2,2,3,6,7,11,12].

	// The goal is to obtain the array: [[0, 0], [3, -1], [4, -2],
	// [6, 0], [8, 3]].
	// which can be used like this:
	//  - let say that i is the index in new string and j the index
	//    the old string.
	//  - if i is in [0; 3[ then j = i + 0
	//  - if i is in [3; 4[ then j = i - 1
	//  - if i is in [4; 6[ then j = i - 2
	//  ...
	// Thanks to a binary search it's easy to know where is i and what's the
	// shift.
	// Let say that the last entry in the array is [x, s] and we have a
	// substitution at index y (old string) which will replace o chars by n chars.
	// Firstly, if o === n, then no need to add a new entry: the shift is
	// the same.
	// Secondly, if o < n, then we push the n - o elements:
	// [y - (s - 1), s - 1], [y - (s - 2), s - 2], ...
	// Thirdly, if o > n, then we push the element: [y - (s - n), o + s - n]

	// Collect diacritics length and positions.
	const rawDiacriticsPositions = [];
	while ((m = DIACRITICS_REG_EXP.exec(text)) !== null) {
		rawDiacriticsPositions.push([m[0].length, m.index]);
	}

	let normalized = text.normalize("NFD");
	const positions = [[0, 0]];
	let rawDiacriticsIndex = 0;
	let syllableIndex = 0;
	let shift = 0;
	let shiftOrigin = 0;
	let eol = 0;
	let hasDiacritics = false;

	normalized = normalized.replace(
		normalizationRegex,
		(match, p1, p2, p3, p4, p5, p6, p7, p8, i) => {
			i -= shiftOrigin;
			if (p1) {
				// Maybe fractions or quotations mark...
				const replacement = CHARACTERS_TO_NORMALIZE[p1];
				const jj = replacement.length;
				for (let j = 1; j < jj; j++) {
					positions.push([i - shift + j, shift - j]);
				}
				shift -= jj - 1;
				return replacement;
			}

			if (p2) {
				// Use the NFKC representation to normalize the char.
				let replacement = NFKC_CHARS_TO_NORMALIZE.get(p2);
				if (!replacement) {
					replacement = p2.normalize("NFKC");
					NFKC_CHARS_TO_NORMALIZE.set(p2, replacement);
				}
				const jj = replacement.length;
				for (let j = 1; j < jj; j++) {
					positions.push([i - shift + j, shift - j]);
				}
				shift -= jj - 1;
				return replacement;
			}

			if (p3) {
				// We've a Katakana-Hiragana diacritic followed by a \n so don't replace
				// the \n by a whitespace.
				hasDiacritics = true;

				// Diacritic.
				if (i + eol === rawDiacriticsPositions[rawDiacriticsIndex]?.[1]) {
					++rawDiacriticsIndex;
				}
				else {
					// i is the position of the first diacritic
					// so (i - 1) is the position for the letter before.
					positions.push([i - 1 - shift + 1, shift - 1]);
					shift -= 1;
					shiftOrigin += 1;
				}

				// End-of-line.
				positions.push([i - shift + 1, shift]);
				shiftOrigin += 1;
				eol += 1;

				return p3.charAt(0);
			}

			if (p4) {
				const hasTrailingDashEOL = p4.endsWith("\n");
				const len = hasTrailingDashEOL ? p4.length - 2 : p4.length;

				// Diacritics.
				hasDiacritics = true;
				let jj = len;
				if (i + eol === rawDiacriticsPositions[rawDiacriticsIndex]?.[1]) {
					jj -= rawDiacriticsPositions[rawDiacriticsIndex][0];
					++rawDiacriticsIndex;
				}

				for (let j = 1; j <= jj; j++) {
					// i is the position of the first diacritic
					// so (i - 1) is the position for the letter before.
					positions.push([i - 1 - shift + j, shift - j]);
				}
				shift -= jj;
				shiftOrigin += jj;

				if (hasTrailingDashEOL) {
					// Diacritics are followed by a -\n.
					// See comments in `if (p5)` block.
					i += len - 1;
					positions.push([i - shift + 1, 1 + shift]);
					shift += 1;
					shiftOrigin += 1;
					eol += 1;
					return p4.slice(0, len);
				}

				return p4;
			}

			if (p5) {
				// "X-\n" is removed because an hyphen at the end of a line
				// with not a space before is likely here to mark a break
				// in a word.
				// If X is encoded with UTF-32 then it can have a length greater than 1.
				// The \n isn't in the original text so here y = i, n = X.len - 2 and
				// o = X.len - 1.
				const len = p5.length - 2;
				positions.push([i - shift + len, 1 + shift]);
				shift += 1;
				shiftOrigin += 1;
				eol += 1;
				return p5.slice(0, -2);
			}

			if (p6) {
				// An ideographic at the end of a line doesn't imply adding an extra
				// white space.
				// A CJK can be encoded in UTF-32, hence their length isn't always 1.
				const len = p6.length - 1;
				positions.push([i - shift + len, shift]);
				shiftOrigin += 1;
				eol += 1;
				return p6.slice(0, -1);
			}

			if (p7) {
				// eol is replaced by space: "foo\nbar" is likely equivalent to
				// "foo bar".
				positions.push([i - shift + 1, shift - 1]);
				shift -= 1;
				shiftOrigin += 1;
				eol += 1;
				return " ";
			}

			// p8
			if (i + eol === syllablePositions[syllableIndex]?.[1]) {
				// A syllable (1 char) is replaced with several chars (n) so
				// newCharsLen = n - 1.
				const newCharLen = syllablePositions[syllableIndex][0] - 1;
				++syllableIndex;
				for (let j = 1; j <= newCharLen; j++) {
					positions.push([i - (shift - j), shift - j]);
				}
				shift -= newCharLen;
				shiftOrigin += newCharLen;
			}
			return p8;
		}
	);

	positions.push([normalized.length, shift]);

	return [normalized, positions, hasDiacritics];
}

// Determine the original, non-normalized, match index such that highlighting of
// search results is correct in the `textLayer` for strings containing e.g. "½"
// characters; essentially "inverting" the result of the `normalize` function.
function getOriginalIndex(diffs, pos, len) {
	if (!diffs) {
		return [pos, len];
	}

	// First char in the new string.
	const start = pos;
	// Last char in the new string.
	const end = pos + len - 1;
	let i = binarySearchFirstItem(diffs, x => x[0] >= start);
	if (diffs[i][0] > start) {
		--i;
	}

	let j = binarySearchFirstItem(diffs, x => x[0] >= end, i);
	if (diffs[j][0] > end) {
		--j;
	}

	// First char in the old string.
	const oldStart = start + diffs[i][1];

	// Last char in the old string.
	const oldEnd = end + diffs[j][1];
	const oldLen = oldEnd + 1 - oldStart;

	return [oldStart, oldLen];
}

function getSnippet(text, phraseStart, phraseEnd, numWordsAround) {
	if (phraseStart < 0 || phraseEnd > text.length || phraseStart >= phraseEnd) {
		return '';
	}

	let phrase = text.substring(phraseStart, phraseEnd);

	let leftText = text.substring(0, phraseStart).trim();
	let rightText = text.substring(phraseEnd).trim();

	let leftWords = leftText ? leftText.split(/\s+/) : [];
	let rightWords = rightText ? rightText.split(/\s+/) : [];

	let leftSnippetWords = leftWords.slice(-numWordsAround);
	let rightSnippetWords = rightWords.slice(0, numWordsAround);

	let leftSnippet = leftSnippetWords.join(' ');
	let rightSnippet = rightSnippetWords.join(' ');

	// Optionally add ellipses if there are more words that we didn't include.
	let prefix = leftWords.length > numWordsAround ? '…' : '';
	let suffix = rightWords.length > numWordsAround ? '…' : '';

	// Determine if the phrase starts or ends mid-word.
	// If phraseStart is in the middle of a word (i.e. the character immediately before is not whitespace)
	// then we should not add a space between the left snippet and the phrase.
	let leftPartial = phraseStart > 0 && !/\s/.test(text.charAt(phraseStart - 1));
	// Similarly, if phraseEnd is in the middle of a word (i.e. the character at phraseEnd is not whitespace),
	// then we should not add a space between the phrase and the right snippet.
	let rightPartial = phraseEnd < text.length && !/\s/.test(text.charAt(phraseEnd));

	// Combine the parts into one snippet.
	let snippet = "";
	if (prefix) {
		snippet += prefix;
	}
	if (leftSnippet) {
		snippet += leftSnippet;
		// Only add a space if the phrase does not start in the middle of a word.
		if (!leftPartial) {
			snippet += " ";
		}
	}
	snippet += phrase;
	if (rightSnippet) {
		// Only add a space before the right snippet if the phrase does not end in the middle of a word.
		if (!rightPartial) {
			snippet += " ";
		}
		snippet += rightSnippet;
	}
	if (suffix) {
		snippet += suffix;
	}

	return snippet;
}

/**
 * @typedef {Object} PDFFindControllerOptions
 * @property {IPDFLinkService} linkService - The navigation/linking service.
 */

/**
 * Provides search functionality to find a given string in a PDF document.
 */
class PDFFindController {
	_state = null;

	_visitedPagesCount = 0;

	/**
	 * @param {PDFFindControllerOptions} options
	 */
	constructor({ linkService, onNavigate, onUpdateMatches, onUpdateState }) {
		this._linkService = linkService;
		this._onNavigate = onNavigate;
		this._onUpdateMatches = onUpdateMatches;
		this._onUpdateState = onUpdateState;
		this._charMapping = [];

		/**
		 * Callback used to check if a `pageNumber` is currently visible.
		 * @type {function}
		 */
		this.onIsPageVisible = null;

		this._reset();
		// eventBus._on("find", this.#onFind.bind(this));
		// eventBus._on("findbarclose", this.#onFindBarClose.bind(this));
	}

	get highlightMatches() {
		return this._highlightMatches;
	}

	get pageMatches() {
		return this._pageMatches;
	}

	get pageMatchesLength() {
		return this._pageMatchesLength;
	}

	get selected() {
		return this._selected;
	}

	get state() {
		return this._state;
	}

	/**
	 * Set a reference to the PDF document in order to search it.
	 * Note that searching is not possible if this method is not called.
	 *
	 * @param {PDFDocumentProxy} pdfDocument - The PDF document to search.
	 */
	setDocument(pdfDocument) {
		if (this._pdfDocument) {
			this._reset();
		}
		if (!pdfDocument) {
			return;
		}
		this._pdfDocument = pdfDocument;
		this._firstPageCapability.resolve();
	}

	find(state) {
		if (!state) {
			return;
		}
		const pdfDocument = this._pdfDocument;
		const { type } = state;

		if (this._state === null || this._shouldDirtyMatch(state)) {
			this._dirtyMatch = true;
		}
		this._state = state;
		if (type !== "highlightallchange") {
			this._updateUIState(FindState.PENDING);
		}

		this._firstPageCapability.promise.then(() => {
			// If the document was closed before searching began, or if the search
			// operation was relevant for a previously opened document, do nothing.
			if (
				!this._pdfDocument ||
				(pdfDocument && this._pdfDocument !== pdfDocument)
			) {
				return;
			}
			this._extractText();

			const findbarClosed = !this._highlightMatches;
			const pendingTimeout = !!this._findTimeout;

			if (this._findTimeout) {
				clearTimeout(this._findTimeout);
				this._findTimeout = null;
			}
			if (!type) {
				// Trigger the find action with a small delay to avoid starting the
				// search when the user is still typing (saving resources).
				this._findTimeout = setTimeout(() => {
					this._nextMatch();
					this._findTimeout = null;
				}, FIND_TIMEOUT);
			}
			else if (this._dirtyMatch) {
				// Immediately trigger searching for non-'find' operations, when the
				// current state needs to be reset and matches re-calculated.
				this._nextMatch();
			}
			else if (type === "again") {
				this._nextMatch();
			}
			else if (type === "highlightallchange") {
				// If there was a pending search operation, synchronously trigger a new
				// search *first* to ensure that the correct matches are highlighted.
				if (pendingTimeout) {
					this._nextMatch();
				}
				else {
					this._highlightMatches = true;
				}
			}
			else {
				this._nextMatch();
			}
		});
	}

	getMatchPositions(pageIndex, pageData) {
		let positions = [];
		let pageMatches = this._pageMatches[pageIndex];
		let pageMatchesLength = this._pageMatchesLength[pageIndex];
		if (!pageMatches || !pageMatches.length) {
			return [];
		}
		let chars = pageData.chars;
		for (let j = 0; j < pageMatches.length; j++) {
			let matchPos = pageMatches[j];
			let matchLen = pageMatchesLength[j];
			let start = null;
			let end = null;
			let total = 0;
			for (let i = 0; i < chars.length; i++) {
				let char = chars[i];
				total++;
				// For an unknown reason char.u can sometimes have decomposed ligatures instead of
				// single ligature character
				total += char.u.length - 1;
				if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
					total++;
				}
				if (total >= matchPos && start === null) {
					start = i;
					if (i !== 0) {
						start++;
					}
				}
				if (total >= matchPos + matchLen) {
					end = i;
					break;
				}
			}
			let rects = getRangeRects(chars, start, end);
			let position = { pageIndex, rects };
			positions.push(position);
		}
		return positions;
	}

	async getMatchPositionsAsync(pageIndex) {
		let pageMatches = this._pageMatches[pageIndex];
		if (!pageMatches || !pageMatches.length) {
			return [];
		}
		let pageData = await this._pdfDocument.getPageData({ pageIndex });
		return this.getMatchPositions(pageIndex, pageData);
	}

	_reset() {
		this._highlightMatches = false;
		this._scrollMatches = false;
		this._pdfDocument = null;
		this._pageMatches = [];
		this._pageMatchesLength = [];
		this._visitedPagesCount = 0;
		this._state = null;
		// Currently selected match.
		this._selected = {
			pageIdx: -1,
			matchIdx: -1,
		};
		// Where the find algorithm currently is in the document.
		this._offset = {
			pageIdx: null,
			matchIdx: null,
			wrapped: false,
		};
		this._extractTextPromises = [];
		this._pageContents = []; // Stores the normalized text for each page.
		this._pageDiffs = [];
		this._hasDiacritics = [];
		this._matchesCountTotal = 0;
		this._pagesToSearch = null;
		this._pendingFindMatches = new Set();
		this._resumePageIdx = null;
		this._dirtyMatch = false;
		clearTimeout(this._findTimeout);
		this._findTimeout = null;

		this._firstPageCapability = Promise.withResolvers();
	}

	/**
	 * @type {string|Array} The (current) normalized search query.
	 */
	get _query() {
		const { query } = this._state;
		if (typeof query === "string") {
			if (query !== this._rawQuery) {
				this._rawQuery = query;
				[this._normalizedQuery] = normalize(query);
			}
			return this._normalizedQuery;
		}
		// We don't bother caching the normalized search query in the Array-case,
		// since this code-path is *essentially* unused in the default viewer.
		return (query || []).filter(q => !!q).map(q => normalize(q)[0]);
	}

	_shouldDirtyMatch(state) {
		// When the search query changes, regardless of the actual search command
		// used, always re-calculate matches to avoid errors (fixes bug 1030622).
		const newQuery = state.query,
			prevQuery = this._state.query;
		const newType = typeof newQuery,
			prevType = typeof prevQuery;

		if (newType !== prevType) {
			return true;
		}
		if (newType === "string") {
			if (newQuery !== prevQuery) {
				return true;
			}
		}
		else if (
			/* isArray && */ JSON.stringify(newQuery) !== JSON.stringify(prevQuery)
		) {
			return true;
		}

		switch (state.type) {
			case "again":
				const pageNumber = this._selected.pageIdx + 1;
				const linkService = this._linkService;
				// Only treat a 'findagain' event as a new search operation when it's
				// *absolutely* certain that the currently selected match is no longer
				// visible, e.g. as a result of the user scrolling in the document.
				//
				// NOTE: If only a simple `this._linkService.page` check was used here,
				// there's a risk that consecutive 'findagain' operations could "skip"
				// over matches at the top/bottom of pages thus making them completely
				// inaccessible when there's multiple pages visible in the viewer.
				return (
					pageNumber >= 1 &&
					pageNumber <= linkService.pagesCount &&
					pageNumber !== linkService.page &&
					!(this.onIsPageVisible?.(pageNumber) ?? true)
				);
			case "highlightallchange":
				return false;
		}
		return true;
	}

	/**
	 * Determine if the search query constitutes a "whole word", by comparing the
	 * first/last character type with the preceding/following character type.
	 */
	_isEntireWord(content, startIdx, length) {
		let match = content.slice(0, startIdx).match(NOT_DIACRITIC_FROM_END_REG_EXP);
		if (match) {
			const first = content.charCodeAt(startIdx);
			const limit = match[1].charCodeAt(0);
			if (getCharacterType(first) === getCharacterType(limit)) {
				return false;
			}
		}

		match = content.slice(startIdx + length).match(NOT_DIACRITIC_FROM_START_REG_EXP);
		if (match) {
			const last = content.charCodeAt(startIdx + length - 1);
			const limit = match[1].charCodeAt(0);
			if (getCharacterType(last) === getCharacterType(limit)) {
				return false;
			}
		}

		return true;
	}

	_calculateRegExpMatch(query, entireWord, pageIndex, pageContent) {
		const matches = (this._pageMatches[pageIndex] = []);
		const matchesLength = (this._pageMatchesLength[pageIndex] = []);
		if (!query) {
			// The query can be empty because some chars like diacritics could have
			// been stripped out.
			return;
		}
		const diffs = this._pageDiffs[pageIndex];
		let match;
		while ((match = query.exec(pageContent)) !== null) {
			if (
				entireWord &&
				!this._isEntireWord(pageContent, match.index, match[0].length)
			) {
				continue;
			}

			let [matchPos, matchLen] = getOriginalIndex(
				diffs,
				match.index,
				match[0].length
			);

			if (matchLen) {
				matches.push(matchPos);
				matchesLength.push(matchLen);
			}
		}
	}

	_convertToRegExpString(query, hasDiacritics) {
		const { matchDiacritics } = this._state;
		let isUnicode = false;
		query = query.replaceAll(
			SPECIAL_CHARS_REG_EXP,
			(
				match,
				p1 /* to escape */,
				p2 /* punctuation */,
				p3 /* whitespaces */,
				p4 /* diacritics */,
				p5 /* letters */
			) => {
				// We don't need to use a \s for whitespaces since all the different
				// kind of whitespaces are replaced by a single " ".

				if (p1) {
					// Escape characters like *+?... to not interfer with regexp syntax.
					return `[ ]*\\${p1}[ ]*`;
				}
				if (p2) {
					// Allow whitespaces around punctuation signs.
					return `[ ]*${p2}[ ]*`;
				}
				if (p3) {
					// Replace spaces by \s+ to be sure to match any spaces.
					return "[ ]+";
				}
				if (matchDiacritics) {
					return p4 || p5;
				}

				if (p4) {
					// Diacritics are removed with few exceptions.
					return DIACRITICS_EXCEPTION.has(p4.charCodeAt(0)) ? p4 : "";
				}

				// A letter has been matched and it can be followed by any diacritics
				// in normalized text.
				if (hasDiacritics) {
					isUnicode = true;
					return `${p5}\\p{M}*`;
				}
				return p5;
			}
		);

		const trailingSpaces = "[ ]*";
		if (query.endsWith(trailingSpaces)) {
			// The [ ]* has been added in order to help to match "foo . bar" but
			// it doesn't make sense to match some whitespaces after the dot
			// when it's the last character.
			query = query.slice(0, query.length - trailingSpaces.length);
		}

		if (matchDiacritics) {
			// aX must not match aXY.
			if (hasDiacritics) {
				DIACRITICS_EXCEPTION_STR ||= String.fromCharCode(
					...DIACRITICS_EXCEPTION
				);

				isUnicode = true;
				query = `${query}(?=[${DIACRITICS_EXCEPTION_STR}]|[^\\p{M}]|$)`;
			}
		}

		return [isUnicode, query];
	}

	async _calculateMatch(pageIndex) {
		let query = this._query;
		if (query.length === 0) {
			return; // Do nothing: the matches should be wiped out already.
		}
		const { caseSensitive, entireWord } = this._state;
		const pageContent = this._pageContents[pageIndex];
		const hasDiacritics = this._hasDiacritics[pageIndex];

		let isUnicode = false;
		if (typeof query === "string") {
			[isUnicode, query] = this._convertToRegExpString(query, hasDiacritics);
		}
		else {
			// Words are sorted in reverse order to be sure that "foobar" is matched
			// before "foo" in case the query is "foobar foo".
			query = query.sort().reverse().map(q => {
				const [isUnicodePart, queryPart] = this._convertToRegExpString(
					q,
					hasDiacritics
				);
				isUnicode ||= isUnicodePart;
				return `(${queryPart})`;
			}).join("|");
		}

		const flags = `g${isUnicode ? "u" : ""}${caseSensitive ? "" : "i"}`;
		query = query ? new RegExp(query, flags) : null;

		this._calculateRegExpMatch(query, entireWord, pageIndex, pageContent);

		if (this._resumePageIdx === pageIndex) {
			this._resumePageIdx = null;
			this._nextPageMatch();
		}

		// Update the match count.
		const pageMatchesCount = this._pageMatches[pageIndex].length;
		this._matchesCountTotal += pageMatchesCount;
		if (pageMatchesCount > 0) {
			this._onUpdateMatches({
				matchesCount: this._requestMatchesCount(),
			});
		}
	}

	_extractText() {
		// Perform text extraction once if this method is called multiple times.
		if (this._extractTextPromises.length > 0) {
			return;
		}

		let resolvers = [];
		for (let i = 0, ii = this._linkService.pagesCount; i < ii; i++) {
			const { promise, resolve } = Promise.withResolvers();
			this._extractTextPromises[i] = promise;
			resolvers.push(resolve);
		}

		(async () => {
			for (let i = 0; i < resolvers.length; i++) {
				let resolve = resolvers[i];

				let text = [];

				try {
					await new Promise(resolve => setTimeout(resolve));
					let pageData = await this._pdfDocument.getPageData({ pageIndex: i });
					if (!this._charMapping[i]) {
						this._charMapping[i] = [];
					}
					for (let j = 0; j < pageData.chars.length; j++) {
						let char = pageData.chars[j];
						text.push(char.u);
						for (let k = 0; k < char.u.length; k++) {
							this._charMapping[i].push(j);
						}
						if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
							text.push(' ');
							this._charMapping[i].push(j);
						}
					}
				}
				catch (e) {
					console.log(e);
				}

				text = text.join('').trim();

				[
					this._pageContents[i],
					this._pageDiffs[i],
					this._hasDiacritics[i],
				] = normalize(text);

				resolve();
			}
		})();
	}

	_nextMatch() {
		const previous = this._state.findPrevious;
		const currentPageIndex = this._linkService.page - 1;
		const numPages = this._linkService.pagesCount;

		this._highlightMatches = true;

		if (this._dirtyMatch) {
			// Need to recalculate the matches, reset everything.
			this._dirtyMatch = false;
			this._selected.pageIdx = this._selected.matchIdx = -1;
			this._offset.pageIdx = currentPageIndex;
			this._offset.matchIdx = null;
			this._offset.wrapped = false;
			this._resumePageIdx = null;
			this._pageMatches.length = 0;
			this._pageMatchesLength.length = 0;
			this._visitedPagesCount = 0;
			this._matchesCountTotal = 0;

			for (let i = 0; i < numPages; i++) {
				// Start finding the matches as soon as the text is extracted.
				if (this._pendingFindMatches.has(i)) {
					continue;
				}
				this._pendingFindMatches.add(i);
				this._extractTextPromises[i].then(() => {
					this._pendingFindMatches.delete(i);
					this._calculateMatch(i);
				});
			}
		}

		// If there's no query there's no point in searching.
		const query = this._query;
		if (query.length === 0) {
			this._updateUIState(FindState.FOUND);
			return;
		}
		// If we're waiting on a page, we return since we can't do anything else.
		if (this._resumePageIdx) {
			return;
		}

		const offset = this._offset;
		// Keep track of how many pages we should maximally iterate through.
		this._pagesToSearch = numPages;
		// If there's already a `matchIdx` that means we are iterating through a
		// page's matches.
		if (offset.matchIdx !== null) {
			const numPageMatches = this._pageMatches[offset.pageIdx].length;
			if (
				(!previous && offset.matchIdx + 1 < numPageMatches) ||
				(previous && offset.matchIdx > 0)
			) {
				// The simple case; we just have advance the matchIdx to select
				// the next match on the page.
				offset.matchIdx = previous ? offset.matchIdx - 1 : offset.matchIdx + 1;
				this._updateMatch(/* found = */ true);
				return;
			}
			// We went beyond the current page's matches, so we advance to
			// the next page.
			this._advanceOffsetPage(previous);
		}
		// Start searching through the page.
		this._nextPageMatch();
	}

	_matchesReady(matches) {
		const offset = this._offset;
		const numMatches = matches.length;
		const previous = this._state.findPrevious;

		if (numMatches) {
			// There were matches for the page, so initialize `matchIdx`.
			offset.matchIdx = previous ? numMatches - 1 : 0;
			this._updateMatch(/* found = */ true);
			return true;
		}
		// No matches, so attempt to search the next page.
		this._advanceOffsetPage(previous);
		if (offset.wrapped) {
			offset.matchIdx = null;
			if (this._pagesToSearch < 0) {
				// No point in wrapping again, there were no matches.
				this._updateMatch(/* found = */ false);
				// While matches were not found, searching for a page
				// with matches should nevertheless halt.
				return true;
			}
		}
		// Matches were not found (and searching is not done).
		return false;
	}

	_nextPageMatch() {
		if (this._resumePageIdx !== null) {
			console.error("There can only be one pending page.");
		}

		let matches = null;
		do {
			const pageIdx = this._offset.pageIdx;
			matches = this._pageMatches[pageIdx];
			if (!matches) {
				// The matches don't exist yet for processing by `_matchesReady`,
				// so set a resume point for when they do exist.
				this._resumePageIdx = pageIdx;
				break;
			}
		} while (!this._matchesReady(matches));
	}

	_advanceOffsetPage(previous) {
		const offset = this._offset;
		const numPages = this._linkService.pagesCount;
		offset.pageIdx = previous ? offset.pageIdx - 1 : offset.pageIdx + 1;
		offset.matchIdx = null;

		this._pagesToSearch--;

		if (offset.pageIdx >= numPages || offset.pageIdx < 0) {
			offset.pageIdx = previous ? numPages - 1 : 0;
			offset.wrapped = true;
		}
	}

	_updateMatch(found = false) {
		let state = FindState.NOT_FOUND;
		const wrapped = this._offset.wrapped;
		this._offset.wrapped = false;

		if (found) {
			const previousPage = this._selected.pageIdx;
			this._selected.pageIdx = this._offset.pageIdx;
			this._selected.matchIdx = this._offset.matchIdx;
			state = wrapped ? FindState.WRAPPED : FindState.FOUND;
		}

		this._updateUIState(state, this._state.findPrevious);
		if (this._selected.pageIdx !== -1) {
			this._onNavigate(this._selected.pageIdx, this._selected.matchIdx);
		}
	}

	onClose() {
		const pdfDocument = this._pdfDocument;
		// Since searching is asynchronous, ensure that the removal of highlighted
		// matches (from the UI) is async too such that the 'updatetextlayermatches'
		// events will always be dispatched in the expected order.
		this._firstPageCapability.promise.then(() => {
			// Only update the UI if the document is open, and is the current one.
			if (
				!this._pdfDocument ||
				(pdfDocument && this._pdfDocument !== pdfDocument)
			) {
				return;
			}
			// Ensure that a pending, not yet started, search operation is aborted.
			if (this._findTimeout) {
				clearTimeout(this._findTimeout);
				this._findTimeout = null;
			}
			// Abort any long running searches, to avoid a match being scrolled into
			// view *after* the findbar has been closed. In this case `this._offset`
			// will most likely differ from `this._selected`, hence we also ensure
			// that any new search operation will always start with a clean slate.
			if (this._resumePageIdx) {
				this._resumePageIdx = null;
				this._dirtyMatch = true;
			}

			this._highlightMatches = false;

			// Avoid the UI being in a pending state when the findbar is re-opened.
			this._updateUIState(FindState.FOUND);
		});
	}

	_requestMatchesCount() {
		const { pageIdx, matchIdx } = this._selected;
		let current = 0,
			total = this._matchesCountTotal;
		if (matchIdx !== -1) {
			for (let i = 0; i < pageIdx; i++) {
				current += this._pageMatches[i]?.length || 0;
			}
			current += matchIdx + 1;
		}

		let snippets = [];
		for (let i = 0; i < this._pageMatches.length; i++) {
			let pageMatches = this._pageMatches[i];
			if (pageMatches) {
				for (let j = 0; j < pageMatches.length; j++) {
					let offsetStart = this._pageMatches[i][j];
					let offsetEnd = offsetStart + this._pageMatchesLength[i][j];
					let snippet = getSnippet(this._pageContents[i], offsetStart, offsetEnd, 5, 5);
					snippets.push(snippet);
				}
			}
		}

		// When searching starts, this method may be called before the `pageMatches`
		// have been counted (in `_calculateMatch`). Ensure that the UI won't show
		// temporarily broken state when the active find result doesn't make sense.
		if (current < 1 || current > total) {
			current = total = 0;
		}

		let currentOffsetStart = -1;
		let currentOffsetEnd = -1;
		let currentPageIndex = -1;

		if (total) {
			if (this._pageMatches[pageIdx]) {
				currentOffsetStart = this._pageMatches[pageIdx][matchIdx];
				currentOffsetEnd = currentOffsetStart + this._pageMatchesLength[pageIdx][matchIdx];
				currentPageIndex = pageIdx;
			}
		}

		// Adjust offset positions to account for virtual spaces and characters that
		// consist of multiple decomposed characters
		if (currentOffsetStart >= 0) {
			currentOffsetStart = this._charMapping[pageIdx][currentOffsetStart];
			currentOffsetEnd = this._charMapping[pageIdx][currentOffsetEnd - 1];
		}

		return { current, total, currentPageIndex, currentOffsetStart, currentOffsetEnd, snippets };
	}

	_updateUIState(state, previous = false) {
		this._onUpdateState({
			state,
			previous,
			entireWord: this._state?.entireWord ?? null,
			matchesCount: this._requestMatchesCount(),
			rawQuery: this._state?.query ?? null,
		});
	}
}

export { FindState, PDFFindController };
