import React from 'react';

import IconRevert from '../../../../res/icons/16/revert.svg';
import { useIntl } from "react-intl";

const pointerAction = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
	? 'tap'
	: 'click';

function SnapshotZapperPopup({ numZapped, onRestoreAll }) {
	const intl = useIntl();

	return (
		<div className="snapshot-zapper-popup">
			{numZapped === 0 && <span className="instructions">
				{intl.formatMessage({ id: `pdfReader.snapshotZapper.${pointerAction}ToRemove` })}
			</span>}
			{numZapped !== 0 && <>
				<button id="restore-all" className="toolbar-button" onClick={onRestoreAll}>
					<IconRevert/>
				</button>
				<label className="restore-all-label" htmlFor="restore-all">
					{intl.formatMessage({ id: 'pdfReader.snapshotZapper.restoreAll' })}
				</label>
			</>}
		</div>
	);
}

export default SnapshotZapperPopup;
