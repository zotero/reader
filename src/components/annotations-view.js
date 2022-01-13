'use strict';

import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FormattedMessage, useIntl } from 'react-intl';
import cx from 'classnames';
import { SidebarPreview } from './preview';
import { searchAnnotations } from '../lib/search';
import { IconColor } from "./icons";
import { annotationColors } from "../lib/colors";

function AnnotationsViewSearch({ query, onInput, onClear }) {
	const intl = useIntl();

	function handleInput(event) {
		onInput(event.target.value);
	}

	function handleClear() {
		onClear();
	}

	function handleKeyDown(event) {
		if (event.key === 'Escape') {
			handleClear();
		}
	}

	return (
		<div className="search">
			<div className="icon icon-search"/>
			<div className="input-group">
				<input
					tabIndex={5}
					type="text"
					placeholder={intl.formatMessage({ id: 'pdfReader.searchAnnotations' })}
					value={query}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
				/>
			</div>
			{query.length !== 0 && <button className="clear" onClick={handleClear}/>}
		</div>
	);
}

function Selector({ tags, colors, onContextMenu, onClickTag, onClickColor }) {
	const intl = useIntl();
	return (
		<div className="selector" onContextMenu={onContextMenu}>
			{colors.length > 1 && <div className="colors">
				{colors.map((color, index) => (
					<div
						key={index}
						className={cx('color', { selected: color.selected, inactive: color.inactive })}
						title={color.name ? intl.formatMessage({ id: color.name }) : null}
						onClick={() => onClickColor(color.color)}
					><IconColor color={color.color}/></div>
				))}
			</div>}
			{!!tags.length && <div className="tags">
				{tags.map((tag, index) => (
					<span
						key={index}
						className={cx('tag', { color: !!tag.color, selected: tag.selected, inactive: tag.inactive })}
						style={{ color: tag.color }}
						onClick={() => onClickTag(tag.name)}
					>{tag.name}</span>
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
			className={cx('annotation', { selected: props.isSelected })}
			data-sidebar-id={props.annotation.id}
		>
			<SidebarPreview
				state={props.expansionState}
				annotation={props.annotation}
				selected={props.isSelected}
				onDragStart={props.onDragStart}
				onClickSection={props.onClickAnnotationSection}
				onDoubleClickHighlight={props.onDoubleClickHighlight}
				onDoubleClickPageLabel={props.onDoubleClickPageLabel}
				onMenu={props.onMenu}
				onMoreMenu={props.onMoreMenu}
				onChange={props.onChange}
				onEditorBlur={props.onAnnotationEditorBlur}
			/>
		</div>
	);
});

const AnnotationsView = memo(forwardRef(function (props, ref) {
	const [searchedAnnotations, setSearchedAnnotations] = useState(null);
	const [query, setQuery] = useState('');
	const [selectedTags, setSelectedTags] = useState([]);
	const [selectedColors, setSelectedColors] = useState([]);
	const prevAnnotationsLengthRef = useRef(props.annotations.length);

	useEffect(() => {
		let annotations = getAnnotations();
		if (prevAnnotationsLengthRef.current !== annotations.length) {
			props.onDeselectAnnotations();
		}
		prevAnnotationsLengthRef.current = annotations.length;
	});

	useImperativeHandle(ref, () => ({
		getAnnotations,
		clearSelector: () => {
			setSelectedTags([]);
			setSelectedColors([]);
		}
	}));

	// Deselect tags and colors that no longer exist in any annotation
	let _selectedColors = [];
	for (let selectedColor of selectedColors) {
		if (props.annotations.some(a => a.color === selectedColor)) {
			_selectedColors.push(selectedColor);
		}
	}
	if (selectedColors.length !== _selectedColors.length) {
		setSelectedColors(_selectedColors);
	}

	let _selectedTags = [];
	for (let selectedTag of selectedTags) {
		if (props.annotations.some(a => a.tags.some(t => selectedTag === t.name))) {
			_selectedTags.push(selectedTag);
		}
	}
	if (selectedTags.length !== _selectedTags.length) {
		setSelectedTags(_selectedTags);
	}

	function getAnnotations() {
		let { annotations } = props;
		if (searchedAnnotations) {
			let newSearchedAnnotations = [];
			for (let filteredAnnotation of searchedAnnotations) {
				let annotation = annotations.find(x => x.id === filteredAnnotation.id);
				if (annotation) {
					newSearchedAnnotations.push(annotation);
				}
			}
			annotations = newSearchedAnnotations;
		}
		if (selectedTags.length || selectedColors.length) {
			annotations = annotations.filter(x => x.tags.some(t => selectedTags.includes(t.name)) || selectedColors.includes(x.color));
		}
		return annotations;
	}

	function getContainerNode() {
		return document.getElementById('annotationsView');
	}

	function search(query) {
		let { annotations } = props;
		if (query) {
			setSearchedAnnotations(searchAnnotations(annotations, query));
		}
		else {
			setSearchedAnnotations(null);
		}
	}

	function handleSearchInput(query) {
		setQuery(query);
		search(query);
	}

	function handleSearchClear() {
		setQuery('');
		search();
	}

	function handleColorClick(color) {
		if (selectedColors.includes(color)) {
			setSelectedColors(selectedColors.filter(x => x !== color));
		}
		else {
			setSelectedColors([...selectedColors, color]);
		}
	}

	function handleTagClick(name) {
		if (selectedTags.includes(name)) {
			setSelectedTags(selectedTags.filter(x => x !== name));
		}
		else {
			setSelectedTags([...selectedTags, name]);
		}
	}

	function handleSelectorContextMenu(event) {
		if (!event.target.classList.contains('colors')
			&& !event.target.classList.contains('tags')) {
			return;
		}

		props.onSelectorMenu({
			x: event.screenX,
			y: event.screenY,
			enableClearSelection: selectedColors.length || selectedTags.length
		});
	}

	let containerNode = getContainerNode();
	if (!containerNode) {
		return null;
	}

	let annotations = getAnnotations();

	let tags = {};
	let colors = {};
	for (let annotation of props.annotations) {
		for (let tag of annotation.tags) {
			if (!tags[tag.name]) {
				tags[tag.name] = { ...tag };
				tags[tag.name].selected = selectedTags.includes(tag.name);
				tags[tag.name].inactive = true;
			}
		}
		let color = annotation.color;
		if (!colors[color]) {
			let predefinedColor = annotationColors.find(x => x[1] === color);
			colors[color] = {
				color,
				selected: selectedColors.includes(color),
				inactive: true,
				name: predefinedColor ? predefinedColor[0] : null
			};
		}
	}

	for (let annotation of annotations) {
		for (let tag of annotation.tags) {
			tags[tag.name].inactive = false;
		}
		colors[annotation.color].inactive = false;
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
	for (let annotationColor of annotationColors) {
		if (colors[annotationColor[1]]) {
			primaryColors.push(colors[annotationColor[1]]);
			delete colors[annotationColor[1]];
		}
	}

	tags = Object.values(tags);
	let collator = new Intl.Collator();
	tags.sort(function (a, b) {
		return collator.compare(a.tag, b.tag);
	});
	tags = [...coloredTags, ...tags];

	colors = Object.values(colors);
	colors = [...primaryColors, ...colors];

	return ReactDOM.createPortal(
		<React.Fragment>
			<div className="annotations">
				<AnnotationsViewSearch
					query={query}
					onInput={handleSearchInput}
					onClear={handleSearchClear}
				/>
				{annotations.length
					? annotations.map(annotation => (
						<Annotation
							key={annotation.id}
							isSelected={props.selectedIDs.includes(annotation.id)}
							annotation={annotation}
							expansionState={props.selectedIDs.includes(annotation.id) ? props.expansionState : 0}
							onSelect={props.onSelectAnnotation}
							onChange={props.onChange}
							onClickAnnotationSection={props.onClickAnnotationSection}
							onDoubleClickHighlight={props.onDoubleClickHighlight}
							onDoubleClickPageLabel={props.onDoubleClickPageLabel}
							onMenu={props.onMenu}
							onDragStart={props.onDragStart}
							onAnnotationEditorBlur={props.onAnnotationEditorBlur}
						/>
					))
					: !query.length && <div><FormattedMessage id="pdfReader.noAnnotations"/></div>}
			</div>
			{(!!tags.length || colors.length > 1) && <Selector
				tags={tags}
				colors={colors}
				onContextMenu={handleSelectorContextMenu}
				onClickTag={handleTagClick}
				onClickColor={handleColorClick}
			/>}
		</React.Fragment>, containerNode);
}));

export default AnnotationsView;
