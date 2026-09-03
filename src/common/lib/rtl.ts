// RTL script codes
// https://www.w3.org/International/questions/qa-scripts#directions
// TODO: Remove this once there's good browser support for Intl.Locale#getTextInfo()
const RTL_SCRIPTS = new Set([
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

/**
 * Whether a language tag's script is written right-to-left, guessing the
 * script from the language when the tag doesn't name one
 */
export function isRTLLang(lang: string): boolean {
	try {
		let script = new Intl.Locale(lang).maximize().script;
		return !!script && RTL_SCRIPTS.has(script);
	}
	catch (e) {
		return false;
	}
}
