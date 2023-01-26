import { ANNOTATION_COLORS } from './defines';

function createItemGroup(itemGroups) {
	return itemGroups.map(items => items.filter(x => x).filter(item => !item.disabled || item.persistent)).filter(items => items.length);
}

export function createColorContextMenu(reader, params) {
	return {
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			ANNOTATION_COLORS.map(([label, color]) => ({
				label: reader._getString(label),
				disabled: reader._readOnly,
				checked: color === reader._state.tool.color,
				color: color,
				onCommand: () => reader.setTool({ ...reader._state.tool, color })
			})),
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
			]
		])
	};
}

export function createAnnotationContextMenu(reader, params) {
	return {
		x: params.x,
		y: params.y,
		itemGroups: createItemGroup([
			ANNOTATION_COLORS.map(([label, color]) => ({
				label: reader._getString(label),
				disabled: reader._readOnly,
				checked: color === params.color,
				color: color,
				onCommand: () => {
					let annotations = params.ids.map(id => ({ id, color }));
					reader._annotationManager.updateAnnotations(annotations);
				}
			})),
			[
				{
					label: reader._getString('pdfReader.editPageNumber'),
					disabled: !(params.ids.length === 1 && !params.popup),
					onCommand: () => reader._sidebarOpenPageLabelPopup(params.ids[0])
				},
				{
					label: reader._getString('pdfReader.editHighlightedText'),
					disabled: !(params.ids.length === 1
						&& reader._state.annotations.find(x => x.id === params.ids[0] && x.type === 'highlight')
						&& !params.popup
					),
					onCommand: () => reader._sidebarEditHighlightText(params.ids[0])
				}
			],
			[
				{
					label: reader._getString('pdfReader.copyImage'),
					disabled: !(params.ids.length === 1 && reader._state.annotations.find(x => x.id === params.ids[0] && x.type === 'image')),
					onCommand: () => {
						let annotation = reader._state.annotations.find(x => params.ids.includes(x.id));
						if (annotation) {
							reader._onCopyImage(annotation.image);
						}
					}
				},
				{
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
				{
					label: reader._getString('general.delete'),
					disabled: params.readOnly,
					persistent: true,
					onCommand: () => reader._annotationManager.deleteAnnotations(params.ids)
				},
			]
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
					disabled: !params.readOnly,
					onCommand: () => reader.rotatePages(params.pageIndexes)
				},
				{
					label: reader._getString('pdfReader.rotateRight'),
					disabled: !params.readOnly,
					onCommand: () => reader.rotatePages(params.pageIndexes)
				},
				{
					label: reader._getString('pdfReader.rotate180'),
					disabled: !params.readOnly,
					onCommand: () => reader.rotatePages(params.pageIndexes)
				}
			],
			[
				{
					label: reader._getString('general.delete'),
					disabled: params.readOnly,
					onCommand: () => reader.deletePages(params.pageIndexes)
				},
			]
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
		])
	};
}
