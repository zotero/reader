
export let ANNOTATION_COLORS = [
	['general.yellow', '#ffd400'],
	['general.red', '#ff6666'],
	['general.green', '#5fb236'],
	['general.blue', '#2ea8e5'],
	['general.purple', '#a28ae5'],
	['general.magenta', '#e56eee'],
	['general.orange', '#f19837'],
	['general.gray', '#aaaaaa']
];

export let EXTRA_INK_AND_TEXT_COLORS = [
	['general.black', '#000000']
];

// https://developer.mozilla.org/en-US/docs/Web/CSS/system-color
//export let SELECTION_COLOR = navigator.platform.includes('Mac') ? '#71ADFD' : 'Highlight';
// TEMP: Use Mac color everywhere, since Highlight is too dark on Windows without opacity
export let SELECTION_COLOR = '#71ADFD';

export const PDF_NOTE_DIMENSIONS = 22; // pt
export const DEFAULT_TEXT_ANNOTATION_FONT_SIZE = 14; // pt
export const MIN_IMAGE_ANNOTATION_SIZE = 10; // pt

export const DEBOUNCE_STATE_CHANGE = 300; // ms
export const DEBOUNCE_STATS_CHANGE = 100; // ms
export const DEBOUNCE_FIND_POPUP_INPUT = 500; // ms
