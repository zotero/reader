/* eslint-disable react/prop-types */
import React, { useState } from 'react';

// Built-in Zotero assets only; custom item types never become resource paths.
const ITEM_TYPES = new Set([
	'artwork',
	'audioRecording',
	'bill',
	'blogPost',
	'book',
	'bookSection',
	'case',
	'computerProgram',
	'conferencePaper',
	'dataset',
	'dictionaryEntry',
	'document',
	'email',
	'encyclopediaArticle',
	'film',
	'forumPost',
	'hearing',
	'instantMessage',
	'interview',
	'journalArticle',
	'letter',
	'magazineArticle',
	'manuscript',
	'map',
	'newspaperArticle',
	'patent',
	'podcast',
	'preprint',
	'presentation',
	'radioBroadcast',
	'report',
	'standard',
	'statute',
	'thesis',
	'tvBroadcast',
	'videoRecording',
	'webpage',
]);

export default function ReferenceItemIcon({ itemType, attachment = false, colorScheme, children }) {
	let name = attachment
		? 'attachment-file'
		: ITEM_TYPES.has(itemType)
			? itemType.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)
			: 'document';
	let [failed, setFailed] = useState(null);
	if (failed === name) return children || null;
	let size = attachment ? 12 : 16;
	let path = `resource://app/chrome/skin/default/zotero/item-type/${size}/`;
	return <picture className="reference-item-icon" aria-hidden="true">
		<source media={colorScheme === 'dark' ? 'all' : colorScheme === 'light' ? 'not all' : '(prefers-color-scheme: dark)'}
			srcSet={`${path}dark/${name}.svg`}/>
		<img src={`${path}light/${name}.svg`} width={size} height={size} alt="" onError={() => setFailed(name)}/>
	</picture>;
}
