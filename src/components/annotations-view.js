'use strict';

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames';
import { SidebarPreview } from './preview';
import { searchAnnotations } from '../lib/search';

function AnnotationsViewSearch({ query, onInput, onClear }) {
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
					type="text" placeholder="Search Annotations"
					value={query}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
				/>
			</div>
			{query.length !== 0 && <button className="clear" onClick={handleClear}/>}
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
				onMenu={props.onMenu}
				onMoreMenu={props.onMoreMenu}
				onChange={props.onChange}
				onEditorBlur={props.onAnnotationEditorBlur}
			/>
		</div>
	);
});

const AnnotationsView = React.memo(function (props) {
	const [filteredAnnotations, setFilteredAnnotations] = useState(null);
	const [query, setQuery] = useState('');

	function getContainerNode() {
		return document.getElementById('annotationsView');
	}

	function search(query) {
		let { annotations } = props;
		if (query) {
			setFilteredAnnotations(searchAnnotations(annotations, query));
		}
		else {
			setFilteredAnnotations(null);
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


	let containerNode = getContainerNode();
	if (!containerNode) return null;

	let { annotations } = props;
	if (filteredAnnotations) {
		let newFilteredAnnotations = [];
		for (let filteredAnnotation of filteredAnnotations) {
			let annotation = annotations.find(x => x.id === filteredAnnotation.id);
			if (annotation) {
				newFilteredAnnotations.push(annotation);
			}
		}
		annotations = newFilteredAnnotations;
	}

	return ReactDOM.createPortal(
		<React.Fragment>
			<AnnotationsViewSearch
				query={query}
				onInput={handleSearchInput}
				onClear={handleSearchClear}
			/>
			{annotations.length
				? annotations.map(annotation => (
					<Annotation
						key={annotation.id}
						isSelected={props.selectedAnnotationIDs.includes(annotation.id)}
						annotation={annotation}
						expansionState={props.selectedAnnotationIDs.includes(annotation.id) ? props.expansionState : 0}
						onSelect={props.onSelectAnnotation}
						onChange={props.onChange}
						onClickAnnotationSection={props.onClickAnnotationSection}
						onDoubleClickHighlight={props.onDoubleClickHighlight}
						onMenu={props.onMenu}
						onDragStart={props.onDragStart}
						onAnnotationEditorBlur={props.onAnnotationEditorBlur}
					/>
				))
				: !query.length && <div>Create an annotation to see it in the sidebar</div>}
		</React.Fragment>,
		containerNode
	);
});

export default AnnotationsView;
