'use strict';

import React, { useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import cx from 'classnames';
import Editor from './editor';
import ExpandableEditor from './expandable-editor';
import { IconHighlight, IconNote, IconArea, IconInk } from './icons';

// TODO: Don't allow to select UI text in popup header and footer
export function PopupPreview(props) {
	const intl = useIntl();

	function handlePageLabelDoubleClick() {
		props.onDoubleClickPageLabel(annotation.id);
	}

	function handleTagsClick(event) {
		if (props.annotation.readOnly) {
			return;
		}
		props.onClickTags(props.annotation.id, event);
	}

	function handleCommentChange(text) {
		props.onChange({ id: props.annotation.id, comment: text });
	}

	function handleClickMore(event) {
		if (!props.annotation.readOnly) {
			event.stopPropagation();
			props.onMoreMenu(props.annotation.id, event.screenX, event.screenY);
		}
	}

	let { annotation } = props;
	return (
		<div
			className={cx('preview', { 'read-only': annotation.readOnly })}
			data-annotation-id={annotation.id}
		>
			<header
				title={intl.formatDate(new Date(annotation.dateModified))
				+ ' ' + intl.formatTime(new Date(annotation.dateModified))}
			>
				<div className="left">
					<div
						className={cx('icon', 'icon-' + annotation.type)}
						style={{ color: annotation.color }}
					>
						{
							annotation.type === 'highlight' && <IconHighlight/>
							|| annotation.type === 'note' && <IconNote/>
							|| annotation.type === 'image' && <IconArea/>
							|| annotation.type === 'ink' && <IconInk/>
						}
					</div>
					<div className="page" onDoubleClick={handlePageLabelDoubleClick}>
						<div><FormattedMessage id="pdfReader.page"/></div>
						<div className="label">{annotation.pageLabel}</div>
					</div>
				</div>
				<div className="right">
					{annotation.authorName && (<div className="author">{annotation.authorName}</div>)}
					<div className="more" onClick={handleClickMore}/>
				</div>
			</header>

			{annotation.type !== 'ink' && (
				<div className="comment">
					<Editor
						id={annotation.id}
						text={annotation.comment}
						placeholder={annotation.readOnly ? intl.formatMessage({ id: 'pdfReader.readOnly' })
							: intl.formatMessage({ id: 'pdfReader.addComment' })}
						isPlainText={false}
						isReadOnly={annotation.readOnly}
						onChange={handleCommentChange}
					/>
				</div>
			)}

			{(!annotation.readOnly || !!annotation.tags.length) && (
				<div
					className="tags"
					onClick={handleTagsClick}
				>{annotation.tags.length ? annotation.tags.map((tag, index) => (
					<span
						className="tag" key={index}
						style={{ color: tag.color }}
					>{tag.name}</span>
				)) : <FormattedMessage id="pdfReader.addTags"/>}</div>
			)}

		</div>
	);

}

export function SidebarPreview(props) {
	const intl = useIntl();

	function handlePageLabelClick(event) {
		event.stopPropagation();
	}

	function handlePageLabelDoubleClick() {
		props.onDoubleClickPageLabel(annotation.id);
	}

	function handleSectionClick(event, section) {
		props.onClickSection(props.annotation.id, section, event);
	}

	function handleTextChange(text) {
		props.onChange({ id: props.annotation.id, text });
	}

	function handleCommentChange(text) {
		props.onChange({ id: props.annotation.id, comment: text });
	}

	function handleClickMore(event) {
		if (!props.annotation.readOnly) {
			event.stopPropagation();
			props.onMenu(props.annotation.id, event.screenX, event.screenY, true);
		}
	}

	function handleDragStart(event) {
		if (!event.target.getAttribute('draggable')) return;
		props.onDragStart(event, props.annotation.id);
	}

	function handleEditorBlur() {
		props.onEditorBlur(props.annotation.id);
	}

	function handleHighlightDoubleClick() {
		props.onDoubleClickHighlight(props.annotation.id);
	}

	function handlePointerDown(event) {
		if (event.button === 2
			&& !event.target.closest('div[contenteditable="true"]')) {
			event.stopPropagation();
			props.onMenu(props.annotation.id, event.screenX, event.screenY);
		}
	}

	let { annotation, state } = props;

	let text = annotation.type === 'highlight' && (
		<div
			className="highlight"
			onClick={e => handleSectionClick(e, 'highlight')}
			onDoubleClick={handleHighlightDoubleClick}
			draggable={state !== 3 || annotation.readOnly}
			onDragStart={handleDragStart}
		>
			<div className="blockquote-border" style={{ backgroundColor: annotation.color }}/>
			<ExpandableEditor
				id={annotation.id}
				clampID="highlight-clamp"
				text={annotation.text}
				placeholder={intl.formatMessage({ id: 'pdfReader.addText' })}
				isReadOnly={annotation.readOnly}
				isExpanded={props.state >= 2}
				isEditable={state === 3}
				onChange={handleTextChange}
				onBlur={handleEditorBlur}
			/>
		</div>
	);

	let comment = (state >= 1 || annotation.comment)
		&& annotation.type !== 'ink'
		&& !(annotation.readOnly && !annotation.comment)
		&& <div
			className="comment"
			onClick={e => handleSectionClick(e, 'comment')}
			draggable={state === 0 || annotation.readOnly}
			onDragStart={handleDragStart}
		>
			<ExpandableEditor
				id={annotation.id}
				clampID="comment-clamp"
				text={annotation.comment}
				placeholder={intl.formatMessage({ id: 'pdfReader.addComment' })}
				isPlainText={false}
				onChange={handleCommentChange}
				isReadOnly={annotation.readOnly}
				isExpanded={state >= 1}
				isEditable={state === 1 || state === 2 || state === 3}
				onBlur={handleEditorBlur}
			/>
		</div>;

	let tags = annotation.tags.length ? annotation.tags.map((tag, index) => (
		<span
			className="tag" key={index}
			style={{ color: tag.color }}
		>{tag.name}</span>
	)) : <FormattedMessage id="pdfReader.addTags"/>;

	let expandedState = {};
	expandedState['expanded' + props.state] = true;

	return (
		<div
			onPointerDown={handlePointerDown}
			className={cx('preview', {
				'read-only': annotation.readOnly, ...expandedState
			})}
			data-annotation-id={annotation.id}
		>
			<header
				title={intl.formatDate(new Date(annotation.dateModified))
				+ ' ' + intl.formatTime(new Date(annotation.dateModified))}
				onClick={e => handleSectionClick(e, 'header')}
				draggable={true}
				onDragStart={handleDragStart}
			>
				<div className="left">
					<div
						className={cx('icon', 'icon-' + annotation.type)}
						style={{ color: annotation.color }}
					>
						{
							annotation.type === 'highlight' && <IconHighlight/>
							|| annotation.type === 'note' && <IconNote/>
							|| annotation.type === 'image' && <IconArea/>
							|| annotation.type === 'ink' && <IconInk/>
						}
					</div>
					<div
						className="page"
						onClick={handlePageLabelClick}
						onDoubleClick={handlePageLabelDoubleClick}
					>
						<div><FormattedMessage id="pdfReader.page"/></div>
						<div className="label">{annotation.pageLabel}</div>
					</div>
				</div>
				<div className="right">
					{annotation.authorName && (<div className="author">{annotation.authorName}</div>)}
					<div className="more" onClick={handleClickMore}/>
				</div>
			</header>
			{annotation.image && (
				<img
					className="image"
					src={annotation.image}
					onClick={e => handleSectionClick(e, 'image')}
					draggable={true}
					onDragStart={handleDragStart}
				/>
			)}
			{text}
			{comment}
			{(state >= 1 && !annotation.readOnly || annotation.tags.length > 0)
			&& (
				<div
					className="tags"
					onClick={e => handleSectionClick(e, 'tags')}
					draggable={true}
					onDragStart={handleDragStart}
				>{tags}</div>
			)}
		</div>
	);
}

