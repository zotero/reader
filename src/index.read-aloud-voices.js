import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import ReadAloudVoicesPopup from './common/components/modal-popup/read-aloud-voices-popup';
import { addFTL, bundle } from './fluent';
import { getVoicePreferencesURL } from './common/lib/read-aloud-links';

let l10n = new ReactLocalization([bundle]);

window.createReadAloudVoices = (options) => {
	if (Array.isArray(options.ftl)) {
		for (let ftl of options.ftl) {
			addFTL(ftl);
		}
	}

	function handleOpenVoicePreferences() {
		let url = getVoicePreferencesURL();
		if (url) {
			options.onOpenLink(url);
		}
	}

	let pendingResult = null;

	function handleSetEnabledVoices(enabledVoicesByLang) {
		pendingResult = enabledVoicesByLang;
	}

	let popupRef = createRef();

	// Exposed for the parent dialog's accept button
	window.submit = () => {
		popupRef.current?.submit();
		return pendingResult;
	};

	flushSync(() => {
		createRoot(document.getElementById('read-aloud-voices')).render(
			<LocalizationProvider l10n={l10n}>
				<ReadAloudVoicesPopup
					ref={popupRef}
					standalone
					lang={options.lang}
					tier={options.tier}
					remoteInterface={options.remoteInterface}
					persistedEnabledVoices={new Map(Object.entries(options.readAloudEnabledVoices || {}))}
					onSetEnabledVoices={handleSetEnabledVoices}
					onCancel={options.onCancel}
					onPurchaseCredits={options.onPurchaseCredits}
					onOpenVoicePreferences={handleOpenVoicePreferences}
				/>
			</LocalizationProvider>
		);
	});
};
