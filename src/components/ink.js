'use strict';

import React, { Fragment } from 'react';

function Ink({ annotation }) {
	return (
		<Fragment>
			<svg className="ink-annotation" xmlns="http://www.w3.org/2000/svg">
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
		</Fragment>
	);
}

export default Ink;
