import React, { useContext, useLayoutEffect, useRef } from 'react';
import cx from 'classnames';

import IconRevert from '../../../../res/icons/16/revert.svg';
import { FormattedMessage, useIntl } from 'react-intl';
import { DEFAULT_EPUB_APPEARANCE } from '../../../dom/epub/defines';

import IconColumnDouble from '../../../../res/icons/16/column-double.svg';
import IconColumnSingle from '../../../../res/icons/16/column-single.svg';
import IconFlowPaginated from '../../../../res/icons/16/flow-paginated.svg';
import IconFlowScrolled from '../../../../res/icons/16/flow-scrolled.svg';
import IconScrollHorizontal from '../../../../res/icons/16/scroll-horizontal.svg';
import IconScrollVertical from '../../../../res/icons/16/scroll-vertical.svg';
import IconScrollWrapped from '../../../../res/icons/16/scroll-wrapped.svg';
import IconSplitHorizontal from '../../../../res/icons/16/split-horizontal.svg';
import IconSplitNone from '../../../../res/icons/16/split-none.svg';
import IconSplitVertical from '../../../../res/icons/16/split-vertical.svg';
import IconSpreadEven from '../../../../res/icons/16/spread-even.svg';
import IconSpreadNone from '../../../../res/icons/16/spread-none.svg';
import IconSpreadOdd from '../../../../res/icons/16/spread-odd.svg';
import IconOptions from '../../../../res/icons/16/options.svg';
import IconPlus from '../../../../res/icons/20/plus.svg';
import { getCurrentColorScheme, getPopupCoordinatesFromClickEvent } from '../../lib/utilities';
import { ReaderContext } from '../../reader';
import { DEFAULT_THEMES } from '../../defines';

function EPUBAppearance({ params, enablePageWidth, onChange }) {
	const intl = useIntl();

	if (!params) {
		// Not initialized yet - wait
		return null;
	}

	function handleChange(event) {
		if (event.target.type === 'checkbox') {
			params[event.target.name] = event.target.checked;
		}
		else {
			params[event.target.name] = parseFloat(event.target.value);
		}
		onChange(params);
	}

	function handleRevert(name) {
		params[name] = DEFAULT_EPUB_APPEARANCE[name];
		onChange(params);
	}

	return (
		<div className="epub-appearance">
			<div className="row">
				<label htmlFor="line-height"><FormattedMessage id="pdfReader.epubAppearance.lineHeight"/></label>
				<input
					data-tabstop={1}
					tabIndex={-1}
					type="range"
					id="line-height"
					name="lineHeight"
					value={params.lineHeight}
					min="0.80"
					max="2.50"
					step="0.05"
					onChange={handleChange}
				/>
				<span className="value">{params.lineHeight}</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.lineHeight === DEFAULT_EPUB_APPEARANCE.lineHeight })}
					aria-label={intl.formatMessage({ id: 'pdfReader.epubAppearance.lineHeight.revert' })}
					onClick={() => handleRevert('lineHeight')}
				><IconRevert/></button>
			</div>

			<div className="row">
				<label htmlFor="word-spacing"><FormattedMessage id="pdfReader.epubAppearance.wordSpacing"/></label>
				<input
					data-tabstop={1}
					tabIndex={-1}
					type="range"
					id="word-spacing"
					name="wordSpacing"
					value={params.wordSpacing}
					min="-100"
					max="100"
					step="5"
					onChange={handleChange}
				/>
				<span className="value">{params.wordSpacing}%</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.wordSpacing === DEFAULT_EPUB_APPEARANCE.wordSpacing })}
					aria-label={intl.formatMessage({ id: 'pdfReader.epubAppearance.wordSpacing.revert' })}
					onClick={() => handleRevert('wordSpacing')}
				><IconRevert/></button>
			</div>

			<div className="row">
				<label htmlFor="letter-spacing"><FormattedMessage id="pdfReader.epubAppearance.letterSpacing"/></label>
				<input
					data-tabstop={1}
					tabIndex={-1}
					type="range"
					id="letter-spacing"
					name="letterSpacing"
					value={params.letterSpacing}
					min="-0.1"
					max="0.1"
					step="0.005"
					onChange={handleChange}
				/>
				<span className="value">{params.letterSpacing * 1000}%</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.letterSpacing === DEFAULT_EPUB_APPEARANCE.letterSpacing })}
					aria-label={intl.formatMessage({ id: 'pdfReader.epubAppearance.letterSpacing.revert' })}
					onClick={() => handleRevert('letterSpacing')}
				><IconRevert/></button>
			</div>

			<div className="row">
				<label htmlFor="page-width"><FormattedMessage id="pdfReader.epubAppearance.pageWidth"/></label>
				<input
					data-tabstop={1}
					tabIndex={-1}
					type="range"
					id="page-width"
					name="pageWidth"
					value={params.pageWidth}
					min="-1"
					max="1"
					step="1"
					onChange={handleChange}
					disabled={!enablePageWidth}
				/>
				<span className="value">{(params.pageWidth + 3) / 4 * 100}%</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.pageWidth === DEFAULT_EPUB_APPEARANCE.pageWidth })}
					aria-label={intl.formatMessage({ id: 'pdfReader.epubAppearance.pageWidth.revert' })}
					onClick={() => handleRevert('pageWidth')}
					disabled={!enablePageWidth}
				><IconRevert/></button>
			</div>

			<div className="checkbox-row">
				<input
					data-tabstop={1}
					tabIndex={-1}
					type="checkbox"
					id="use-original-font"
					name="useOriginalFont"
					checked={params.useOriginalFont}
					onChange={handleChange}
				/>
				<label htmlFor="use-original-font"><FormattedMessage
					id="pdfReader.epubAppearance.useOriginalFont"/></label>
			</div>
		</div>
	);
}

