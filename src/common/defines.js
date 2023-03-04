
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

// https://developer.mozilla.org/en-US/docs/Web/CSS/system-color
export let SELECTION_COLOR = navigator.platform.includes('Mac') ? '#71ADFD' : 'Highlight';

export const PDF_NOTE_DIMENSIONS = 22; // pt

export const DEBOUNCE_STATE_CHANGE = 300; // ms
export const DEBOUNCE_STATS_CHANGE = 100; // ms
export const DEBOUNCE_FIND_POPUP_INPUT = 500; // ms
