export const EPUB_LOCATION_BREAK_INTERVAL = 1800;

// RTL script codes
// https://www.w3.org/International/questions/qa-scripts#directions
// TODO: Remove this once there's good browser support for Intl.Locale#getTextInfo()
export const RTL_SCRIPTS = new Set([
	'Adlm',
	'Arab',
	'Aran',
	'Rohg',
	'Hebr',
	'Mand',
	'Mend',
	'Nkoo',
	'Hung',
	'Samr',
	'Syrc',
	'Thaa',
	'Yezi',
]);

export const A11Y_VIRT_CURSOR_DEBOUNCE_LENGTH = 500;
