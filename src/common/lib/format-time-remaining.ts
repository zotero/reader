export function formatTimeRemaining(minutes: number | null): string | null {
	if (minutes === null || minutes > 60 * 24 * 90) {
		// Unlimited, or effectively unlimited
		return null;
	}

	let days = Math.floor(minutes / (60 * 24));
	let hours = Math.floor((minutes % (60 * 24)) / 60);
	minutes = Math.ceil(minutes % 60);

	if ('DurationFormat' in Intl) {
		return new (Intl as any).DurationFormat(undefined, {
			style: 'narrow',
			daysDisplay: 'auto',
			hoursDisplay: 'auto',
			minutesDisplay: 'always',
		}).format({ days, hours, minutes });
	}

	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}
