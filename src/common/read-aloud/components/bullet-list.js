import React from 'react';
import { useLocalization } from '@fluent/react';

const TIER_BULLETS = {
	local: ['os-provided', 'offline', 'no-account', 'free'],
	standard: ['ai-generated', 'online-only', 'account-required', 'limited-languages', 'no-multilingual', 'internal-processing', 'unlimited-with-subscription'],
	premium: ['highest-quality', 'online-only', 'account-required', 'broad-languages', 'multilingual', 'external-processing', 'subscription-minutes', 'beta-credits'],
};

export function BulletList({ tier, onPurchaseCredits }) {
	const { l10n } = useLocalization();

	let prefix = `reader-read-aloud-first-run-voice-tier-${tier}-bullet`;
	let bullets = TIER_BULLETS[tier];
	let lines = bullets.map(name => l10n.getString(`${prefix}-${name}`));

	function renderLine(line) {
		let parts = [];

		let match = line.match(/^(.*?)<purchase-credits>(.+)<\/purchase-credits>(.*)$/);
		if (match && onPurchaseCredits) {
			let [, before, button, after] = match;
			if (before) {
				parts.push(<span key="before">{before}</span>);
			}
			parts.push(
				<button
					key="button"
					className="purchase-credits"
					type="button"
					onClick={onPurchaseCredits}
				>
					{button}
				</button>
			);
			if (after) {
				parts.push(<span key="after">{after}</span>);
			}
		}
		else {
			parts.push(<span key="line">{line}</span>);
		}

		return parts;
	}

	return (
		<ul>
			{lines.map((line, i) => <li key={i}>{renderLine(line)}</li>)}
		</ul>
	);
}
