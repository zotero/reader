import React, { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import ViewPopup from '../common/view-popup';
import cx from 'classnames';


function FormattedText({ chars, onOpenLink }) {
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

function Loader() {
	return (
		<div className="loading-container">
			<div className="loading-line"></div>
		</div>
	);
}

function ItemPreview({ item, adding, onOpenLink, onAddToLibrary, onShowInLibrary, onOpenInReader }) {
	let [abstractExpanded, setAbstractExpanded] = useState(false);

	function handleOpenLink() {
		onOpenLink(item.url);
	}

	function handleAddToLibrary() {
		onAddToLibrary();
	}

	function handleShowInLibrary() {
		onShowInLibrary(item.itemID);
	}

	function handleOpenInReader() {
		onOpenInReader(item.attachmentID);
	}

	function handleAbstractPointerDown() {
		setAbstractExpanded(true);
	}

	return (
		<div className="item-preview">
			<div className="header">
				<div className="start selectable">
					<div className="title">
						<div className="title">{item.title}</div>
					</div>
					<div className="author-year">
						<div className="authors">{item.creator}</div>
						<div className="year">{item.year}</div>
					</div>
				</div>
				<div className="end">
					{item.itemID && <button onClick={handleShowInLibrary}>Show in Library</button>}
					{item.itemID && item.attachmentID && <button onClick={handleOpenInReader}>Open in Reader</button>}
					{(!item.itemID || !item.attachmentID) && item.url && <button onClick={handleOpenLink}>View Online</button>}
					{!item.itemID && <button onClick={handleAddToLibrary}>Add to Library{adding && <div className="spinner"/>}</button>}
				</div>
			</div>
			<div className={cx('abstract', { expanded: abstractExpanded, selectable: abstractExpanded })} onPointerDown={handleAbstractPointerDown}>{item.abstract}</div>
		</div>
	);
}

function Reference({ reference, expansionState, showText, onNavigate, onOpenLink, onExpand, onRecognizeReference, onAddToLibrary, onShowInLibrary, onOpenInReader }) {
	let [loading, setLoading] = useState(false);
	let [item, setItem] = useState(null);
	let [adding, setAdding] = useState(false);
	let loadingStartedRef = useRef(false);
	let [failed, setFailed] = useState(false);
	function handleClick() {
		let { position } = reference;
		// onNavigate({ position });
	}

	useLayoutEffect(() => {
		if (loadingStartedRef.current || expansionState === 0) {
			return;
		}
		loadingStartedRef.current = true;
		setLoading(true);
		(async () => {
			let { textParts } = reference;
			onRecognizeReference(textParts, (result) => {
				setLoading(false);
				setItem(result);
				if (!result) {
					setFailed(true);
				}
			});
		})();
	});

	function handleAddToLibrary() {
		setAdding(true);
		let { textParts } = reference;
		onAddToLibrary(textParts, (result) => {
			setAdding(false);
			setItem(result);
		});
	}

	function handleSearchGoogleScholar() {
		let text = reference.textParts.map(item => item.text).join('');
		onOpenLink('https://scholar.google.com/scholar?q=' + encodeURIComponent(text));
	}

	return (
		<div className={cx('reference', { expanded: expansionState > 0, resolved: expansionState > 0 && !!item })} onClick={handleClick}>
			{showText && <div className={cx('text', { expanded: expansionState === 2 || failed, selectable: expansionState === 2 || failed })} onPointerDown={() => onExpand()}>
				<FormattedText chars={reference.chars} onOpenLink={onOpenLink}/>
			</div>}
			{loading && (<Loader/>)}
			{(expansionState > 0 && item &&
				<ItemPreview
					item={item}
					adding={adding}
					onAddToLibrary={handleAddToLibrary}
					onOpenInReader={onOpenInReader}
					onOpenLink={onOpenLink}
					onShowInLibrary={onShowInLibrary}
				/>)}
			{expansionState > 0 && failed && (<div className="failed"><button onClick={handleSearchGoogleScholar}>Search on Google Scholar</button></div>)}
		</div>
	);
}

export default function ReferencePopup(props) {
	const intl = useIntl();
	const containerRef = useRef();
	const [expansionState, setExpansionState] = useState(props.params.references.length > 1 ? 0 : 1);
	const [expandedRefIdx, setExpandedRefIdx] = useState(props.params.references.length > 1 ? null : 0);

	return (
		<ViewPopup
			className="reference-popup"
			rect={props.params.rect}
			uniqueRef={props.params.ref}
			padding={10}
		>
			<div className="inner">
				{props.params.references.map((reference, index) => {
					return <Reference
						key={index}
						reference={reference}
						expansionState={index === expandedRefIdx ? expansionState : 0}
						showText={props.params.type === 'citation'}
						onNavigate={props.onNavigate}
						onOpenLink={props.onOpenLink}
						onRecognizeReference={props.onRecognizeReference}
						onAddToLibrary={props.onAddToLibrary}
						onShowInLibrary={props.onShowInLibrary}
						onOpenInReader={props.onOpenInReader}
						onExpand={() => {
							if (index === expandedRefIdx) {
								setExpansionState(Math.min(expansionState + 1, 2));
							}
							else {
								setExpandedRefIdx(index);
								setExpansionState(1);
							}
						}}
					/>;
				})}
			</div>
		</ViewPopup>
	);
}
