'use strict';

import React from 'react';
import { getPositionBoundingRect } from '../lib/utilities';
import cx from 'classnames';

function Ink({ annotation, isSelected }) {
	let boundingRect = getPositionBoundingRect(annotation.position);
	if (annotation.position.paths) {
		let { width } = annotation.position;
		width = width + 5;
		boundingRect = [
			boundingRect[0] - width,
			boundingRect[1] - width,
			boundingRect[2] + width,
			boundingRect[3] + width
		];
	}

	return (
		<div className={cx('ink-annotation', { selected: isSelected })}>
			<div
				className="square"
				style={{
					left: boundingRect[0],
					top: boundingRect[1],
					width: boundingRect[2] - boundingRect[0],
					height: boundingRect[3] - boundingRect[1]
				}}
			/>
			<svg xmlns="http://www.w3.org/2000/svg">
				{annotation.position.paths.map((path, index) => {
					let svgPath = `M ${path.slice(0, 2).join(',')} L ${path.slice(2).join(',')}`;
					return <path
						key={index}
						fill="none"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={annotation.position.width}
						stroke={annotation.color}
						d={svgPath}
					/>;
				})
				}
			</svg>
		</div>
	);
}

export default Ink;
