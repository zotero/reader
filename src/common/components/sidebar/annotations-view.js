import React, { forwardRef, memo, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import cx from 'classnames';
import { SidebarPreview } from '../common/preview';
import { IconColor16, IconTagCircle, IconUser } from "../common/icons";
import { ANNOTATION_COLORS } from "../../defines";
import { pressedNextKey, pressedPreviousKey, setCaretToEnd } from '../../lib/utilities';
import { ReaderContext } from '../../reader';


function Selector({ tags, colors, authors, onContextMenu, onClickTag, onClickColor, onClickAuthor, onChange }) {
	const intl = useIntl();

	function handleDragOver(event) {
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		event.target.closest('button').classList.add('dragged-over');
	}

	function handleDragLeave(event) {
		event.target.closest('button').classList.remove('dragged-over');
	}

	function handleDrop(event, tag, color) {
		event.preventDefault();
		let remove = event.shiftKey || event.metaKey;
		onChange(remove, tag, color);
		event.target.closest('button').classList.remove('dragged-over');
	}

	return (
		<div id="selector" className="selector" data-tabstop={1} onContextMenu={onContextMenu}>
			{colors.length > 1 && <div className="colors">
				{colors.map((color, index) => (
					<button
						key={index}
						tabIndex={-1}
						className={cx('color', { selected: color.selected, inactive: color.inactive })}
						title={color.name ? intl.formatMessage({ id: color.name }) : null}
						onClick={() => onClickColor(color.color)}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={(event) => handleDrop(event, null, color.color)}
						role="checkbox"
						aria-checked={color.selected}
						aria-description={intl.formatMessage({ id: "pdfReader.tagSelectorMessage" })}
					><IconColor16 color={color.color}/></button>
				))}
			</div>}
			{!!tags.length && <div className="tags">
				{tags.map((tag, index) => (
					<button
						key={index}
						tabIndex={-1}
						className={cx('tag', { color: !!tag.color, selected: tag.selected, inactive: tag.inactive })}
						onClick={() => onClickTag(tag.name)}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={(event) => handleDrop(event, { name: tag.name, color: tag.color })}
						role="checkbox"
						aria-checked={tag.selected}
						aria-description={intl.formatMessage({ id: "pdfReader.tagSelectorMessage" })}
					>{!!tag.color && <span className="icon"><IconTagCircle color={tag.color}/></span>}{tag.name}</button>
				))}
			</div>}
			{authors.length > 1 && <div className="authors">
				{authors.map((author, index) => (
					<button
						key={index}
						tabIndex={-1}
						className={cx('author', { selected: author.selected, inactive: author.inactive })}
						onClick={() => onClickAuthor(author.author)}
					><IconUser/>{author.author}</button>
				))}
			</div>}
		</div>
	);
}

// We get significant performance boost here because `props.annotation`
// reference is updated only when annotation data is updated
const Annotation = React.memo((props) => {
	return (
		<div
			tabIndex={-1}
			className={cx('annotation', { selected: props.isSelected })}
			data-sidebar-annotation-id={props.annotation.id}
			onMouseDown={(event) => event.stopPropagation()}
			onFocus={() => props.onFocus(props.annotation.id)}
			role="option"
			aria-labelledby={`page_${props.annotation.id}`}
			aria-describedby={props.annotation.id}
		>
			<SidebarPreview
				type={props.type}
				readOnly={props.readOnly}
				state={props.expansionState}
				annotation={props.annotation}
				selected={props.isSelected}
				onSetDataTransferAnnotations={props.onSetDataTransferAnnotations}
				onClickSection={props.onClickAnnotationSection}
				onDoubleClickText={props.onDoubleClickText}
				onOpenPageLabelPopup={props.onOpenPageLabelPopup}
				onOpenContextMenu={props.onOpenContextMenu}
				onChange={props.onChange}
			/>
		</div>
	);
});

const AnnotationsView = memo(React.forwardRef((props, ref) => {
	// Expansion state:
	// 0 - None or multiple annotations are selected
	// 1 - Single annotation selected, comment expanded
	// 2 - Single annotation selected, comment expanded, text expanded
	// 3 - Single annotation selected, comment expanded, text expanded and editable
	const [expansionState, setExpansionState] = useState(0);
	const pointerDownRef = useRef(false);
	const selectionTimeRef = useRef(0);

	const { platform } = useContext(ReaderContext);

	// Store the current state of selectedIDs and expansion state to avoid re-creating some functions below
	const expansionStateRef = useRef();
	const selectedIDsRef = useRef();
	const annotationsRef = useRef();
	expansionStateRef.current = expansionState;
	selectedIDsRef.current = props.selectedIDs;
	annotationsRef.current = props.annotations;

	function scrollAnnotationIntoView(id) {
		setTimeout(() => {
			let node = document.querySelector(`[data-sidebar-annotation-id="${id}"]`);
			node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
		});
	}

	function editAnnotationText(id) {
		document.querySelector(`[data-sidebar-annotation-id="${id}"]`).focus();
		setTimeout(() => {
			setExpansionState(3);
			focusSidebarAnnotationText(id);
		}, 50);
	}

	useImperativeHandle(ref, () => ({
		scrollAnnotationIntoView,
		editAnnotationText
	}));

	useEffect(() => {
		window.addEventListener('pointerdown', handlePointerDown);
		window.addEventListener('pointerup', handlePointerUp);
		// Because after canceled drag event pointerup isn't triggered
		window.addEventListener('dragend', handlePointerUp);
		return () => {
			window.removeEventListener('pointerdown', handlePointerDown);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('dragend', handlePointerUp);
		};
	});

	useEffect(() => {
		if (props.selectedIDs.length === 1) {
			setExpansionState(1);
		}
		else {
			setExpansionState(0);
		}
		selectionTimeRef.current = Date.now();
	}, [props.selectedIDs]);

	let handleAnnotationChange = useCallback((annotation) => {
		props.onUpdateAnnotations([annotation]);
	}, []);

	function handlePointerDown(event) {
		pointerDownRef.current = true;
	}

	function handlePointerUp() {
		pointerDownRef.current = false;
	}

	// Don't select annotation if focus was triggered by pointerdown event
	let handleAnnotationFocus = useCallback((id) => {
		// Note: Mousedown and canceled dragstart will focus the annotation element but won't select the actual annotation,
		// because, wiht mouse, selection is only triggered by click event in handleSidebarAnnotationSectionClick
		if (!pointerDownRef.current && !(selectedIDsRef.current.length === 1 && selectedIDsRef.current[0] === id)) {
			props.onSelectAnnotations([id]);
		}
	}, []);

	// Allow navigating to next/previous annotation if inner annotation element like
	// more button, or tags are focused, but not comment/text
	function handleKeyDown(event) {
		let node = event.target;
		// Don't do anything if annotation element is focused, because focus-manager will do the navigation
		if (node.classList.contains('annotation')) {
			return;
		}
		let annotationNode = node.closest('.annotation');
		if (!node.classList.contains('content')) {
			if (pressedPreviousKey(event)) {
				annotationNode.previousElementSibling?.focus();
				event.preventDefault();
			}
			else if (pressedNextKey(event)) {
				annotationNode.nextElementSibling?.focus();
				event.preventDefault();
			}
		}
	}

	function handleColorClick(color) {
		let { colors } = props.filter;
		if (colors.includes(color)) {
			colors = colors.filter(x => x !== color);
		}
		else {
			colors = [...colors, color];
		}
		props.onChangeFilter({ ...props.filter, colors });
	}

	function handleTagClick(tag) {
		let { tags } = props.filter;
		if (tags.includes(tag)) {
			tags = tags.filter(x => x !== tag);
		}
		else {
			tags = [...tags, tag];
		}
		props.onChangeFilter({ ...props.filter, tags });
	}

	function handleAuthorClick(author) {
		let { authors } = props.filter;
		if (authors.includes(author)) {
			authors = authors.filter(x => x !== author);
		}
		else {
			authors = [...authors, author];
		}
		props.onChangeFilter({ ...props.filter, authors });
	}

	const handleSelectorChange = useCallback((remove, tag, color) => {
		let selectedAnnotations = annotationsRef.current.filter(x => window._draggingAnnotationIDs.includes(x.id));
		selectedAnnotations = selectedAnnotations.filter(x => !x.readOnly);
		let annotations = [];
		for (let annotation of selectedAnnotations) {
			let updatedAnnotation = { id: annotation.id };
			if (tag) {
				if (remove) {
					if (annotation.tags.find(x => x.name === tag.name)) {
						updatedAnnotation.tags = annotation.tags.filter(x => x.name !== tag.name);
						annotations.push(updatedAnnotation);
					}
				}
				else if (!annotation.tags.find(x => x.name === tag.name)) {
					updatedAnnotation.tags = [...annotation.tags, tag];
					annotations.push(updatedAnnotation);
				}
			}
			else if (color) {
				if (annotation.color !== color) {
					updatedAnnotation.color = color;
					annotations.push(updatedAnnotation);
				}
			}
		}
		props.onUpdateAnnotations(annotations);
	}, []);

	function handleSelectorContextMenu(event) {
		if (platform === 'web') {
			return;
		}
		event.preventDefault();
		// if (!event.target.classList.contains('colors')
		// 	&& !event.target.classList.contains('tags')) {
		// 	return;
		// }
		props.onOpenSelectorContextMenu({
			x: event.clientX,
			y: event.clientY,
			enableClearSelection: props.filter.colors.length || props.filter.tags.length || props.filter.authors.length
		});
	}

	let handleSidebarAnnotationSectionClick = useCallback((id, section, event) => {
		let ctrl = event.ctrlKey || event.metaKey;
		let shift = event.shiftKey;
		let annotation = annotationsRef.current.find(x => x.id === id);
		if (section === 'tags' && !ctrl && !shift && !(props.readOnly || annotation.readOnly)) {
			let rect = event.target.closest('.tags').getBoundingClientRect();
			return props.onOpenTagsPopup(id, rect.left, rect.top);
		}
		if (section === 'text' && selectedIDsRef.current.length === 1
			&& selectedIDsRef.current[0] === id) {
			if (expansionStateRef.current >= 1 && expansionStateRef.current <= 2) {
				setExpansionState(2);
			}
		}
		else {
			if (section === 'comment' && expansionStateRef.current === 3) {
				setExpansionState(2);
			}
			if (
				!(selectedIDsRef.current.length === 1 && selectedIDsRef.current[0] === id)
				|| selectedIDsRef.current.length === 1 && section === 'header'
			) {
				props.onSelectAnnotations([id], false, event);
			}
		}
	}, []);

	function focusSidebarAnnotationText(annotationID) {
		setTimeout(function () {
			let content = document.querySelector(`[data-sidebar-annotation-id="${annotationID}"] .text .content`);
			if (content) {
				setCaretToEnd(content);
			}
		}, 100);
	}

	let handleSidebarAnnotationDoubleClick = useCallback((id) => {
		if (selectedIDsRef.current.length === 1
			&& selectedIDsRef.current[0] === id
			&& Date.now() - selectionTimeRef.current > 500) {
			if (expansionStateRef.current >= 1 && expansionStateRef.current <= 2) {
				setExpansionState(3);
				focusSidebarAnnotationText(id);
			}
		}
	}, []);

	let handleContextMenuOpen = useCallback((params) => {
		if (!params.button && selectedIDsRef.current.includes(params.ids[0])) {
			params.ids = selectedIDsRef.current.slice();
		}
		props.onOpenAnnotationContextMenu(params);
	}, []);

	let filteredAnnotations = props.annotations.filter(x => !x._hidden);
	if (props.filter.query.length) {
		filteredAnnotations.sort((a, b) => b._score - a._score);
	}

	let tags = {};
	let colors = {};
	let authors = {};
	for (let annotation of props.annotations) {
		for (let tag of annotation.tags) {
			if (!tags[tag.name]) {
				tags[tag.name] = { ...tag };
				tags[tag.name].selected = props.filter.tags.includes(tag.name);
				tags[tag.name].inactive = true;
			}
		}
		let color = annotation.color;
		if (!colors[color]) {
			let predefinedColor = ANNOTATION_COLORS.find(x => x[1] === color);
			colors[color] = {
				color,
				selected: props.filter.colors.includes(color),
				inactive: true,
				name: predefinedColor ? predefinedColor[0] : null
			};
		}
		let author = annotation.authorName;
		if (author && !authors[author]) {
			authors[author] = {
				author,
				selected: props.filter.authors.includes(author),
				inactive: true,
				current: author === props.authorName
			};
		}
	}

	// If filter has tags, colors or authors that no longer exist in any annotation,
	// add them directly from filter to selector to avoid state when selector doesn't show
	// anything and annotations list is empty
	for (let tag of props.filter.tags) {
		if (!tags[tag]) {
			tags[tag] = { name: tag, selected: true, inactive: false };
		}
	}

	for (let color of props.filter.colors) {
		if (!colors[color]) {
			colors[color] = { color, selected: true, inactive: false, name: null };
		}
	}

	for (let author of props.filter.authors) {
		if (!authors[author]) {
			authors[author] = { author, selected: true, inactive: false, current: author === props.authorName };
		}
	}

	for (let annotation of filteredAnnotations) {
		for (let tag of annotation.tags) {
			tags[tag.name].inactive = false;
		}
		colors[annotation.color].inactive = false;
		let author = annotation.authorName;
		if (author) {
			authors[author].inactive = false;
		}
	}

	let coloredTags = [];
	for (let key in tags) {
		let tag = tags[key];
		if (tag.color) {
			coloredTags.push(tag);
			delete tags[key];
		}
	}

	// Sort colored tags and place at beginning
	coloredTags.sort((a, b) => {
		return a.position - b.position;
	});

	let primaryColors = [];
	for (let annotationColor of ANNOTATION_COLORS) {
		if (colors[annotationColor[1]]) {
			primaryColors.push(colors[annotationColor[1]]);
			delete colors[annotationColor[1]];
		}
	}

	tags = Object.values(tags);
	let collator = new Intl.Collator();
	tags.sort(function (a, b) {
		return collator.compare(a.name, b.name);
	});
	tags = [...coloredTags, ...tags];

	colors = Object.values(colors);
	colors = [...primaryColors, ...colors];

	authors = Object.values(authors);
	authors.sort(function (a, b) {
		if (a.current) {
			return -1;
		}
		else if (b.current) {
			return 1;
		}
		return collator.compare(a.author, b.author);
	});

	return (
		<React.Fragment>
			<div id="annotations" role="listbox" className="annotations" data-tabstop={filteredAnnotations.length ? 1 : undefined} onKeyDownCapture={handleKeyDown}>
				{props.annotations.length
					? filteredAnnotations.map(annotation => (
						<Annotation
							type={props.type}
							key={annotation.id}
							readOnly={props.readOnly || annotation.readOnly}
							isSelected={props.selectedIDs.includes(annotation.id)}
							annotation={annotation}
							expansionState={props.selectedIDs.includes(annotation.id) ? expansionState : 0}
							onFocus={handleAnnotationFocus}
							onChange={handleAnnotationChange}
							onClickAnnotationSection={handleSidebarAnnotationSectionClick}
							onDoubleClickText={handleSidebarAnnotationDoubleClick}
							onOpenPageLabelPopup={props.onOpenPageLabelPopup}
							onOpenContextMenu={handleContextMenuOpen}
							onSetDataTransferAnnotations={props.onSetDataTransferAnnotations}
						/>
					))
					: !props.filter.query.length && !props.readOnly && !window.isWeb && <div><FormattedMessage id="pdfReader.noAnnotations"/></div>}
			</div>
			{(!!tags.length || colors.length > 1 || authors.length > 1) && (
				<Selector
					tags={tags}
					colors={colors}
					authors={authors}
					onContextMenu={handleSelectorContextMenu}
					onClickTag={handleTagClick}
					onClickColor={handleColorClick}
					onClickAuthor={handleAuthorClick}
					onChange={handleSelectorChange}
				/>
			)}
		</React.Fragment>);
}));

export default AnnotationsView;