function Theme({ theme, active, onSet, onOpenContextMenu }) {
	let intl = useIntl();
	const isReadOnly = DEFAULT_THEMES.some(t => t.id === theme.id);
	const { platform } = useContext(ReaderContext);

	function handleClick(e) {
		onSet(theme.id);
	}

	function handleContextMenu(event) {
		// Prevent selecting annotation
		event.stopPropagation();
		event.preventDefault();
		let { x, y } = getPopupCoordinatesFromClickEvent(event);
		onOpenContextMenu({ theme, x, y });

		if(event.type === 'click') {
			event.currentTarget.classList.add('context-menu-open');
		}
	}

	let titleString = `pdfReader.theme.${theme.id}`;
	let name = intl.messages[titleString] ? intl.formatMessage({ id: titleString }) : theme.label;

	return platform === 'web'
		? (
			<div className={cx('theme', { active })} style={{ backgroundColor: theme.background || '#ffffff', color: theme.foreground || '#000000' }}>
				<button
					tabIndex={-1}
					title={name}
					onClick={handleClick}
				>
					{name}
				</button>
				{!isReadOnly && (
					<button
						title={intl.formatMessage({ id: 'pdfReader.themeOptions' }) }
						tabIndex={-1}
						className="theme-context-menu"
						onClick={handleContextMenu}
					>
						<IconOptions />
					</button>
				)}
			</div>
		)
		: (
			<button
				tabIndex={-1}
				className={cx('theme', { active })}
				style={{ backgroundColor: theme.background || '#ffffff', color: theme.foreground || '#000000' }}
				title={name}
				onClick={handleClick}
				onContextMenu={handleContextMenu}
			>{name}</button>
		);
}

