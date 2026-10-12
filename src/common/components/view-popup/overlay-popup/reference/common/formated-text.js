/* eslint-disable react/prop-types */
import React, { Fragment } from 'react';

export function createReferenceTextRuns(chars, includeURLs = true) {
	let runs = [];
	for (let char of chars || []) {
		if (char.ignorable) continue;
		let style = {
			bold: !!char.bold,
			italic: !!char.italic,
			url: includeURLs ? char.url || null : null,
		};
		let previous = runs.at(-1);
		if (!previous
				|| previous.bold !== style.bold
				|| previous.italic !== style.italic
				|| previous.url !== style.url) {
			previous = { text: '', ...style };
			runs.push(previous);
		}
		previous.text += char.c || '';
		if ((char.spaceAfter || char.lineBreakAfter) && previous.text) {
			previous.text += ' ';
		}
	}
	return runs.filter(run => run.text);
}

function FormattedTextRun({ text, bold, italic, url, onOpenLink, linkTabIndex }) {
	function handleLinkClick(event) {
		event.preventDefault();
		event.stopPropagation();
		onOpenLink(url);
	}

	let jsx = <span>{text}</span>;
	if (url) {
		jsx = (
			<a href={url} title={url} tabIndex={linkTabIndex} onClick={handleLinkClick}>{jsx}</a>
		);
	}
	if (italic) {
		jsx = <em>{jsx}</em>;
	}
	if (bold) {
		jsx = <strong>{jsx}</strong>;
	}

	return jsx;
}

export default function FormattedText({
	chars,
	onOpenLink,
	linksEnabled = true,
	linkTabIndex,
}) {
	const groups = React.useMemo(() => {
		return createReferenceTextRuns(chars, linksEnabled);
	}, [chars, linksEnabled]);

	return (
		<Fragment>
			{groups.map((group, index) => (
				<FormattedTextRun
					key={index}
					{...group}
					onOpenLink={onOpenLink}
					linkTabIndex={linkTabIndex}
				/>
			))}
		</Fragment>
	);
}
