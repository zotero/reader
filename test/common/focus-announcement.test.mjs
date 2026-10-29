import assert from 'node:assert/strict';
import test from 'node:test';
import { getFocusAnnouncement } from '../../src/common/focus-announcement.mjs';

test('focus announcements describe link destinations, citations and annotations', () => {
	let getString = id => id === 'reader-page' ? 'Page' : 'Highlight annotation';
	let link = { type: 'internal-link', destinationPosition: { pageIndex: 2 } };
	assert.equal(getFocusAnnouncement(link, getString, ['i', 'ii', 'iii']), 'Page: iii.');
	assert.equal(getFocusAnnouncement(link, getString), 'Page: 3.');
	assert.equal(getFocusAnnouncement({ type: 'citation', references: [{ text: 'Smith, 2024' }] }, getString), 'Smith, 2024');
	assert.equal(getFocusAnnouncement({ type: 'highlight', text: 'Quote' }, getString), 'Highlight annotation. Quote');
});
