import {
	ANNOTATION_COLORS,
	DEFAULT_THEMES,
	EXTRA_INK_AND_TEXT_COLORS,
	INK_ANNOTATION_WIDTH_STEPS,
	TEXT_ANNOTATION_FONT_SIZE_STEPS
} from './defines';
import { measureTextAnnotationDimensions } from '../pdf/lib/text-annotation';

function appendCustomItemGroups(name, reader, params) {
	let itemGroups = [];
	let finished = false;
	let append = (...items) => {
		if (finished) {
			throw new Error('Append must be called directly and synchronously in the event');
		}
		itemGroups.push(items);
	};
	let event = new CustomEvent(`customEvent`, { detail: { type: name, reader, append, params } });
	window.dispatchEvent(event);
	finished = true;
	return itemGroups;
}

function createItemGroup(itemGroups) {
	return itemGroups.map(items => items.filter(x => x).filter(item => !item.disabled || item.persistent)).filter(items => items.length);
}

export function createColorContextMenu(reader, params) {
	let colors = ANNOTATION_COLORS.slice();
	if (['text', 'ink', 'eraser'].includes(reader._state.tool.type)) {
		colors.push(...EXTRA_INK_AND_TEXT_COLORS);
	}
	return {
		internal: true,
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			...[
				reader._state.tool.type === 'eraser'
					? colors.map(([label, color]) => ({
						label: reader._getString(label),
						disabled: reader._state.readOnly,
						checked: color === reader._state.tool.color,
						color: color,
						onCommand: () => reader.setTool({ type: 'ink', color })
					}))
					: colors.map(([label, color]) => ({
						label: reader._getString(label),
						disabled: reader._state.readOnly,
						checked: color === reader._state.tool.color,
						color: color,
						onCommand: () => reader.setTool({ color })
					}))
			],
			[
				['ink', 'eraser'].includes(reader._state.tool.type) && {
					eraser: true,
					label: reader._getString('pdfReader.eraser'),
					disabled: reader._state.readOnly,
					checked: reader._state.tool.type === 'eraser',
					onCommand: () => reader._state.tool.type === 'ink' ? reader.setTool({ type: 'eraser' }) : reader.setTool({ type: 'ink' })
				}
			],
			[
				reader._state.tool.type === 'text' && {
					slider: true,
					size: reader._state.tool.size,
					steps: TEXT_ANNOTATION_FONT_SIZE_STEPS,
					onCommand: (size) => reader.setTool({ size })
				},
				reader._state.tool.type === 'ink' && {
					slider: true,
					size: reader._state.tool.size,
					steps: INK_ANNOTATION_WIDTH_STEPS,
					onCommand: (size) => reader.setTool({ size })
				},
				reader._state.tool.type === 'eraser' && {
					slider: true,
					size: reader._state.tool.size,
					steps: INK_ANNOTATION_WIDTH_STEPS,
					onCommand: (size) => reader.setTool({ size })
				}
			],
			...appendCustomItemGroups('createColorContextMenu', reader, params)
		])
	};
}

