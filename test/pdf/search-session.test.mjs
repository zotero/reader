import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFSearchSession } from '../../src/pdf/search-session.mjs';

function state(overrides = {}) {
	return {
		active: true,
		query: 'alpha',
		caseSensitive: false,
		entireWord: false,
		highlightAll: false,
		index: null,
		result: null,
		...overrides,
	};
}

test('changes in SDT eligibility affect only the next query', () => {
	let owner = new PDFSearchSession();
	let firstState = state();
	let first = owner.transition(firstState).session;
	assert.equal(first.backend, 'pdf');

	let sdt = { id: 'sdt' };
	owner.setEligibleSDT(sdt);
	assert.equal(owner.transition(state({ highlightAll: true })).session, first);
	assert.equal(owner.current.backend, 'pdf');

	let second = owner.transition(state({ query: 'beta' })).session;
	assert.equal(second.backend, 'sdt');
	assert.equal(second.sdt, sdt);
	owner.setEligibleSDT(null);
	assert.equal(owner.current, second);
	assert.equal(
		owner.transition(state({ query: 'beta', highlightAll: true })).session,
		second
	);
	let next = owner.transition(state({ query: 'gamma' })).session;
	assert.equal(next.backend, 'pdf');
	assert.equal(next.sdt, null);

	assert.equal(owner.transition(state({
		query: 'gamma',
		highlightAll: true,
		index: 3,
		result: { total: 4 },
	})).session, next);

	assert.notEqual(
		owner.transition(state({ query: 'gamma', caseSensitive: true })).session,
		next,
	);
	let caseSession = owner.current;
	assert.notEqual(
		owner.transition(state({
			query: 'gamma',
			caseSensitive: true,
			entireWord: true,
		})).session,
		caseSession,
	);
});

test('an SDT failure replaces only the current session with PDF fallback', () => {
	let owner = new PDFSearchSession();
	owner.setEligibleSDT({ id: 'sdt' });
	let first = owner.transition(state()).session;
	let fallback = owner.fallbackToPDF(first);
	assert.equal(fallback.backend, 'pdf');
	assert.equal(owner.current, fallback);
	assert.equal(owner.fallbackToPDF(first), null);

	let next = owner.transition(state({ query: 'beta' })).session;
	assert.equal(next.backend, 'sdt');
});
