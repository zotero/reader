import React from 'react';

function TickedRangeInput({ min, max, step, ...rest }) {
	min = parseFloat(min);
	max = parseFloat(max);
	step = parseFloat(step);

	let tickPositions = [];

	let numSteps = (max - min) / step;
	for (let percentageStep = 0; percentageStep < numSteps + 1; percentageStep++) {
		let percentage = (100 / numSteps) * (percentageStep);
		tickPositions.push(`${percentage}%`);
	}
	return (
		<div className="ticked-range-input">
			<div className="tick-bar">
				{tickPositions.map((position, i) => (
					<div key={i} className="tick" style={{ '--position': position }} />
				))}
			</div>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				{...rest}
				style={{ position: 'relative', width: '100%' }}
			/>
		</div>
	);
}

export default TickedRangeInput;
