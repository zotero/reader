import React, { Fragment, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import cx from 'classnames';

const supportedFormats = ['i', 'b', 'sub', 'sup'];
const multiline = true;

function getFormatter(str) {
	let results = supportedFormats.map(format => str.toLowerCase().indexOf('<' + format + '>'));
	results = results.map((offset, idx) => [supportedFormats[idx], offset]);
	results.sort((a, b) => a[1] - b[1]);
	for (let result of results) {
		let format = result[0];
		let offset = result[1];
		if (offset < 0) {
			continue;
		}
		let lastIndex = str.toLowerCase().indexOf('</' + format + '>', offset);
		if (lastIndex >= 0) {
			let parts = [];
			parts.push(str.slice(0, offset));
			parts.push(str.slice(offset + format.length + 2, lastIndex));
			parts.push(str.slice(lastIndex + format.length + 3));
			return {
				format,
				parts
			};
		}
	}
	return null;
}

function walkFormat(parent) {
	let child = parent.firstChild;
	while (child) {
		if (child.nodeType === 3) {
			let text = child.nodeValue;
			let formatter = getFormatter(text);
			if (formatter) {
				let nodes = [];
				nodes.push(document.createTextNode(formatter.parts[0]));
				let midNode = document.createElement(formatter.format);
				midNode.appendChild(document.createTextNode(formatter.parts[1]));
				nodes.push(midNode);
				nodes.push(document.createTextNode(formatter.parts[2]));
				child.replaceWith(...nodes);
				child = midNode;
			}
		}
		walkFormat(child);
		child = child.nextSibling;
	}
}

function walkUnformat(parent) {
	let child = parent.firstChild;
	while (child) {
		let name = child.nodeName.toLowerCase();
		if (
			child.nodeType === 1
			&& supportedFormats.includes(name)
		) {
			if (child.innerText.trim().length) {
				let all = [];
				all.push(document.createTextNode('<' + name + '>'));
				all.push(...child.childNodes);
				all.push(document.createTextNode('</' + name + '>'));
				child.replaceWith(...all);
				child = all[0];
			}
		}

		// Unwrap <div><br></div> and some <div>...</div> to avoid doubled line breaks in innerText
		if (child.nodeName === 'DIV'
			&& (child.firstChild && child.firstChild.nodeName === 'BR'
				|| child.nodeName === 'DIV' && child.nextSibling && child.nextSibling.nodeName === 'DIV'
				&& child.nextSibling.firstChild && child.nextSibling.firstChild.nodeName === 'BR')
		) {
			let firstNode = child.firstChild;
			child.replaceWith(...child.childNodes);
			child = firstNode;
		}

		walkUnformat(child);
		child = child.nextSibling;
	}
}

function clean(parent, enableRichText) {
	let map = {
		strong: 'b'
	};

	let child = parent.firstChild;
	while (child) {
		if (child.nodeType === 1) {
			for (let el in map) {
				if (child.nodeName.toLowerCase() === el) {
					let children = child.childNodes;
					let aa = document.createElement(map[el]);
					aa.append(...children);

					child.replaceWith(aa);
					child = aa;
				}
			}

			let multilineFormats = multiline ? ['br', 'div'] : [];
			if (!(enableRichText ? supportedFormats : []).concat(multilineFormats).includes(child.nodeName.toLowerCase())) {
				let first = child.firstChild;
				let next = child.nextSibling;

				child.replaceWith(...child.childNodes);
				if (first) {
					child = first;
				}
				else {
					child = next;
				}
				continue;
			}
			else {
				while (child.attributes.length > 0) {
					child.removeAttribute(child.attributes[0].name);
				}
			}
		}
		else if (child.nodeType === 3) {
			// Keep the text
		}
		else {
			parent.removeChild(child);
		}
		clean(child, enableRichText);
		child = child.nextSibling;
	}
}

var actions = [
	{
		icon: '<b>B</b>',
		title: 'Bold',
		command: 'bold'
	},
	{
		icon: '<i>I</i>',
		title: 'Italic',
		command: 'italic'
	},
	{
		icon: 'X<sub>2</sub>',
		title: 'Subscript',
		command: 'subscript'
	},
	{
		icon: 'X<sup>2</sup>',
		title: 'Superscript',
		command: 'superscript'
	},
	{
		icon: 'T<sub>x</sub>',
		title: 'Remove Format',
		command: 'removeformat'
	}
];

function ToolbarButton({ action, onCommand }) {
	function handleClick(event) {
		event.preventDefault();
		onCommand(action.command);
	}

	return (
		<button
			className={cx('button', 'icon-' + action.command)}
			dangerouslySetInnerHTML={{ __html: action.icon }}
			onPointerDown={handleClick}
		/>
	);
}

function Toolbar({ onCommand }) {
	let toolbarRef = useRef();
	let activeRef = useRef(false);

	useLayoutEffect(() => {
		update();
	}, []);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('selectionchange', handleSelectionChange);
		document.addEventListener('scroll', handleScroll, true);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('selectionchange', handleSelectionChange);
			document.removeEventListener('scroll', handleScroll, true);
		};
	});

	function handleKeyDown(event) {
		let editable = event.target.closest('.editor [contenteditable=true]');
		if (!editable || !toolbarRef.current.parentNode.contains(editable)) {
			return;
		}
		let { key } = event;
		let ctrl = event.ctrlKey;
		let cmd = event.metaKey;
		let shift = event.shiftKey;
		let alt = event.altKey;
		let mod = ctrl || cmd;
		if (!shift && !alt && mod) {
			if (key === 'b') {
				onCommand('bold');
				event.preventDefault();
			}
			else if (key === 'i') {
				onCommand('italic');
				event.preventDefault();
			}
		}
	}

	function handleSelectionChange() {
		update();
	}

	// For annotation in View
	function handleScroll() {
		update();
	}

	function update() {
		let selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			toolbarRef.current.style.display = 'none';
			activeRef.current = false;
			return;
		}
		let range = selection.getRangeAt(0);
		let selectionRect = range.getBoundingClientRect();
		let editorNode = range.startContainer.parentNode.closest('.editor');
		if (!editorNode || !editorNode.parentNode.contains(toolbarRef.current)) {
			toolbarRef.current.style.display = 'none';
			activeRef.current = false;
			return;
		}
		let editorRect = editorNode.getBoundingClientRect();
		let top = selectionRect.y - editorRect.y;
		if (top < -15) {
			toolbarRef.current.style.display = 'none';
			return;
		}
		toolbarRef.current.style.display = 'flex';
		toolbarRef.current.style.top = top + 'px';
		activeRef.current = true;
	}

	return (
		<div ref={toolbarRef} className="editor-toolbar">
			{actions.map((action, idx) => (
				<ToolbarButton key={idx} action={action} onCommand={onCommand}/>
			))}
		</div>
	);
}

