import React, { useContext, useLayoutEffect, useRef } from 'react';
import cx from 'classnames';

import IconRevert from '../../../../res/icons/16/revert.svg';
import { useLocalization } from '@fluent/react';
import { DEFAULT_REFLOWABLE_APPEARANCE } from '../../../dom/common/defines';

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
import IconX from '../../../../res/icons/16/x-8.svg';
import IconOptions from '../../../../res/icons/16/options.svg';
import IconPlus from '../../../../res/icons/20/plus.svg';
import { getCurrentColorScheme, getPopupCoordinatesFromClickEvent } from '../../lib/utilities';
import { ReaderContext } from '../../reader';
import { DEFAULT_THEMES } from '../../defines';
import TickedRangeInput from "../common/ticked-range-input";

function ReflowableAppearanceSection({ params, enablePageWidth, onChange, indent }) {
	const { l10n } = useLocalization();

	const { type } = useContext(ReaderContext);

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
		params[name] = DEFAULT_REFLOWABLE_APPEARANCE[name];
		onChange(params);
	}

	return (
		<div className={cx('reflowable-appearance', { indent })}>
			<div className="row">
				<label htmlFor="line-height">{l10n.getString('reader-epub-appearance-line-height')}</label>
				<TickedRangeInput
					data-tabstop={1}
					tabIndex={-1}
					id="line-height"
					name="lineHeight"
					value={params.lineHeight}
					min="0.80"
					max="2.00"
					step="0.40"
					onChange={handleChange}
				/>
				<span className="value">{params.lineHeight}</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.lineHeight === DEFAULT_REFLOWABLE_APPEARANCE.lineHeight })}
					aria-label={l10n.getString('reader-epub-appearance-line-height-revert')}
					onClick={() => handleRevert('lineHeight')}
				><IconRevert/></button>
			</div>

			<div className="row">
				<label htmlFor="word-spacing">{l10n.getString('reader-epub-appearance-word-spacing')}</label>
				<TickedRangeInput
					data-tabstop={1}
					tabIndex={-1}
					id="word-spacing"
					name="wordSpacing"
					value={params.wordSpacing}
					min="-100"
					max="100"
					step="20"
					onChange={handleChange}
				/>
				<span className="value">{params.wordSpacing}%</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.wordSpacing === DEFAULT_REFLOWABLE_APPEARANCE.wordSpacing })}
					aria-label={l10n.getString('reader-epub-appearance-word-spacing-revert')}
					onClick={() => handleRevert('wordSpacing')}
				><IconRevert/></button>
			</div>

			<div className="row">
				<label htmlFor="letter-spacing">{l10n.getString('reader-epub-appearance-letter-spacing')}</label>
				<TickedRangeInput
					data-tabstop={1}
					tabIndex={-1}
					id="letter-spacing"
					name="letterSpacing"
					value={params.letterSpacing}
					min="-0.1"
					max="0.1"
					step="0.020"
					onChange={handleChange}
				/>
				<span className="value">{params.letterSpacing * 1000}%</span>
				<button
					data-tabstop={1}
					tabIndex={-1}
					className={cx('toolbar-button', { hidden: params.letterSpacing === DEFAULT_REFLOWABLE_APPEARANCE.letterSpacing })}
					aria-label={l10n.getString('reader-epub-appearance-letter-spacing-revert')}
					onClick={() => handleRevert('letterSpacing')}
				><IconRevert/></button>
			</div>

			<div className="row">
				<label htmlFor="page-width">{l10n.getString('reader-epub-appearance-page-width')}</label>
				<TickedRangeInput
					data-tabstop={1}
					tabIndex={-1}
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
					className={cx('toolbar-button', { hidden: params.pageWidth === DEFAULT_REFLOWABLE_APPEARANCE.pageWidth })}
					aria-label={l10n.getString('reader-epub-appearance-page-width-revert')}
					onClick={() => handleRevert('pageWidth')}
					disabled={!enablePageWidth}
				><IconRevert/></button>
			</div>

			{type === 'epub' && (
				<div className="option">
					<label htmlFor="use-original-font">
						{l10n.getString('reader-epub-appearance-use-original-font')}
					</label>
					<input
						data-tabstop={1}
						tabIndex={-1}className="switch"
						type="checkbox"
						id="use-original-font"
						name="useOriginalFont"
						checked={params.useOriginalFont}
						onChange={handleChange}
					/>

				</div>
			)}
		</div>
	);
}

