import { isMac, isWin, isLinux } from './utilities';

export function getVoicePreferencesURL() {
	if (isMac()) {
		return 'x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent';
	}
	else if (isWin()) {
		return 'ms-settings:speech';
	}
	else if (isLinux()) {
		return 'https://github.com/brailcom/speechd';
	}
	return null;
}
