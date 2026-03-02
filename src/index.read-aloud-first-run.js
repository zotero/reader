import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import ReadAloudFirstRunPopup from './common/components/modal-popup/read-aloud-first-run-popup';
import { addFTL, bundle } from './fluent';

let l10n = new ReactLocalization([bundle]);

window.createReadAloudFirstRun = (options) => {
	if (Array.isArray(options.ftl)) {
		for (let ftl of options.ftl) {
			addFTL(ftl);
		}
	}

	let pendingResult = null;

	function handleDone({ lang, region, voice, speed, tier }) {
		pendingResult = { lang, region, voice, speed, tier };
	}

	let popupRef = createRef();
	let root = createRoot(document.getElementById('read-aloud-first-run'));

	function render() {
		root.render(
			<LocalizationProvider l10n={l10n}>
				<ReadAloudFirstRunPopup
					ref={popupRef}
					standalone
					lang={options.lang}
					remoteInterface={options.remoteInterface}
					loggedIn={options.loggedIn}
					onOpenVoicesPopup={options.onOpenVoicesPopup}
					onPurchaseCredits={options.onPurchaseCredits}
					onLogIn={options.onLogIn}
					onCancel={options.onCancel}
					onDone={handleDone}
					onSetDoneMode={options.onSetDoneMode}
				/>
			</LocalizationProvider>
		);
	}

	// Exposed for the parent dialog's accept button
	window.submit = () => {
		popupRef.current?.submit();
		return pendingResult;
	};

	flushSync(() => render());
};
