import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSDTReadAloudSegments } from '../../src/common/read-aloud/sdt-segments.ts';

test('buildSDTReadAloudSegments: positions text after a group elided partway through its node', () => {
	// The linked group "(see Smith 2020)" starts partway through the first node
	// and ends partway through the third, so the third node is read from its
	// second character on
	let structure = {
		metadata: { source: {} },
		content: [{
			type: 'paragraph',
			content: [
				{ text: 'Claim (see ' },
				{ text: 'Smith 2020', refs: [{ type: 'reference' }] },
				{ text: ') holds. Next sentence.' },
			],
		}],
	};

	let { segments } = buildSDTReadAloudSegments(structure, 'sentence', 'en');

	assert.deepEqual(segments.map(segment => segment.text), ['Claim holds.', 'Next sentence.']);
	// Ends after the final period of ") holds. Next sentence."
	assert.deepEqual(segments[1].position.end, [0, 2, 23]);
});