function AppearancePopup(props) {
	let overlayRef = useRef();
	let intl = useIntl();

	const { type, platform } = useContext(ReaderContext);

	useLayoutEffect(() => {
		window.focus();
	}, []);

	function handlePointerDown(event) {
		if (event.target === overlayRef.current) {
			props.onClose();
		}
	}

	let themes = [...DEFAULT_THEMES, ...(props.customThemes || [])];
	themes = Array.from(new Map(themes.map(theme => [theme.id, theme])).values());

	let currentColorScheme = getCurrentColorScheme(props.colorScheme);
	let currentTheme = currentColorScheme === 'light' ? props.lightTheme : props.darkTheme;

	return (
		<div ref={overlayRef} className="toolbar-popup-overlay overlay" onPointerDown={handlePointerDown}>
			<div className={cx('modal-popup appearance-popup')}>
				{type === 'pdf' && (
					<div className="group">
						<div className="option">
							<label><FormattedMessage id="pdfReader.scrollMode"/></label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.scrollMode === 0 })}
									title={intl.formatMessage({ id: 'pdfReader.vertical' })}
									onClick={() => props.onChangeScrollMode(0)}
								><IconScrollVertical/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.scrollMode === 1 })}
									title={intl.formatMessage({ id: 'pdfReader.horizontal' })}
									onClick={() => props.onChangeScrollMode(1)}
								><IconScrollHorizontal/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.scrollMode === 2 })}
									title={intl.formatMessage({ id: 'pdfReader.wrapped' })}
									onClick={() => props.onChangeScrollMode(2)}
								><IconScrollWrapped/></button>
							</div>
						</div>
						<div className="option">
							<label><FormattedMessage id="pdfReader.spreadMode"/></label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 0 })}
									title={intl.formatMessage({ id: 'pdfReader.none' })}
									onClick={() => props.onChangeSpreadMode(0)}
								><IconSpreadNone/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 1 })}
									title={intl.formatMessage({ id: 'pdfReader.odd' })}
									onClick={() => props.onChangeSpreadMode(1)}
								><IconSpreadOdd/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 2 })}
									title={intl.formatMessage({ id: 'pdfReader.even' })}
									onClick={() => props.onChangeSpreadMode(2)}
								><IconSpreadEven/></button>
							</div>
						</div>
					</div>
				)}
				{type === 'epub' && (
					<div className="group">
						<div className="option">
							<label><FormattedMessage id="pdfReader.flowMode"/></label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.flowMode === 'paginated' })}
									title={intl.formatMessage({ id: 'pdfReader.paginated' })}
									onClick={() => props.onChangeFlowMode('paginated')}
								><IconFlowPaginated/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.flowMode === 'scrolled' })}
									title={intl.formatMessage({ id: 'pdfReader.scrolled' })}
									onClick={() => props.onChangeFlowMode('scrolled')}
								><IconFlowScrolled/></button>
							</div>
						</div>
						<div className="option">
							<label><FormattedMessage id="pdfReader.columns"/></label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 0 })}
									title={intl.formatMessage({ id: 'pdfReader.single' })}
									onClick={() => props.onChangeSpreadMode(0)}
									disabled={props.viewStats.flowMode === 'scrolled'}
								><IconColumnSingle/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 1 })}
									title={intl.formatMessage({ id: 'pdfReader.double' })}
									onClick={() => props.onChangeSpreadMode(1)}
									disabled={props.viewStats.flowMode === 'scrolled'}
								><IconColumnDouble/></button>
							</div>
						</div>
					</div>
				)}
				<div className="group">
					<div className="option">
						<label><FormattedMessage id="pdfReader.splitView"/></label>
						<div className="split-toggle" data-tabstop={1}>
							<button
								tabIndex={-1}
								className={cx({ active: !props.splitType })}
								title={intl.formatMessage({ id: 'pdfReader.none' })}
								onClick={() => props.onChangeSplitType()}
							><IconSplitNone/></button>
							<button
								tabIndex={-1}
								className={cx({ active: props.splitType === 'vertical' })}
								title={intl.formatMessage({ id: 'pdfReader.vertical' })}
								onClick={() => props.onChangeSplitType('vertical')}
							><IconSplitHorizontal/></button>
							<button
								tabIndex={-1}
								className={cx({ active: props.splitType === 'horizontal' })}
								title={intl.formatMessage({ id: 'pdfReader.horizontal' })}
								onClick={() => props.onChangeSplitType('horizontal')}
							><IconSplitVertical/></button>
						</div>
					</div>
				</div>
				{type === 'epub' && (
					<div className="group">
						<EPUBAppearance
							params={props.viewStats.appearance}
							enablePageWidth={props.viewStats.flowMode !== 'paginated' || props.viewStats.spreadMode === 0}
							onChange={props.onChangeAppearance}
						/>
					</div>
				)}
				<div className="group">
					<div className="option themes">
						<label><FormattedMessage id="pdfReader.themes"/></label>
						<div className="themes" data-tabstop={1}>
							<button
								tabIndex={-1}
								className={cx('theme original', { active: !currentTheme })}
								style={{ backgroundColor: '#ffffff', color: '#000000' }}
								title={intl.formatMessage({ id: "pdfReader.theme.original" })}
								onClick={() => props.onChangeTheme()}
							><FormattedMessage id="pdfReader.theme.original"/></button>
							{themes.map((theme, i) => (
								<Theme
									key={i}
									theme={theme}
									active={currentTheme && theme.id === currentTheme.id}
									onSet={props.onChangeTheme}
									onOpenContextMenu={props.onOpenThemeContextMenu}
								/>
							))}
								<button
								tabIndex={-1}
								className="theme add"
								onClick={props.onAddTheme}
								title={intl.formatMessage({ id: "pdfReader.addTheme" })}
							><IconPlus/></button>
							</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default AppearancePopup;
