import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalization } from '@fluent/react';
import cx from 'classnames';
import { isMac } from '../../../lib/utilities';
import IconHighlight from '../../../../../res/icons/20/annotate-highlight.svg';
import IconUnderline from '../../../../../res/icons/20/annotate-underline.svg';
import IconChevronDown8 from '../../../../../res/icons/8/chevron-8.svg';
import IconArrowLeft from '../../../../../res/icons/20/arrow-left.svg';
import IconArrowRight from '../../../../../res/icons/20/arrow-right.svg';

const AUTO_DISMISS_MS = 5000;
const FADE_START_MS = AUTO_DISMISS_MS - 1000;

function ReadAloudAnnotationPopup(props) {
	let { params, onMove, onDismiss, onOpenContextMenu } = props;
	let { l10n } = useLocalization();
	let accelKey = isMac() ? '⌘ ' : 'Ctrl+';

	let [fading, setFading] = useState(false);
	let [top, setTop] = useState(undefined);
	let ref = useRef();
	let fadeTimerRef = useRef(null);
	let dismissTimerRef = useRef(null);
	let contextMenuOpenRef = useRef(false);

	let clearTimers = useCallback(() => {
		if (fadeTimerRef.current) {
			clearTimeout(fadeTimerRef.current);
			fadeTimerRef.current = null;
		}
		if (dismissTimerRef.current) {
			clearTimeout(dismissTimerRef.current);
			dismissTimerRef.current = null;
		}
	}, []);

	let startTimers = useCallback(() => {
		setFading(false);
		clearTimers();
		fadeTimerRef.current = setTimeout(() => {
			setFading(true);
		}, FADE_START_MS);
		dismissTimerRef.current = setTimeout(() => {
			onDismiss();
		}, AUTO_DISMISS_MS);
	}, [clearTimers, onDismiss]);

	useEffect(() => {
		startTimers();
		return clearTimers;
	}, [startTimers, clearTimers, params.annotation]);

	useLayoutEffect(() => {
		let rect = ref.current.getBoundingClientRect();
		setTop(rect.top - rect.height / 2);
	}, []);

	useEffect(() => {
		let handlePointerDownCapture = (event) => {
			if (contextMenuOpenRef.current) {
				return;
			}
			if (ref.current && !ref.current.contains(event.target)) {
				onDismiss();
			}
		};
		let handleBlur = () => {
			if (contextMenuOpenRef.current) {
				return;
			}
			onDismiss();
		};
		document.addEventListener('pointerdown', handlePointerDownCapture, { capture: true });
		window.addEventListener('blur', handleBlur);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDownCapture, { capture: true });
			window.removeEventListener('blur', handleBlur);
		};
	}, [onDismiss]);

	let handlePointerMove = () => {
		startTimers();
	};

	let handleMenuClick = async (event) => {
		let rect = event.currentTarget.getBoundingClientRect();
		clearTimers();
		contextMenuOpenRef.current = true;
		await onOpenContextMenu({ x: rect.left, y: rect.bottom });
		contextMenuOpenRef.current = false;
		startTimers();
	};

	let { annotation } = params;
	let { type, color, text } = annotation;

	return (
		<div
			ref={ref}
			className={cx('read-aloud-annotation-popup', { fading })}
			style={{ top }}
			onPointerMove={handlePointerMove}
		>
			<div className="buttons">
				<button className="toolbar-button" onClick={() => onMove('prev')}><IconArrowLeft/></button>
				<button className="toolbar-button" onClick={() => onMove('next')}><IconArrowRight/></button>
				<MenuButton type={type} color={color} onClick={handleMenuClick}/>
			</div>
			<div className="annotation-text">
				<span
					className={type}
					style={type === 'underline'
						? { textDecorationColor: color }
						: { backgroundColor: color + '80' }}
				>{text || ''}</span>
			</div>
			<div className="hint">
				<span className="key">←→</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-move')}</span>
				<span className="key">1-8</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-change-color')}</span>
				<span className="key">{accelKey}←→</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-extend')}</span>
				<span className="key">H</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-highlight')}</span>
				<span className="key">⌫</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-delete')}</span>
				<span className="key">U</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-underline')}</span>
				<span className="key">⏎</span>
				<span>{l10n.getString('reader-read-aloud-annotation-popup-done')}</span>
			</div>
		</div>
	);
}

function MenuButton({ type, color, onClick }) {
	let Icon = type === 'highlight' ? IconHighlight : IconUnderline;

	return (
		<button className="toolbar-button menu-button" onClick={onClick}>
			<Icon style={{ color }}/>
			<IconChevronDown8/>
		</button>
	);
}

export default ReadAloudAnnotationPopup;
