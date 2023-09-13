import React, { memo, useEffect, useRef } from 'react';

let CustomSections = memo(({ type, ...props }) => {
	let sectionRef = useRef();
	useEffect(() => {
		sectionRef.current.replaceChildren();
		let finished = false;
		let append = (...args) => {
			if (finished) {
				throw new Error('Append must be called directly and synchronously in the event');
			}
			let section = document.createElement('div');
			section.className = 'section';
			section.append(...args);
			sectionRef.current.append(section);
		};
		let event = new CustomEvent(`customEvent`, { detail: { type: `render${type}`, doc: document, append, params: props } });
		window.dispatchEvent(event);
		finished = true;
	});
	return (
		<div ref={sectionRef} className="custom-sections"/>
	);
});

export default CustomSections;