export function createViewContextMenu(reader, params) {
	return {
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			[
				{
					label: reader._getString('pdfReader.copyLink'),
					disabled: !(params.overlay && params.overlay.type === 'external-link' && !reader.canCopy),
					onCommand: () => {
						navigator.clipboard.writeText(params.overlay.url);
					}
				}
			],
			[
				{
					label: reader._getString('general.copy'),
					disabled: !reader.canCopy,
					onCommand: () => reader.copy()
				}
			],
			[
				{
					label: reader._getString('pdfReader.zoomIn'),
					disabled: !reader.canZoomIn,
					persistent: true,
					onCommand: () => reader.zoomIn()
				},
				{
					label: reader._getString('pdfReader.zoomOut'),
					disabled: !reader.canZoomOut,
					persistent: true,
					onCommand: () => reader.zoomOut()
				},
				['epub', 'snapshot'].includes(reader._type) && {
					label: reader._getString('pdfReader.zoomReset'),
					disabled: !reader.canZoomReset,
					persistent: true,
					onCommand: () => reader.zoomReset()
				},
				reader._type === 'pdf' && {
					label: reader._getString('pdfReader.zoomAuto'),
					checked: reader.zoomAutoEnabled,
					onCommand: () => reader.zoomAuto()
				},
				reader._type === 'pdf' && {
					label: reader._getString('pdfReader.zoomPageWidth'),
					checked: reader.zoomPageWidthEnabled,
					onCommand: () => reader.zoomPageWidth()
				},
				reader._type === 'pdf' && {
					label: reader._getString('pdfReader.zoomPageHeight'),
					checked: reader.zoomPageHeightEnabled,
					onCommand: () => reader.zoomPageHeight()
				},
			],
			[
				{
					label: reader._getString('pdfReader.splitHorizontally'),
					checked: reader._state.splitType === 'horizontal',
					onCommand: () => reader.toggleHorizontalSplit()
				},
				{
					label: reader._getString('pdfReader.splitVertically'),
					checked: reader._state.splitType === 'vertical',
					onCommand: () => reader.toggleVerticalSplit()
				}
			],
			[
				{
					label: reader._getString('pdfReader.nextPage'),
					disabled: !reader.canNavigateToNextPage,
					persistent: true,
					onCommand: () => reader.navigateToNextPage()
				},
				{
					label: reader._getString('pdfReader.previousPage'),
					disabled: !reader.canNavigateToPreviousPage,
					persistent: true,
					onCommand: () => reader.navigateToPreviousPage()
				}
			],
			...appendCustomItemGroups('createViewContextMenu', reader, params)
		])
	};
}

export function createAnnotationContextMenu(reader, params) {
	let annotations = reader._state.annotations.filter(x => params.ids.includes(x.id));
	let readOnly = reader._state.readOnly || annotations.some(x => x.readOnly);
	let currentColor = annotations.length === 1 && annotations[0].color;
	let colors = ANNOTATION_COLORS.slice();
	if (annotations.every(x => ['text', 'ink'].includes(x.type))) {
		colors.push(...EXTRA_INK_AND_TEXT_COLORS);
	}
	return {
		internal: true,
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			[
				(reader._platform === 'zotero' || window.dev) && {
					label: reader._getString('pdfReader.addToNote'),
					disabled: !reader._state.enableAddToNote,
					persistent: true,
					onCommand: () => reader._onAddToNote(annotations)
				}
			],
			colors.map(([label, color]) => ({
				label: reader._getString(label),
				disabled: readOnly,
				persistent: true,
				checked: color === currentColor,
				color: color,
				onCommand: () => {
					let annotations = params.ids.map(id => ({ id, color }));
					reader._annotationManager.updateAnnotations(annotations);
				}
			})),
			[
				(annotations.every(x => x.type === 'ink') && {
					slider: true,
					size: annotations[0].position.width,
					disabled: readOnly,
					persistent: true,
					steps: INK_ANNOTATION_WIDTH_STEPS,
					onCommand: (width) => {
						reader._annotationManager.updateAnnotations(annotations.map(({ id, sortIndex }) => ({ id, sortIndex, position: { width } })));
					}
				}),
				(annotations.every(x => x.type === 'text') && {
					slider: true,
					size: annotations[0].position.fontSize,
					disabled: readOnly,
					persistent: true,
					steps: TEXT_ANNOTATION_FONT_SIZE_STEPS,
					onCommand: (fontSize) => {
						reader._annotationManager.updateAnnotations(annotations.map(({ id, sortIndex, comment, position }) => {
							position = measureTextAnnotationDimensions({
								comment,
								position: { ...position, fontSize }
							});
							return { id, sortIndex, position };
						}));
					}
				})
			],
			[
				// If context menu was triggered not from a view and, unless it was annotation popup
				(!params.view || params.popup) && {
					label: reader._getString('pdfReader.editPageNumber'),
					disabled: readOnly || reader._type !== 'pdf',
					persistent: reader._type === 'pdf',
					onCommand: () => reader._handleOpenPageLabelPopup(params.currentID)
				},
				!params.view && {
					label: reader._getString('pdfReader.editAnnotationText'),
					disabled: readOnly || !(
						params.ids.length === 1
						&& reader._state.annotations.find(x => x.id === params.ids[0] && ['highlight', 'underline'].includes(x.type))
						&& !params.popup
					),
					persistent: true,
					onCommand: () => reader._sidebarEditAnnotationText(params.ids[0])
				}
			],
			[
				(reader._platform === 'zotero' || window.dev) && {
					label: reader._getString('pdfReader.copyImage'),
					disabled: !(params.ids.length === 1 && reader._state.annotations.find(x => x.id === params.ids[0] && x.type === 'image')),
					onCommand: () => {
						let annotation = reader._state.annotations.find(x => params.ids.includes(x.id));
						if (annotation) {
							reader._onCopyImage(annotation.image);
						}
					}
				},
				(reader._platform === 'zotero' || window.dev) && {
					label: reader._getString('pdfReader.saveImageAs'),
					disabled: !(params.ids.length === 1 && reader._state.annotations.find(x => x.id === params.ids[0] && x.type === 'image')),
					onCommand: () => {
						let annotation = reader._state.annotations.find(x => params.ids.includes(x.id));
						if (annotation) {
							reader._onSaveImageAs(annotation.image);
						}
					}
				}
			],
			[
				annotations.every(x => ['highlight', 'underline'].includes(x.type))
				&& annotations.some(x => x.type === 'underline')
				&& {
					label: reader._getString('pdfReader.convertToHighlight'),
					disabled: readOnly,
					persistent: true,
					onCommand: () => reader.convertAnnotations(params.ids, 'highlight')
				},
				annotations.every(x => ['highlight', 'underline'].includes(x.type))
				&& annotations.some(x => x.type === 'highlight')
				&& {
					label: reader._getString('pdfReader.convertToUnderline'),
					disabled: readOnly,
					persistent: true,
					onCommand: () => reader.convertAnnotations(params.ids, 'underline')
				},
			],
			[
				annotations.length >= 2 && annotations.every(x => x.type === 'ink') && {
					label: reader._getString('pdfReader.merge'),
					disabled: readOnly
						|| (new Set(annotations.map(x => x.color))).size !== 1
						|| (new Set(annotations.map(x => x.position.pageIndex))).size !== 1,
					persistent: true,
					onCommand: () => {
						let annotation = reader.mergeAnnotations(params.ids);
						if (annotation) {
							reader._updateState({ selectedAnnotationIDs: [annotation.id] });
						}
					}
				},
			],
			[
				{
					label: reader._getString('general.delete'),
					disabled: readOnly,
					persistent: true,
					onCommand: () => reader.deleteAnnotations(params.ids)
				},
			],
			...appendCustomItemGroups('createAnnotationContextMenu', reader, params)
		])
	};
}

