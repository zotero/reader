import React from 'react';

export default function FormattedText({ chars, onOpenLink }) {
	// Helper function to create JSX from text and its properties
	function CreateJSX({ text, bold, italic, url }) {

		function handleLinkClick(event) {
			event.preventDefault();
			event.stopPropagation();
			onOpenLink(url);
		}

		let jsx = <span>{text}</span>;
		if (url) {
			jsx = <a href={url} onClick={handleLinkClick}>{jsx}</a>;
		}
		if (italic) {
			jsx = <em>{jsx}</em>;
		}
		if (bold) {
			jsx = <strong>{jsx}</strong>;
		}

		return jsx;
	}

	// Convert the chars array to JSX by grouping and formatting
	const formattedText = React.useMemo(() => {
		return chars.reduce((acc, char, index) => {
			const { c: currentChar, bold: isBold, italic: isItalic, url, spaceAfter } = char;
			if (!char.ignorable) {
				// Start a new group if different style or first character
				if (index === 0 || acc[acc.length - 1].isBold !== isBold || acc[acc.length - 1].isItalic !== isItalic || acc[acc.length - 1].url !== url) {
					acc.push({ text: currentChar, isBold, isItalic, url });
				}
				else {
					// Append to the current group if same style
					acc[acc.length - 1].text += currentChar;
				}
				if (spaceAfter || char.lineBreakAfter && index !== chars.length - 1) {
					acc[acc.length - 1].text += ' ';
				}
			}
			return acc;
		}, []).map((group, index) => <CreateJSX key={index} text={group.text} bold={group.bold} italic={group.italic} url={group.url}/>);
	}, [chars]);

	return (
		<div>
			{formattedText}
		</div>
	);
}
