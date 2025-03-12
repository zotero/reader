import React, { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import ViewPopup from '../common/view-popup';
import cx from 'classnames';

import IconCitationCached from '../../../../../res/icons/16/citation-cached.svg';
import IconCitationNoMatch from '../../../../../res/icons/16/citation-no-match.svg';
import IconChevronDown from '../../../../../res/icons/16/chevron-12-down.svg';
import IconChevronUp from '../../../../../res/icons/16/chevron-12-up.svg';
import IconChevronLeft from '../../../../../res/icons/16/chevron-12-left.svg';
import IconLibraryLookup from '../../../../../res/icons/16/library-lookup.svg';
import IconSpinner from '../../../../../res/icons/16/spinner.svg';

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
			jsx = <a href={url} title={url} onClick={handleLinkClick}>{jsx}</a>;
		}
		if (italic) {
			jsx = <em>{jsx}</em>;
		}
		if (bold) {
			jsx = <strong>{jsx}</strong>;
		}

		return jsx;
	}

	// Convert the char array to JSX by grouping and formatting
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
		<Fragment>
			{formattedText}
		</Fragment>
	);
}

function ReferencePreview({ reference, showText, onOpenLink, onRecognizeReference, onAddToLibrary, onShowInLibrary, onOpenInReader, onReturn }) {
	let [item, setItem] = useState({ status: 'loading' });
	let [adding, setAdding] = useState(false);
	let [expanded, setExpanded] = useState(false);
	let [canExpand, setCanExpand] = useState(false);

	let textRef = useRef(null);

	useEffect(() => {
		if (item?.status === 'unrecognized') {
			setExpanded(true);
		}
	}, [item?.status]);

	useLayoutEffect(() => {
		if (textRef.current && textRef.current.scrollHeight > textRef.current.clientHeight) {
			if (!canExpand) {
				setCanExpand(true);
			}
		}
		else {
			if (canExpand) {
				setCanExpand(false);
			}
		}
	});

	useEffect(() => {
		let cancelled = false;
		setExpanded(false);
		(async () => {
			let { textParts } = reference;
			onRecognizeReference(textParts, 'full', (result) => {
				if (!cancelled) {
					setItem(result);
				}
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [reference]);

	function handleOpenLink() {
		onOpenLink(item.url);
	}

	function handleShowInLibrary() {
		onShowInLibrary(item.itemID);
	}

	function handleOpenInReader() {
		onOpenInReader(item.attachmentID);
	}

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

	function handleExpand() {
		setExpanded(true);
	}

	function handleCollapse() {
		setExpanded(false);
	}

	let icon = <IconSpinner className="spinner-16"/>;

	if (item.status === 'unmatched') {
		icon = <IconLibraryLookup/>;
	}
	else if (item.status === 'unrecognized') {
		icon = <IconCitationNoMatch/>;
	}
	else if (item.status === 'recognized') {
		icon = <IconCitationCached/>;
	}
	else if (item.status === 'matched') {
		icon = <img src={item.imageSrc}/>;
	}

	return (
		<div className="reference-preview">
			<div className="header">
				{onReturn && <div className="start">
					<button
						className="icon-button"
						title="Return"
						tabIndex={-1}
						onClick={onReturn}
					><IconChevronLeft/></button>
				</div>}
				<div className="middle">
					<div className="icon">
						{icon}
					</div>
					<div
						ref={textRef}
						className={cx('text', { expanded, selectable: expanded })}
						onPointerDown={handleExpand}
					>
						<FormattedText chars={reference.chars} onOpenLink={onOpenLink}/>
					</div>
				</div>
				<div className="end">
					<button
						className="icon-button"
						title="Collapse"
						tabIndex={-1}
						disabled={!expanded}
						onClick={handleCollapse}
					><IconChevronUp/></button>
					<button
						className="icon-button"
						title="Expand"
						tabIndex={-1}
						disabled={!canExpand}
						onClick={handleExpand}
					><IconChevronDown/></button>
				</div>
			</div>
			{
				item.status === 'unrecognized'
					? (
						<Fragment>
							<div className="unrecognized">
								No matches found
							</div>
							<div className="actions">
								<button className="form-button" onClick={handleSearchGoogleScholar}>Search on Google Scholar</button>
							</div>
						</Fragment>
					)
					: (
						<Fragment>
							<div className={cx('item-preview', { 'fixed-height': item.title !== undefined })}>
								{item.title !== undefined
									? (
										<div className="metadata">
											<div className="title selectable">
												<div className="title">{item.title}</div>
											</div>
											<div className="author-year selectable">
												{item.creator} ({item.year})
											</div>
										</div>
									)
									: (
										<div className="metadata-skeleton">
											<div className="line"/>
											<div className="line"/>
										</div>
									)
								}

								{item.abstract !== undefined
									? (<div className="abstract selectable">{item.abstract}</div>)
									: (
										<div className="abstract-skeleton">
											<div className="line"/>
											<div className="line"/>
											<div className="line"/>
										</div>
									)
								}
							</div>
							{item.title !== undefined && (
								<div className="actions">
									{item.itemID && (
										<button className="form-button" onClick={handleShowInLibrary}>Show in Library</button>
									)}
									{item.itemID && item.attachmentID && (
										<button className="form-button" onClick={handleOpenInReader}>Open in Reader</button>
									)}
									{(!item.itemID || !item.attachmentID) && item.url && (
										<button className="form-button" onClick={handleOpenLink}>View Online</button>
									)}
									{!item.itemID && (
										<button
											className="form-button"
											disabled={adding}
											onClick={handleAddToLibrary}
										>
											Add to Library{adding && <IconSpinner className="spinner-16"/>}
										</button>
									)}
								</div>
							)}
						</Fragment>
					)
			}
		</div>
	);
}

function ReferenceRow({ reference, previewed, onRecognizeReference, onPreview }) {
	let [item, setItem] = useState(null);
	function handleClick() {
		onPreview(reference);
	}

	useEffect(() => {
		let cancelled = false;
		(async () => {
			let { textParts } = reference;
			onRecognizeReference(textParts, 'match', (result) => {
				if (!cancelled) {
					setItem(result);
				}
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [reference]);

	let icon = <IconSpinner className="spinner-16"/>;

	if (item) {
		if (item.status === 'unmatched') {
			icon = <IconLibraryLookup/>;
		}
		else if (item.status === 'unrecognized') {
			icon = <IconCitationNoMatch/>;
		}
		else if (item.status === 'recognized') {
			icon = <IconCitationCached/>;
		}
		else if (item.status === 'matched') {
			icon = <img src={item.imageSrc}/>;
		}
	}

	return (
		<div className={cx('reference-row', { previewed })} onClick={handleClick}>
			<div className="start">{icon}</div>
			<div className="middle">
				<FormattedText chars={reference.chars} onOpenLink={() => {}}/>
			</div>
			{item && item.attachmentImageSrc && <div className="end"><img src={item.attachmentImageSrc}/></div>}
		</div>
	);
}

export default function ReferencePopup(props) {
	const [previewReference, _setPreviewReference] = useState();

	useEffect(() => {
		setPreviewReference(props.params.references.length > 1 ? null : props.params.references[0]);
	}, [props.params.references]);

	function setPreviewReference(reference) {
		_setPreviewReference(reference);
		props.onPreviewReference(reference);
	}

	function handlePreview(reference) {
		setPreviewReference(reference);
	}

	function handleReturn() {
		setPreviewReference(null);
	}

	return (
		<ViewPopup
			className="reference-popup"
			rect={props.params.rect}
			uniqueRef={{}}
			padding={10}
		>
			<div className="inner">
				{
					previewReference
						? (
							<ReferencePreview
								reference={previewReference}
								showText={props.params.type === 'citation'}
								onNavigate={props.onNavigate}
								onOpenLink={props.onOpenLink}
								onRecognizeReference={props.onRecognizeReference}
								onAddToLibrary={props.onAddToLibrary}
								onShowInLibrary={props.onShowInLibrary}
								onOpenInReader={props.onOpenInReader}
								onReturn={props.params.references.length > 1 ? handleReturn : null}
							/>
						)
						: (
							props.params.references.map((reference, index) => {
								return <ReferenceRow
									key={index}
									reference={reference}
									previewed={props.previewedReferences.has(reference)}
									onRecognizeReference={props.onRecognizeReference}
									onPreview={handlePreview}
								/>;
							})
						)
				}

			</div>
		</ViewPopup>
	);
}
