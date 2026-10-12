/* eslint-disable react/prop-types */
import React, {
	Fragment,
	useEffect,
	useId,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from 'react';
import { useLocalization } from '@fluent/react';
import cx from 'classnames';

import ViewPopup from '../../common/view-popup';
import FormattedText from './common/formated-text';
import ReferenceItemIcon from './reference-item-icon';
import {
	createReferenceParts,
	canStartReferenceLookup,
	canStartReferenceAction,
	createReferencePopupState,
	getReferencePopupPresentation,
	getSelectedEntry,
	referencePopupReducer,
} from './reference-popup-state.mjs';

import IconCitationCached from '../../../../../../res/icons/16/citation-cached.svg';
import IconCitationNoMatch from '../../../../../../res/icons/16/citation-no-match.svg';
import IconChevronDown from '../../../../../../res/icons/16/chevron-12-down.svg';
import IconChevronLeft from '../../../../../../res/icons/16/chevron-12-left.svg';
import IconChevronUp from '../../../../../../res/icons/16/chevron-12-up.svg';
import IconLibraryLookup from '../../../../../../res/icons/16/library-lookup.svg';
import IconSpinner from '../../../../../../res/icons/16/spinner.svg';


const ERROR_LOOKUP_STATUSES = new Set([
	'offline',
	'rate-limited',
	'timeout',
	'error',
]);

function LookupIcon({ entry, platform, colorScheme }) {
	if (!entry || ['idle', 'loading'].includes(entry.lookup.status)) {
		return <IconSpinner className="spinner-16" aria-hidden="true"/>;
	}
	let { status, result } = entry.lookup.response;
	if (platform === 'zotero' && result?.libraryState === 'existing') {
		return <ReferenceItemIcon itemType={result.display.itemType} colorScheme={colorScheme}><IconLibraryLookup className="library-lookup" aria-hidden="true"/></ReferenceItemIcon>;
	}
	if (status === 'strong') {
		return <IconCitationCached className="citation-cached" aria-hidden="true"/>;
	}
	if (status === 'no-match') {
		return <IconLibraryLookup className="library-lookup" aria-hidden="true"/>;
	}
	return <IconCitationNoMatch className="citation-no-match" aria-hidden="true"/>;
}

function ResultMetadata({ result, string }) {
	let { display } = result;
	let creatorYear = display.firstCreator && display.year
		? `${display.firstCreator} (${display.year})`
		: display.firstCreator || display.year;
	return (
		<div className={cx('item-preview', { 'no-abstract': !display.abstract })}
			tabIndex={-1} data-tabstop={1} role="group" aria-label={display.title}>
			<div className="metadata" role="group" aria-label={result.libraryState === 'existing' ? string('reader-reference-existing') : undefined}>
				<div className="title selectable">{display.title}</div>
				{creatorYear && <div className="author-year selectable">{creatorYear}</div>}
			</div>
			{display.abstract && <div className="abstract selectable">{display.abstract}</div>}
		</div>
	);
}

function ResultActionButtons({ entry, result, actions, actionRefs, onAction, string }) {
	let labels = {
		'add-to-library': 'reader-reference-action-add-to-library',
		'show-in-library': 'general-show-in-library',
		'open-attachment': 'reader-reference-action-open-attachment',
		'view-online': 'view-online',
	};
	let running = entry.action.status === 'running';
	return (
		<Fragment>
			{actions.map(action => (
				<button
					type="button"
					tabIndex={-1}
					className={cx('form-button', { 'add-to-library': action === 'add-to-library' })}
					disabled={!canStartReferenceAction(entry, result, action)}
					ref={(element) => {
						if (element) actionRefs.current.set(action, element);
						else actionRefs.current.delete(action);
					}}
					onClick={() => onAction(result, action)}
					key={action}
				>
					{running && entry.action.action === action
						&& <IconSpinner className="spinner-16" aria-hidden="true"/>}
					<span>{string(labels[action])}</span>
				</button>
			))}
		</Fragment>
	);
}

function ActionError({ entry, string }) {
	if (entry.action.status !== 'complete'
			|| ['ok', 'saved', 'existing', 'stale'].includes(entry.action.response.status)) return null;
	return <div className="reference-action-message error" role="alert">
		{string('reader-reference-error')}
	</div>;
}

function LookupMessage({ entry, quiet, string }) {
	return (
		<div className={quiet ? 'reference-lookup-announcer' : 'reference-message'}
			role={ERROR_LOOKUP_STATUSES.has(entry.lookup.response?.status) ? 'alert' : 'status'}>
			{getLookupStatusText(entry, string)}
		</div>
	);
}

function ReferenceRow({ reference, entry, previewed, onSelect, rowRef, string, platform, colorScheme }) {
	let statusID = useId();
	function handleKeyDown(event) {
		if (event.target !== event.currentTarget) return;
		if (['Enter', ' '].includes(event.key)) {
			event.preventDefault();
			onSelect(reference.sourceKey);
		}
	}

	return (
		<div
			className={cx('reference-row', { previewed })}
			data-source-key={reference.sourceKey}
			role="button"
			aria-describedby={statusID}
			tabIndex={-1}
			ref={rowRef}
			onClick={() => onSelect(reference.sourceKey)}
			onKeyDown={handleKeyDown}
		>
			<span className="start"><span className="icon"><LookupIcon entry={entry} platform={platform} colorScheme={colorScheme}/></span></span>
			<div className="middle"><FormattedText chars={reference.chars} linksEnabled={false}/></div>
			<span id={statusID} hidden>{getLookupStatusText(entry, string)}</span>
			{platform === 'zotero' && entry?.lookup.response?.result?.libraryState === 'existing'
				&& entry?.lookup.response?.result.actions.includes('open-attachment')
				&& <ReferenceItemIcon attachment colorScheme={colorScheme}/>}
		</div>
	);
}

function getLookupStatusText(entry, string) {
	if (entry?.expired) return string('reader-reference-error');
	if (!entry || ['idle', 'loading'].includes(entry.lookup.status)) {
		return string('general-loading');
	}
	let { response } = entry.lookup;
	if (response.status === 'strong') return response.result.display.title;
	return string(response.status === 'no-match' ? 'reader-reference-no-match' : 'reader-reference-error');
}

function ReferenceAnnouncement({ entry, string }) {
	// Failures have their own live message, including a result that became stale.
	if (entry.expired) return '';
	if (entry.action.status === 'running') return string('general-loading');
	if (entry.action.status === 'complete') {
		return ['saved', 'existing'].includes(entry.action.response.status)
			? string('reader-reference-existing')
			: '';
	}
	if (entry.lookup.status === 'resolved'
			&& entry.lookup.response.status !== 'strong') return '';
	return getLookupStatusText(entry, string);
}

export default function ReferencePopup(props) {
	let {
		params,
		referencePopupOwner,
		referencePopupBridge: bridge,
		previewedReferences,
		onClose,
		onOpenLink,
		onPreviewReference,
		onSetPersistent,
	} = props;
	let referenceTextID = useId();
	let { l10n } = useLocalization();
	let string = key => l10n.getString(key);
	let references = params.references;
	// Include linked runs as well as visible text when detecting a replaced reference.
	let referencesSignature = JSON.stringify(references.map(reference => [reference.sourceKey, createReferenceParts(reference)]));
	let [state, dispatch] = useReducer(
		referencePopupReducer,
		null,
		() => createReferencePopupState(references)
	);
	let lookupHandles = useRef(new Map());
	let actionHandles = useRef(new Map());
	let popupRef = useRef();
	let detailRef = useRef();
	let textRef = useRef();
	let referenceToggleRef = useRef();
	let rowRefs = useRef(new Map());
	let actionRefs = useRef(new Map());
	let shouldFocusDetail = useRef(false);
	let shouldFocusRow = useRef(null);
	let shouldFocusAction = useRef(null);
	let wasPersistent = useRef(false);
	let [canExpand, setCanExpand] = useState(false);
	let [popupPointerFocus, setPopupPointerFocus] = useState(false);
	let expandedResponses = useRef(new WeakSet());
	let canFindOnline = !!bridge?.canFindOnline;

	function cancelLookups() {
		for (let handle of lookupHandles.current.values()) handle.cancel();
		lookupHandles.current.clear();
	}

	function ignoreActions() {
		for (let handle of actionHandles.current.values()) handle.ignore();
		actionHandles.current.clear();
	}

	function installLookup(sourceKey, source, start) {
		lookupHandles.current.get(sourceKey)?.cancel();
		let handle = start((response) => {
			lookupHandles.current.delete(sourceKey);
			dispatch({ type: 'lookup-resolved', sourceKey, response });
		});
		lookupHandles.current.set(sourceKey, handle);
		dispatch({
			type: 'lookup-started',
			sourceKey,
			source,
			requestID: handle.requestID,
		});
	}

	function startLocalLookup(reference) {
		installLookup(reference.sourceKey, 'local', callback => (
			bridge.startLocalLookup({
				// Host replacement is view-owned; keep raw SDT identity in the UI state.
				sourceKey: `${referencePopupOwner}:${reference.sourceKey}`,
				referenceParts: createReferenceParts(reference),
			}, callback)
		));
	}

	useEffect(() => {
		cancelLookups();
		ignoreActions();
		setPopupPointerFocus(false);
		dispatch({
			type: 'reset',
			references,
		});
		let unsubscribe = bridge?.subscribeResultUpdates(update => dispatch({ type: 'result-updated', ...update }));
		if (bridge?.enabled) {
			for (let reference of references) startLocalLookup(reference);
			if (references.length === 1) onPreviewReference?.(references[0]);
		}
		return () => {
			unsubscribe?.();
			cancelLookups();
			ignoreActions();
		};
		// The signature intentionally owns reference identity/content changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [bridge, referencesSignature, referencePopupOwner]);

	useEffect(() => {
		let handlePointerDown = (event) => {
			if (params.persistent && !popupRef.current?.contains(event.target)) {
				onClose();
			}
		};
		let handleKeyDown = (event) => {
			if (event.key === 'Escape' && popupRef.current?.contains(event.target)) {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener('pointerdown', handlePointerDown, true);
		window.addEventListener('keydown', handleKeyDown, true);
		return () => {
			window.removeEventListener('pointerdown', handlePointerDown, true);
			window.removeEventListener('keydown', handleKeyDown, true);
		};
	}, [params.persistent, onClose]);

	let selectedEntry = getSelectedEntry(state);
	let lookupResponse = selectedEntry?.lookup.status === 'resolved'
		? selectedEntry.lookup.response
		: null;
	useLayoutEffect(() => {
		let promoted = params.persistent && !wasPersistent.current;
		wasPersistent.current = !!params.persistent;
		if (!promoted || popupRef.current?.contains(document.activeElement)) return;
		let target = detailRef.current || popupRef.current?.querySelector('.reference-row');
		if (target) {
			target.focus();
		}
	}, [params.persistent, referencesSignature, state.selectedSourceKey]);

	useLayoutEffect(() => {
		if (state.selectedSourceKey !== null || !shouldFocusRow.current) return;
		let target = rowRefs.current.get(shouldFocusRow.current);
		if (target) {
			shouldFocusRow.current = null;
			target.focus();
		}
	}, [state.selectedSourceKey]);

	useLayoutEffect(() => {
		let pending = shouldFocusAction.current;
		if (selectedEntry?.action.status !== 'complete'
				|| pending?.sourceKey !== selectedEntry.reference.sourceKey
				|| pending?.requestID !== selectedEntry.action.requestID) {
			return;
		}
		let target = actionRefs.current.get(pending.action)
			|| actionRefs.current.values().next().value
			|| detailRef.current;
		shouldFocusAction.current = null;
		target?.focus();
	}, [
		selectedEntry?.action.status,
		selectedEntry?.action.requestID,
		selectedEntry?.reference.sourceKey,
	]);

	useEffect(() => {
		let handleFocus = (event) => {
			if (shouldFocusAction.current?.element !== event.target) {
				shouldFocusAction.current = null;
			}
		};
		document.addEventListener('focusin', handleFocus);
		return () => document.removeEventListener('focusin', handleFocus);
	}, []);

	useLayoutEffect(() => {
		if (shouldFocusDetail.current && detailRef.current) {
			shouldFocusDetail.current = false;
			detailRef.current.focus();
		}
	}, [
		state.selectedSourceKey,
		selectedEntry?.lookup.requestID,
	]);

	useLayoutEffect(() => {
		// Keep the collapsed overflow measurement while expanded so the toggle stays stable.
		if (selectedEntry?.expanded) return;
		let nextCanExpand = !!textRef.current
			&& textRef.current.scrollHeight > textRef.current.clientHeight;
		if (!nextCanExpand && document.activeElement === referenceToggleRef.current) detailRef.current?.focus();
		setCanExpand(nextCanExpand);
	}, [referencesSignature, state.selectedSourceKey, lookupResponse?.status, selectedEntry?.expanded]);

	useEffect(() => {
		if (lookupResponse && selectedEntry.lookup.source === 'local'
				&& !expandedResponses.current.has(lookupResponse)
				&& ['invalid', 'no-match', 'incomplete'].includes(lookupResponse.status)) {
			// Expand once per response; subsequent manual collapse belongs to the user.
			expandedResponses.current.add(lookupResponse);
			dispatch({
				type: 'set-expanded',
				sourceKey: selectedEntry.reference.sourceKey,
				expanded: true,
			});
		}
	}, [lookupResponse, selectedEntry?.lookup.source, selectedEntry?.reference.sourceKey]);


	function makePersistent() {
		if (!params.persistent) {
			onSetPersistent?.(true);
		}
	}

	function selectReference(sourceKey) {
		makePersistent();
		shouldFocusAction.current = null;
		shouldFocusDetail.current = true;
		dispatch({ type: 'set-expanded', sourceKey, expanded: false });
		dispatch({ type: 'select-reference', sourceKey });
		let reference = state.entries[sourceKey]?.reference;
		if (reference) onPreviewReference?.(reference);
	}

	let selectedReference = selectedEntry?.reference ?? null;
	let selectedResult = lookupResponse?.result;
	let primaryActions = (selectedResult?.libraryState === 'existing'
		? ['show-in-library', selectedResult.actions.includes('open-attachment') ? 'open-attachment' : 'view-online']
		: ['add-to-library', 'view-online']).filter(action => selectedResult?.actions.includes(action));
	let retrySource = !selectedEntry?.expired && selectedEntry?.lookup.source === 'online' && lookupResponse?.referenceKey
		? 'online'
		: 'local';
	let canRetry = canStartReferenceLookup(selectedEntry, retrySource, canFindOnline);

	function handleReturn() {
		shouldFocusAction.current = null;
		shouldFocusRow.current = selectedReference.sourceKey;
		dispatch({ type: 'select-reference', sourceKey: null });
	}

	function handleLookup(source) {
		if (!canStartReferenceLookup(selectedEntry, source, canFindOnline)
				|| source === 'online' && (selectedEntry.expired || !lookupResponse?.referenceKey)) return;
		makePersistent();
		shouldFocusAction.current = null;
		shouldFocusDetail.current = true;
		if (source === 'online') {
			installLookup(selectedReference.sourceKey, 'online', callback => (
				bridge.startOnlineLookup({ referenceKey: lookupResponse.referenceKey }, callback)
			));
		}
		else {
			startLocalLookup(selectedReference);
		}
	}

	function handleAction(result, action) {
		let response = selectedEntry.lookup.response;
		if (!response?.referenceKey || !canStartReferenceAction(selectedEntry, result, action)) {
			return;
		}
		makePersistent();
		actionHandles.current.get(selectedReference.sourceKey)?.ignore();
		let handle = bridge.startAction({
			referenceKey: response.referenceKey,
			resultID: result.resultID,
			action,
		}, (actionResponse) => {
			actionHandles.current.delete(selectedReference.sourceKey);
			dispatch({
				type: 'action-resolved',
				sourceKey: selectedReference.sourceKey,
				response: actionResponse,
			});
		});
		shouldFocusAction.current = {
			sourceKey: selectedReference.sourceKey,
			requestID: handle.requestID,
			action,
			element: document.activeElement,
		};
		actionHandles.current.set(selectedReference.sourceKey, handle);
		dispatch({
			type: 'action-started',
			sourceKey: selectedReference.sourceKey,
			requestID: handle.requestID,
			resultID: result.resultID,
			action,
		});
	}

	if (!bridge?.enabled) {
		return (
			<ViewPopup
				popupRef={popupRef}
				className="reference-popup legacy"
				rect={params.rect}
				uniqueRef={referencesSignature}
				padding={10}
			>
				<div className="inner">
					{references.map(reference => (
						<div className="reference-row legacy" key={reference.sourceKey}>
							<div><FormattedText chars={reference.chars} onOpenLink={onOpenLink}/></div>
						</div>
					))}
				</div>
			</ViewPopup>
		);
	}

	let presentation = selectedEntry ? getReferencePopupPresentation(selectedEntry, canFindOnline) : null;
	let retry = presentation?.retry;
	let showFind = presentation?.findOnline;
	let showFooter = retry || primaryActions.length || showFind;
	let footerFocusable = (retry && canRetry) || showFind
		|| primaryActions.some(action => canStartReferenceAction(selectedEntry, selectedResult, action));
	return (
		<ViewPopup
			popupRef={popupRef}
			className="reference-popup"
			stableAttachment={{ width: 400, height: 300 }}
			rect={params.rect}
			padding={10}
		>
			<div
				className="inner"
				role="dialog"
				onPointerDownCapture={() => setPopupPointerFocus(true)}
				onKeyDownCapture={(event) => {
					if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
						setPopupPointerFocus(false);
					}
				}}
				aria-label={string('reader-reference-popup')}
				data-tabstop={!selectedEntry ? 1 : undefined}
			>
				{!selectedEntry
					? references.map(reference => (
						<ReferenceRow
							platform={props.platform}
							colorScheme={props.colorScheme}
							reference={reference}
							entry={state.entries[reference.sourceKey]}
							previewed={previewedReferences?.has(reference.sourceKey)}
							onSelect={selectReference}
							string={string}
							rowRef={(element) => {
								if (element) rowRefs.current.set(reference.sourceKey, element);
								else rowRefs.current.delete(reference.sourceKey);
							}}
							key={reference.sourceKey}
						/>
					))
					: (
						<div className={cx('reference-preview', { matched: !!selectedResult })}>
							<div className="reference-header-focus-group" data-tabstop={1}>
								<div className={cx('header', { 'pointer-focus': popupPointerFocus })} ref={detailRef} tabIndex={-1}>
									{references.length > 1 && (
										<div className="start">
											<button
												type="button"
												tabIndex={-1}
												className="icon-button"
												aria-label={string('general-back')}
												title={string('general-back')}
												onClick={handleReturn}
											><IconChevronLeft/></button>
										</div>
									)}
									<div className="middle">
										<div className="icon"><LookupIcon entry={selectedEntry} platform={props.platform} colorScheme={props.colorScheme}/></div>
										<div
											ref={textRef}
											id={referenceTextID}
											className={cx('text', {
												expanded: selectedEntry.expanded,
												selectable: selectedEntry.expanded,
											})}
											onPointerDown={() => dispatch({
												type: 'set-expanded',
												sourceKey: selectedReference.sourceKey,
												expanded: true,
											})}
										>
											<FormattedText
												chars={selectedReference.chars}
												onOpenLink={onOpenLink}
												linkTabIndex={-1}
											/>
										</div>
									</div>
									<div className="end">
										{(canExpand || selectedEntry.expanded) && <button
											ref={referenceToggleRef}
											type="button"
											tabIndex={-1}
											className="icon-button"
											aria-label={string(selectedEntry.expanded ? 'reader-reference-collapse' : 'reader-reference-expand')}
											title={string(selectedEntry.expanded ? 'reader-reference-collapse' : 'reader-reference-expand')}
											aria-expanded={selectedEntry.expanded}
											aria-controls={referenceTextID}
											onClick={() => {
												if (selectedEntry.expanded && !canExpand) detailRef.current?.focus();
												dispatch({
													type: 'set-expanded',
													sourceKey: selectedReference.sourceKey,
													expanded: !selectedEntry.expanded,
												});
											}}
										>{selectedEntry.expanded ? <IconChevronUp/> : <IconChevronDown/>}</button>}
									</div>
								</div>
							</div>
							<div className="reference-lookup-announcer" aria-live="polite" aria-atomic="true">
								<ReferenceAnnouncement entry={selectedEntry} string={string}/>
							</div>

							{presentation.content === 'loading' && selectedEntry.lookup.source === 'online' && (
								<div className="reference-message reference-loading" aria-hidden="true">{string('general-loading')}</div>
							)}
							{presentation.content === 'result' && selectedResult && (
								<ResultMetadata result={selectedResult} string={string}/>
							)}
							{(presentation.content === 'message' || selectedEntry.expired)
								&& <LookupMessage entry={selectedEntry} quiet={showFind && lookupResponse.status === 'no-match'} string={string}/>}
							{selectedResult && <ActionError entry={selectedEntry} string={string}/>}
							{showFooter && <div className="actions reference-actions" data-tabstop={footerFocusable ? 1 : undefined}
								aria-busy={selectedEntry.action.status === 'running' || selectedEntry.lookup.status === 'loading'}>
								{retry
									? <button type="button" tabIndex={-1} className="form-button" onClick={() => handleLookup(retrySource)} disabled={!canRetry}>
										{string('reader-reference-retry')}
									</button>
									: selectedResult && <ResultActionButtons entry={selectedEntry} result={selectedResult} actions={primaryActions}
										actionRefs={actionRefs} onAction={handleAction} string={string}/>}
								{showFind && <button type="button" tabIndex={-1} className="form-button" onClick={() => handleLookup('online')}
									disabled={!canStartReferenceLookup(selectedEntry, 'online', canFindOnline)}>
									{string('reader-reference-find-online')}
								</button>}
							</div>}
						</div>
					)}
			</div>
		</ViewPopup>
	);
}
