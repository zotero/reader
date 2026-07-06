import React from 'react';
import cx from 'classnames';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * @param {Object} props
 * @param {number} props.progress Completion as a 0-100 percentage
 * @param {string} [props.className]
 */
function ProgressRing({ progress, className }) {
	let fraction = Math.max(0, Math.min(1, (Number(progress) || 0) / 100));
	return (
		<svg
			className={cx('progress-ring', className)}
			width="16"
			height="16"
			viewBox="0 0 16 16"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(fraction * 100)}
		>
			<circle
				className="progress-ring-track"
				cx="8"
				cy="8"
				r={RADIUS}
				fill="none"
				strokeWidth="2"
			/>
			<circle
				className="progress-ring-value"
				cx="8"
				cy="8"
				r={RADIUS}
				fill="none"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={CIRCUMFERENCE}
				// Set via style (a real CSS property) so the SCSS transition eases it
				style={{ strokeDashoffset: CIRCUMFERENCE * (1 - fraction) }}
				transform="rotate(-90 8 8)"
			/>
		</svg>
	);
}

export default ProgressRing;