function Theme({ theme, active, onSet, onOpenContextMenu }) {
	const { l10n } = useLocalization();
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

	const titleId = `reader-theme-${theme.id}`;
	let name;
	try {
		name = l10n.getString(titleId);
		// Some implementations return the ID itself when missing
		if (name === titleId) {
			name = theme.label;
		}
	} catch {
		name = theme.label;
	}

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
						title={l10n.getString('reader-theme-options') }
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
	let { l10n } = useLocalization();

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
							<label>{l10n.getString('reader-scroll-mode')}</label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.scrollMode === 0 })}
									title={l10n.getString('reader-vertical')}
									onClick={() => props.onChangeScrollMode(0)}
								><IconScrollVertical/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.scrollMode === 1 })}
									title={l10n.getString('reader-horizontal')}
									onClick={() => props.onChangeScrollMode(1)}
								><IconScrollHorizontal/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.scrollMode === 2 })}
									title={l10n.getString('reader-wrapped')}
									onClick={() => props.onChangeScrollMode(2)}
								><IconScrollWrapped/></button>
							</div>
						</div>
						<div className="option">
							<label>{l10n.getString('reader-spread-mode')}</label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 0 })}
									title={l10n.getString('reader-none')}
									onClick={() => props.onChangeSpreadMode(0)}
								><IconSpreadNone/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 1 })}
									title={l10n.getString('reader-odd')}
									onClick={() => props.onChangeSpreadMode(1)}
								><IconSpreadOdd/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 2 })}
									title={l10n.getString('reader-even')}
									onClick={() => props.onChangeSpreadMode(2)}
								><IconSpreadEven/></button>
							</div>
						</div>
					</div>
				)}
				{type === 'epub' && (
					<div className="group">
						<div className="option">
							<label>{l10n.getString('reader-flow-mode')}</label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.flowMode === 'paginated' })}
									title={l10n.getString('reader-paginated')}
									onClick={() => props.onChangeFlowMode('paginated')}
								><IconFlowPaginated/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.flowMode === 'scrolled' })}
									title={l10n.getString('reader-scrolled')}
									onClick={() => props.onChangeFlowMode('scrolled')}
								><IconFlowScrolled/></button>
							</div>
						</div>
						<div className="option">
							<label>{l10n.getString('reader-columns')}</label>
							<div className="split-toggle" data-tabstop={1}>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 0 })}
									title={l10n.getString('reader-single')}
									onClick={() => props.onChangeSpreadMode(0)}
									disabled={props.viewStats.flowMode === 'scrolled'}
								><IconColumnSingle/></button>
								<button
									tabIndex={-1}
									className={cx({ active: props.viewStats.spreadMode === 1 })}
									title={l10n.getString('reader-double')}
									onClick={() => props.onChangeSpreadMode(1)}
									disabled={props.viewStats.flowMode === 'scrolled'}
								><IconColumnDouble/></button>
							</div>
						</div>
					</div>
				)}
				<div className="group">
					<div className="option">
						<label>{l10n.getString('reader-split-view')}</label>
						<div className="split-toggle" data-tabstop={1}>
							<button
								tabIndex={-1}
								className={cx({ active: !props.splitType })}
								title={l10n.getString('reader-none')}
								onClick={() => props.onChangeSplitType()}
							><IconSplitNone/></button>
							<button
								tabIndex={-1}
								className={cx({ active: props.splitType === 'vertical' })}
								title={l10n.getString('reader-vertical')}
								onClick={() => props.onChangeSplitType('vertical')}
							><IconSplitHorizontal/></button>
							<button
								tabIndex={-1}
								className={cx({ active: props.splitType === 'horizontal' })}
								title={l10n.getString('reader-horizontal')}
								onClick={() => props.onChangeSplitType('horizontal')}
							><IconSplitVertical/></button>
						</div>
					</div>
				</div>
				{(type === 'epub' || type === 'snapshot') && (
					<div className="group">
						{type === 'snapshot' && (
							<div className="option">
								<label htmlFor="reading-mode-enabled">{l10n.getString('reader-reading-mode')}</label>
								<input
									data-tabstop={1}
									tabIndex={-1}
									className="switch"
									type="checkbox"
									id="reading-mode-enabled"
									checked={props.viewStats.readingModeEnabled}
									onChange={e => props.onChangeReadingModeEnabled(e.target.checked)}
								/>
							</div>
						)}
						{(type === 'epub' || props.viewStats.readingModeEnabled) && (
							<ReflowableAppearanceSection
								params={props.viewStats.appearance}
								enablePageWidth={type === 'snapshot'
									|| props.viewStats.flowMode !== 'paginated' || props.viewStats.spreadMode === 0}
								onChange={props.onChangeAppearance}
								indent={type === 'snapshot'}
							/>
						)}
					</div>
				)}
				<div className="group">
					<div className="option themes">
						<label>{l10n.getString('reader-themes')}</label>
						<div className="themes" data-tabstop={1}>
							<button
								tabIndex={-1}
								className={cx('theme original', { active: !currentTheme })}
								style={{ backgroundColor: '#ffffff', color: '#000000' }}
								title={l10n.getString('reader-theme-original')}
								onClick={() => props.onChangeTheme()}
							>{l10n.getString('reader-theme-original')}</button>
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
								title={l10n.getString('reader-add-theme')}
							><IconPlus/></button>
							</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default AppearancePopup;