export function createThumbnailContextMenu(reader, params) {
	return {
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			[
				{
					label: reader._getString('pdfReader.rotateLeft'),
					disabled: reader._state.readOnly,
					persistent: true,
					onCommand: () => reader.rotatePages(params.pageIndexes, 270)
				},
				{
					label: reader._getString('pdfReader.rotateRight'),
					disabled: reader._state.readOnly,
					persistent: true,
					onCommand: () => reader.rotatePages(params.pageIndexes, 90)
				}
			],
			[
				reader._platform === 'zotero' && {
					label: reader._getString('general.delete'),
					disabled: reader._state.readOnly,
					persistent: true,
					onCommand: () => reader.deletePages(params.pageIndexes)
				},
			],
			...appendCustomItemGroups('createThumbnailContextMenu', reader, params)
		])
	};
}

export function createSelectorContextMenu(reader, params) {
	return {
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			[
				{
					label: reader._getString('general.clearSelection'),
					disabled: !params.enableClearSelection,
					persistent: true,
					onCommand: () => reader.setFilter({ colors: [], tags: [], authors: [] })
				}
			],
			...appendCustomItemGroups('createSelectorContextMenu', reader, params)
		])
	};
}

export function createThemeContextMenu(reader, params) {
	let readOnly = DEFAULT_THEMES.some(x => x.id === params.theme.id);
	return {
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			[
				{
					label: reader._getString('general.edit'),
					disabled: readOnly,
					persistent: true,
					onCommand: () => reader._updateState({ themePopup: { theme: params.theme } })
				},
				{
					label: reader._getString('general.delete'),
					disabled: readOnly,
					persistent: true,
					onCommand: () => {
						let { customThemes } = reader._state;
						customThemes = customThemes.filter(x => x.id !== params.theme.id);
						reader._onSaveCustomThemes(customThemes);
					}
				}
			],
			...appendCustomItemGroups('createThemeContextMenu', reader, params)
		])
	};
}
