
export let ANNOTATION_COLORS = [
	['general-yellow', '#ffd400'],
	['general-red', '#ff6666'],
	['general-green', '#5fb236'],
	['general-blue', '#2ea8e5'],
	['general-purple', '#a28ae5'],
	['general-magenta', '#e56eee'],
	['general-orange', '#f19837'],
	['general-gray', '#aaaaaa']
];

export let EXTRA_INK_AND_TEXT_COLORS = [
	['general-black', '#000000']
];

export const DARKEN_INK_AND_TEXT_COLOR = 5; // percent

// https://developer.mozilla.org/en-US/docs/Web/CSS/system-color
//export let SELECTION_COLOR = navigator.platform.includes('Mac') ? '#71ADFD' : 'Highlight';
// TEMP: Use Mac color everywhere, since Highlight is too dark on Windows without opacity
export let SELECTION_COLOR = '#71ADFD';

export const PDF_NOTE_DIMENSIONS = 22; // pt
export const MIN_IMAGE_ANNOTATION_SIZE = 10; // pt
export const MIN_TEXT_ANNOTATION_WIDTH = 10; // pt

export const DEBOUNCE_STATE_CHANGE = 300; // ms
export const DEBOUNCE_STATS_CHANGE = 100; // ms
export const DEBOUNCE_FIND_POPUP_INPUT = 500; // ms

export const FIND_RESULT_COLOR_ALL_LIGHT = 'rgba(180,0,170,0.3)';
export const FIND_RESULT_COLOR_CURRENT_LIGHT = 'rgba(0,100,0,0.3)';
export const FIND_RESULT_COLOR_ALL_DARK = 'rgba(180,0,170,0.6)';
export const FIND_RESULT_COLOR_CURRENT_DARK = 'rgba(0,100,0,0.6)';

export const ANNOTATION_POSITION_MAX_SIZE = 65000;

export const INK_ANNOTATION_WIDTH_STEPS = [
	0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5,
	6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5,
	13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19,
	19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23, 23.5, 24, 24.5, 25
];

export const TEXT_ANNOTATION_FONT_SIZE_STEPS = [6, 8, 10, 12, 14, 18, 24, 36, 48, 64, 72, 96, 144, 192];

export const DEFAULT_THEMES = [
	{ id: 'dark', label: 'Dark', background: "#2E3440", foreground: "#D8DEE9" },
	{ id: 'snow', label: 'Snow', background: "#ECEFF4", foreground: "#3B4252" },
	{ id: 'sepia', label: 'Sepia', background: "#F4ECD8", foreground: "#5B4636" }
];

export const A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH = 500; // ms