let Content = React.forwardRef((props, ref) => {
	// Store last value to prevent contenteditable content updating while typing, which reset cursor position
	let lastValueRef = useRef();
	let innerRef = useRef();
	let rendererRef = useRef();

	useEffect(() => {
		if (lastValueRef.current !== props.text) {
			lastValueRef.current = props.text;
			innerRef.current.innerText = props.text;
			if (props.enableRichText) {
				walkFormat(innerRef.current);
			}
		}
	});

	useImperativeHandle(ref, () => ({
		focus: () => innerRef.current.focus()
	}));

	function handleInput(event) {
		// Cleanup and transform contenteditable HTML into Zotero HTML-flavored plain-text,
		// trigger onChange, and store the new plain-text value to prevent the newly updated
		// prop causing Content component re-rendering which would cause cursor position reset
		clean(innerRef.current, props.enableRichText);
		rendererRef.current.innerHTML = innerRef.current.innerHTML;
		walkUnformat(rendererRef.current);
		let text = rendererRef.current.innerText;
		text = text.replace(/\n<\//g, '<\/');
		text = text.trim();
		lastValueRef.current = text;
		props.onChange(text);
	}

	return (
		<Fragment>
			<div
				id={props.id}
				ref={innerRef}
				suppressContentEditableWarning={true}
				className="content"
				contentEditable={!props.readOnly}
				dir="auto"
				placeholder={props.placeholder}
				data-tabstop={!props.readOnly ? 1 : undefined}
				tabIndex={!props.readOnly ? -1 : undefined}
				onInput={handleInput}
				role="textbox"
				aria-label={props.ariaLabel}
				aria-readonly={props.readOnly}
			/>
			<div className="renderer" ref={rendererRef}></div>
		</Fragment>
	);
});

function Editor(props) {
	let contentRef = useRef();

	function handleBalloonCommand(command) {
		contentRef.current.focus();
		document.execCommand(command, false, null);
	}

	return (
		<div className={cx('editor', { 'read-only': props.readOnly })}>
			{!props.readOnly && props.enableRichText && <Toolbar onCommand={handleBalloonCommand}/>}
			<Content
				ref={contentRef}
				id={props.id}
				text={props.text}
				readOnly={props.readOnly}
				enableRichText={props.enableRichText}
				placeholder={props.placeholder}
				onChange={props.onChange}
				ariaLabel={props.ariaLabel}
			/>
		</div>
	);
}

export default Editor;
