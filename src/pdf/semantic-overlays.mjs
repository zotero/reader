import {
	buildRunData,
	parseTextMap,
} from '../../structured-document-text/src/pdf/decode.js';
import { findChunkIndex } from '../../structured-document-text/src/pack/format.js';
import {
	compareRefs,
	getContentRangeBlockSpan,
	isLeafBlock,
	refKey,
} from '../../structured-document-text/src/range.js';
import { isFiniteRect } from './pdf-page-data.mjs';

const rectKey = rect => rect.join(',');
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'mailto:', 'tel:']);

function getSafeURL(value) {
	if (typeof value !== 'string' || !value) {
		return null;
	}
	try {
		return SAFE_URL_PROTOCOLS.has(new URL(value).protocol) ? value : null;
	}
	catch (e) {
		return null;
	}
}

function isTextNode(node) {
	return node && typeof node === 'object' && typeof node.text === 'string';
}

async function hasTextNodeChild(node, control) {
	for (let child of node?.content || []) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		if (isTextNode(child)) {
			return true;
		}
	}
	return false;
}

function getNodeByRef(structure, ref) {
	let node = structure;
	for (let index of ref) {
		if (!Array.isArray(node?.content) || !node.content[index]) {
			return null;
		}
		node = node.content[index];
	}
	return node;
}

function createProjectionControl({
	signal = null,
	yieldControl = () => new Promise(resolve => setTimeout(resolve)),
	yieldAfter = 256,
	maxWorkMs = 4,
} = {}) {
	let count = 0;
	let deadline = performance.now() + maxWorkMs;
	let throwIfAborted = () => {
		if (signal?.aborted) {
			let error = new Error('SDT projection aborted');
			error.name = 'AbortError';
			throw error;
		}
	};
	return {
		checkpoint() {
			throwIfAborted();
			if (!yieldControl || ++count < yieldAfter) {
				return null;
			}
			count = 0;
			if (maxWorkMs > 0 && performance.now() < deadline) {
				return null;
			}
			return Promise.resolve(yieldControl()).then(() => {
				deadline = performance.now() + maxWorkMs;
				throwIfAborted();
			});
		},
		throwIfAborted,
	};
}

async function collectTextEntries(roots, control, shouldCollect = () => true) {
	let entries = [];
	let stack = [];
	for (let i = roots.length - 1; i >= 0; i--) {
		stack.push({
			...roots[i],
			block: roots[i].block ?? null,
			blockRef: roots[i].blockRef ?? null,
		});
	}
	while (stack.length) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		let entry = stack.pop();
		let { node, ref } = entry;
		if (!node || typeof node !== 'object') {
			continue;
		}
		if (isTextNode(node)) {
			if (shouldCollect(entry)) {
				entries.push(entry);
			}
			continue;
		}
		if (!Array.isArray(node.content)) {
			continue;
		}
		let { block, blockRef } = entry;
		if (await hasTextNodeChild(node, control)) {
			block = node;
			blockRef = ref;
		}
		for (let i = node.content.length - 1; i >= 0; i--) {
			let pending = control.checkpoint();
			if (pending) {
				await pending;
			}
			stack.push({
				...entry,
				node: node.content[i],
				ref: [...ref, i],
				block,
				blockRef,
			});
		}
	}
	return entries;
}

async function collectSemanticTextEntries(roots, control) {
	return collectTextEntries(
		roots.map(root => ({
			...root,
			flowClass: root.flowClass ?? root.node?.flowClass ?? 'body',
		})),
		control,
		({ node, flowClass }) => (
			flowClass !== 'body'
			|| node.target?.url
			|| node.target?.position
			|| node.refs?.length
		)
	);
}

async function getTextEntriesForRef(structure, ref, cache, control) {
	let cacheKey = refKey(ref);
	if (cache.has(cacheKey)) {
		return cache.get(cacheKey);
	}
	let root = getNodeByRef(structure, ref);
	if (!root) {
		cache.set(cacheKey, []);
		return [];
	}
	let block = null;
	let blockRef = null;
	if (isTextNode(root)) {
		for (let length = ref.length - 1; length > 0; length--) {
			let pending = control.checkpoint();
			if (pending) {
				await pending;
			}
			let candidateRef = ref.slice(0, length);
			let candidate = getNodeByRef(structure, candidateRef);
			if (await hasTextNodeChild(candidate, control)) {
				block = candidate;
				blockRef = candidateRef;
				break;
			}
		}
	}
	let entries = await collectTextEntries([{
		node: root,
		ref,
		block,
		blockRef,
	}], control);
	cache.set(cacheKey, entries);
	return entries;
}

function positionFromPageRects(pageRects, pageCount = Infinity) {
	if (!Array.isArray(pageRects)) {
		return null;
	}
	let byPage = new Map();
	for (let pageRect of pageRects) {
		if (!Array.isArray(pageRect)
				|| !Number.isInteger(pageRect[0])
				|| pageRect[0] < 0
				|| pageRect[0] >= pageCount
				|| !isFiniteRect(pageRect.slice(1))) {
			continue;
		}
		let rects = byPage.get(pageRect[0]) || [];
		rects.push(pageRect.slice(1));
		byPage.set(pageRect[0], rects);
	}
	let pages = [...byPage.keys()].sort((a, b) => a - b);
	if (!pages.length
			|| pages.length > 2
			|| (pages.length === 2 && pages[1] !== pages[0] + 1)) {
		return null;
	}
	let position = {
		pageIndex: pages[0],
		rects: byPage.get(pages[0]),
	};
	if (pages[1] === pages[0] + 1) {
		position.nextPageRects = byPage.get(pages[1]);
	}
	return position;
}

function getTextEntryPosition(mapper, entry) {
	if (!entry.block || !entry.blockRef) {
		return positionFromPageRects(entry.node.anchor?.pageRects);
	}
	try {
		return mapper.textNodeSpansToSourcePosition([{
			block: entry.block,
			blockRef: entry.blockRef,
			node: entry.node,
			ref: entry.ref,
			start: 0,
			end: entry.node.text.length,
		}]);
	}
	catch (e) {
		console.warn('Failed to map SDT text node to PDF position', e);
		return null;
	}
}

async function getRefPosition(
	structure,
	mapper,
	ref,
	positionCache,
	textEntryCache,
	control
) {
	let cacheKey = refKey(ref);
	if (positionCache.has(cacheKey)) {
		return positionCache.get(cacheKey);
	}
	let pageCount = structure.catalog.pages.length;
	let spans = (await getTextEntriesForRef(structure, ref, textEntryCache, control))
		.map(entry => ({
			block: entry.block,
			blockRef: entry.blockRef,
			node: entry.node,
			ref: entry.ref,
			start: 0,
			end: entry.node.text.length,
		}));
	if (spans.length) {
		try {
			let position = mapper.textNodeSpansToSourcePosition(spans);
			if (Number.isInteger(position?.pageIndex)
					&& position.pageIndex >= 0
					&& position.pageIndex < pageCount
					&& (!position.nextPageRects
						|| position.pageIndex + 1 < pageCount)) {
				positionCache.set(cacheKey, position);
				return position;
			}
		}
		catch (e) {
			console.warn('Failed to map SDT reference to PDF position', e);
		}
	}
	let position = positionFromPageRects(
		getNodeByRef(structure, ref)?.anchor?.pageRects,
		pageCount
	);
	positionCache.set(cacheKey, position);
	return position;
}

function getTargetPosition(target, pages) {
	let pageIndex = target?.position?.pageIndex;
	if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
		return null;
	}
	let rect = target.position.rect;
	if (isFiniteRect(rect, false)) {
		return { pageIndex, rects: [rect.slice()] };
	}
	let viewRect = pages[pageIndex]?.viewRect;
	if (!isFiniteRect(viewRect)) {
		return null;
	}
	return {
		pageIndex,
		rects: [[viewRect[0], viewRect[3], viewRect[0], viewRect[3]]],
	};
}

async function projectOutline(
	items,
	structure,
	mapper,
	pages,
	positionCache,
	textEntryCache,
	control
) {
	let outline = [];
	for (let item of items || []) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		if (!item || typeof item.title !== 'string') {
			continue;
		}
		let projected = {
			title: item.title,
			items: await projectOutline(
				item.children,
				structure,
				mapper,
				pages,
				positionCache,
				textEntryCache,
				control
			),
		};
		if (item.source === 'native' || item.source === 'detected') {
			projected.source = item.source;
		}
		let url = getSafeURL(item.target?.url);
		let position = getTargetPosition(item.target, pages);
		if (!position && Array.isArray(item.ref)) {
			position = await getRefPosition(
				structure,
				mapper,
				item.ref,
				positionCache,
				textEntryCache,
				control
			);
		}
		if (position) {
			projected.location = { position };
		}
		else if (url) {
			projected.url = url;
		}
		outline.push(projected);
	}
	return outline;
}

async function getReferenceBlock(structure, ref, control) {
	let node = getNodeByRef(structure, ref);
	if (node?.reference) {
		return { node, ref };
	}
	for (let length = ref.length - 1; length > 0; length--) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		let ancestorRef = ref.slice(0, length);
		let ancestor = getNodeByRef(structure, ancestorRef);
		if (ancestor?.reference) {
			return { node: ancestor, ref: ancestorRef };
		}
	}
	return null;
}

async function getReferenceData(
	structure,
	mapper,
	ref,
	positionCache,
	referenceCache,
	textEntryCache,
	control
) {
	let cacheKey = refKey(ref);
	if (referenceCache.has(cacheKey)) {
		return referenceCache.get(cacheKey);
	}
	let reference = await getReferenceBlock(structure, ref, control);
	if (!reference) {
		referenceCache.set(cacheKey, null);
		return null;
	}
	let entries = await getTextEntriesForRef(
		structure,
		reference.ref,
		textEntryCache,
		control
	);
	let position = await getRefPosition(
		structure,
		mapper,
		reference.ref,
		positionCache,
		textEntryCache,
		control
	);
	if (!position || !entries.length) {
		referenceCache.set(cacheKey, null);
		return null;
	}
	let chars = [];
	let textParts = [];
	for (let entry of entries) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		textParts.push(entry.node.text);
		let url = getSafeURL(entry.node.target?.url);
		for (let i = 0; i < entry.node.text.length; i++) {
			if (i % 256 === 0) {
				let pending = control.checkpoint();
				if (pending) {
					await pending;
				}
			}
			chars.push({
				c: entry.node.text[i],
				...(entry.node.style?.bold && { bold: true }),
				...(entry.node.style?.italic && { italic: true }),
				...(url && { url }),
			});
		}
	}
	let text = textParts.join('');
	let data = { position, text, chars };
	referenceCache.set(cacheKey, data);
	return data;
}

async function getTextFlowRects(
	textEntries,
	pageCount,
	control,
	pageIndex
) {
	let rects = {};
	let seenByFlow = {};
	let addRect = (rectPageIndex, flowClass, rect) => {
		if (rectPageIndex !== pageIndex
				|| rectPageIndex < 0
				|| rectPageIndex >= pageCount
				|| !isFiniteRect(rect)) {
			return;
		}
		let seen = seenByFlow[flowClass] ??= new Set();
		let key = rectKey(rect);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		(rects[flowClass] ??= []).push(rect.slice());
	};
	for (let entry of textEntries) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		if (entry.flowClass === 'body') {
			continue;
		}
		if (typeof entry.node.anchor?.textMap === 'string') {
			try {
				for (let run of buildRunData(parseTextMap(entry.node.anchor.textMap))) {
					let pending = control.checkpoint();
					if (pending) {
						await pending;
					}
					addRect(run.pageIndex, entry.flowClass, run.rect);
				}
			}
			catch (e) {
				console.warn('Failed to decode SDT text-flow geometry', e);
			}
		}
	}
	return rects;
}

function addPageOverlay(
	overlays,
	overlay,
	position,
	pageCount,
	pageIndex
) {
	let pagePositions = [{
		pageIndex: position.pageIndex,
		rects: position.rects,
	}];
	if (Array.isArray(position.nextPageRects)) {
		pagePositions.push({
			pageIndex: position.pageIndex + 1,
			rects: position.nextPageRects,
		});
	}
	for (let pagePosition of pagePositions) {
		let rects = pagePosition.rects
			?.filter(rect => isFiniteRect(rect))
			.map(rect => rect.slice());
		if (!Number.isInteger(pagePosition.pageIndex)
				|| pagePosition.pageIndex < 0
				|| pagePosition.pageIndex >= pageCount
				|| pagePosition.pageIndex !== pageIndex
				|| !rects?.length) {
			continue;
		}
		overlays.push({
			...overlay,
			position: {
				pageIndex: pagePosition.pageIndex,
				rects,
			},
		});
	}
}

function valuesNearlyEqual(a, b) {
	return Number.isFinite(a)
		&& Number.isFinite(b)
		&& Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function hasKnownPageTransformDefaults(schemaVersion) {
	let match = /^(\d+)\.(\d+)(?:\.|$)/.exec(schemaVersion || '');
	return !!match && (
		Number(match[1]) > 1
		|| Number(match[1]) === 1 && Number(match[2]) >= 1
	);
}

function validateDocumentPages(pages, validation, schemaVersion) {
	if (!Array.isArray(validation?.pages)) {
		return;
	}
	let transformDefaultsKnown = hasKnownPageTransformDefaults(schemaVersion);
	for (let expected of validation.pages) {
		let actual = pages[expected.pageIndex];
		let rotationMatches = actual?.rotation !== undefined
			? actual.rotation === expected.rotation
			: !transformDefaultsKnown || expected.rotation === 0;
		let userUnitMatches = actual?.userUnit !== undefined
			? valuesNearlyEqual(actual.userUnit, expected.userUnit)
			: !transformDefaultsKnown || valuesNearlyEqual(1, expected.userUnit);
		if (!actual
				|| !isFiniteRect(actual.viewRect)
				|| !isFiniteRect(expected.viewRect)
				|| !actual.viewRect.every((value, index) => (
					valuesNearlyEqual(value, expected.viewRect[index])
				))
				|| !rotationMatches
				|| !userUnitMatches) {
			throw new Error('SDT page geometry does not match PDF');
		}
	}
}

export function validatePDFSDTDocument(structure, expectedDocument) {
	if (structure?.metadata?.processor?.type !== 'pdf') {
		throw new Error('Expected PDF SDT');
	}
	if (!Array.isArray(structure.content)
			|| !Array.isArray(structure.catalog?.pages)
			|| structure.catalog.pages.length !== expectedDocument?.pageCount) {
		throw new Error('SDT page count does not match PDF');
	}
	validateDocumentPages(
		structure.catalog.pages,
		expectedDocument,
		structure.schemaVersion
	);
}

async function projectPDFSDTPage(
	structure,
	mapper,
	pageIndex,
	textEntries,
	control
) {
	let expectedPageCount = structure.catalog.pages.length;
	if (typeof mapper?.textNodeSpansToSourcePosition !== 'function') {
		throw new Error('Invalid PDF SDT position mapper');
	}

	let pages = structure.catalog.pages;
	let overlays = [];
	let positionCache = new Map();
	let referenceCache = new Map();
	let textEntryCache = new Map();

	for (let entry of textEntries) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		let externalURL = getSafeURL(entry.node.target?.url);
		let hasSourceTarget = !!entry.node.target?.position;
		if (!externalURL
				&& !hasSourceTarget
				&& (!Array.isArray(entry.node.refs) || !entry.node.refs.length)) {
			continue;
		}
		let position = getTextEntryPosition(mapper, entry);
		if (!position
			|| !Number.isInteger(position.pageIndex)
			|| position.pageIndex < 0
			|| position.pageIndex >= expectedPageCount) {
			continue;
		}

		if (externalURL) {
			addPageOverlay(overlays, {
				type: 'external-link',
				source: 'sdt',
				url: externalURL,
			}, position, expectedPageCount, pageIndex);
			continue;
		}
		if (hasSourceTarget) {
			let destinationPosition = getTargetPosition(entry.node.target, pages);
			if (destinationPosition) {
				addPageOverlay(overlays, {
					type: 'internal-link',
					source: 'sdt',
					destinationPosition,
				}, position, expectedPageCount, pageIndex);
			}
			continue;
		}
		let references = [];
		for (let ref of entry.node.refs) {
			let reference = await getReferenceData(
				structure,
				mapper,
				ref,
				positionCache,
				referenceCache,
				textEntryCache,
				control
			);
			if (reference) {
				references.push(reference);
			}
		}
		if (references.length === entry.node.refs.length) {
			addPageOverlay(overlays, {
				type: 'citation',
				source: 'sdt',
				references,
			}, position, expectedPageCount, pageIndex);
			continue;
		}
		// Do not reinterpret a partially resolved citation as another link type.
		if (references.length) {
			continue;
		}

		let destinationPosition = null;
		for (let ref of entry.node.refs) {
			destinationPosition = await getRefPosition(
				structure,
				mapper,
				ref,
				positionCache,
				textEntryCache,
				control
			);
			if (destinationPosition) {
				break;
			}
		}
		if (destinationPosition) {
			addPageOverlay(overlays, {
				type: 'internal-link',
				source: 'matched',
				destinationPosition,
			}, position, expectedPageCount, pageIndex);
		}
	}

	let textFlowRects = await getTextFlowRects(
		textEntries,
		expectedPageCount,
		control,
		pageIndex
	);
	control.throwIfAborted();
	return { overlays, textFlowRects };
}

async function collectReferencedTopLevelBlocks(value, indexes, control) {
	let stack = [value];
	while (stack.length) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		let node = stack.pop();
		if (!node || typeof node !== 'object') {
			continue;
		}
		if (Array.isArray(node.refs)) {
			for (let ref of node.refs) {
				let pending = control.checkpoint();
				if (pending) {
					await pending;
				}
				if (Array.isArray(ref) && Number.isInteger(ref[0])) {
					indexes.add(ref[0]);
				}
			}
		}
		if (Array.isArray(node.ref) && Number.isInteger(node.ref[0])) {
			indexes.add(node.ref[0]);
		}
		for (let child of Array.isArray(node) ? node : Object.values(node)) {
			if (child && typeof child === 'object') {
				stack.push(child);
			}
		}
	}
}

async function createSparseStructure(
	reader,
	metadata,
	catalog,
	topLevelBlocks,
	referencedValues,
	control
) {
	let content = [];
	for (let { index, node } of topLevelBlocks) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		content[index] = node;
	}
	await loadReferencedBlocks(reader, content, referencedValues, control);
	return {
		schemaVersion: reader.header.schemaVersion,
		metadata,
		catalog,
		content,
	};
}

async function loadReferencedBlocks(reader, content, referencedValues, control) {
	let referencedIndexes = new Set();
	for (let value of referencedValues) {
		await collectReferencedTopLevelBlocks(value, referencedIndexes, control);
	}
	let indexesByChunk = new Map();
	let chunkStarts = reader.index.chunkBlockStarts;
	let blockCount = reader.getTopLevelBlockCount();
	for (let index of [...referencedIndexes].sort((a, b) => a - b)) {
		if (index < 0 || index >= blockCount || content[index]) {
			continue;
		}
		let chunkIndex = findChunkIndex(chunkStarts, index);
		if (chunkIndex < 0) {
			continue;
		}
		let indexes = indexesByChunk.get(chunkIndex) || [];
		indexes.push(index);
		indexesByChunk.set(chunkIndex, indexes);
	}
	for (let indexes of indexesByChunk.values()) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		let startIndex = indexes[0];
		let endIndex = indexes.at(-1);
		let blocks = await reader.getBlocks(startIndex, endIndex);
		control.throwIfAborted();
		for (let [offset, block] of blocks.entries()) {
			content[startIndex + offset] = block;
		}
	}
}

function isValidContentBoundary(content, boundary, topLevelBlockCount) {
	let topLevelIndex = boundary[0];
	if (topLevelIndex === topLevelBlockCount) {
		return boundary.length === 1;
	}
	if (topLevelIndex < 0 || topLevelIndex >= topLevelBlockCount) {
		return false;
	}
	if (boundary.length === 1) {
		return true;
	}
	let node = content[topLevelIndex];
	if (!node) {
		return false;
	}
	for (let depth = 1; depth < boundary.length; depth++) {
		let index = boundary[depth];
		if (typeof node.text === 'string') {
			return depth === boundary.length - 1 && index <= node.text.length;
		}
		let children = node.content;
		if (!Array.isArray(children) || index > children.length) {
			return false;
		}
		if (index === children.length) {
			return depth === boundary.length - 1;
		}
		node = children[index];
		if (!node) {
			return false;
		}
	}
	return true;
}

async function getPageProjectionRoots(
	structure,
	contentRange,
	topLevelBlockCount,
	control
) {
	let span = getContentRangeBlockSpan(contentRange, topLevelBlockCount);
	if (!span) {
		return [];
	}
	let [start, end] = contentRange;
	let roots = [];
	let stack = [];
	for (let index = span.endIndexExclusive - 1; index >= span.startIndex; index--) {
		stack.push({
			node: structure.content[index],
			ref: [index],
		});
	}
	let hasPrefix = (prefix, ref) => prefix.every(
		(value, index) => ref[index] === value
	);
	while (stack.length) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		let { node, ref } = stack.pop();
		if (!node || typeof node.text === 'string') {
			continue;
		}
		let subtreeEnd = [...ref];
		subtreeEnd[subtreeEnd.length - 1]++;
		if (compareRefs(subtreeEnd, start) <= 0 || compareRefs(ref, end) >= 0) {
			continue;
		}
		let children = Array.isArray(node.content) ? node.content : [];
		if (isLeafBlock(node)) {
			roots.push({
				node,
				ref,
				flowClass: structure.content[ref[0]]?.flowClass ?? 'body',
			});
			continue;
		}
		let firstChild = 0;
		let lastChildExclusive = children.length;
		if (start.length > ref.length && hasPrefix(ref, start)) {
			firstChild = Math.min(children.length, start[ref.length]);
		}
		if (end.length > ref.length && hasPrefix(ref, end)) {
			lastChildExclusive = Math.min(
				children.length,
				end[ref.length] + (end.length > ref.length + 1 ? 1 : 0)
			);
		}
		for (let index = lastChildExclusive - 1; index >= firstChild; index--) {
			let child = children[index];
			if (child && typeof child.text !== 'string') {
				stack.push({
					node: child,
					ref: [...ref, index],
				});
			}
		}
	}
	return roots;
}

async function textNodeTouchesPage(
	node,
	block,
	pageIndex,
	pageCount,
	control
) {
	if (typeof node?.anchor?.textMap === 'string') {
		try {
			let runs = buildRunData(parseTextMap(node.anchor.textMap));
			if (runs.length) {
				let hasRunGeometry = false;
				for (let run of runs) {
					let pending = control.checkpoint();
					if (pending) {
						await pending;
					}
					if (!Number.isInteger(run.pageIndex)
							|| run.pageIndex < 0
							|| run.pageIndex >= pageCount
							|| !isFiniteRect(run.rect)) {
						continue;
					}
					hasRunGeometry = true;
					if (run.pageIndex === pageIndex) {
						return true;
					}
				}
				if (hasRunGeometry) {
					return false;
				}
			}
		}
		catch (_) {
			// Fall through to page rectangles.
		}
	}
	let pageRects = node?.anchor?.pageRects;
	if (!Array.isArray(pageRects) || !pageRects.length) {
		pageRects = block?.anchor?.pageRects;
	}
	return pageRects?.some(pageRect => pageRect?.[0] === pageIndex) ?? false;
}

async function getPageReferencedValues(
	textEntries,
	pageIndex,
	pageCount,
	control
) {
	let values = [];
	for (let { node, block } of textEntries) {
		let pending = control.checkpoint();
		if (pending) {
			await pending;
		}
		if (Array.isArray(node.refs)
				&& node.refs.length
				&& await textNodeTouchesPage(
					node,
					block,
					pageIndex,
					pageCount,
					control
				)) {
			values.push(node);
		}
	}
	return values;
}

function getCatalogRefPosition(ref, pages, pageSpans) {
	if (!Array.isArray(ref) || !Number.isInteger(ref[0])) {
		return null;
	}
	let low = 0;
	let high = pageSpans.length - 1;
	let candidate = -1;
	while (low <= high) {
		let middle = (low + high) >> 1;
		if ((pageSpans[middle]?.startIndex ?? Infinity) <= ref[0]) {
			candidate = middle;
			low = middle + 1;
		}
		else {
			high = middle - 1;
		}
	}
	while (candidate > 0
			&& (pageSpans[candidate - 1]?.endIndexExclusive ?? 0) > ref[0]) {
		candidate--;
	}
	for (let spanIndex = Math.max(0, candidate); spanIndex < pageSpans.length; spanIndex++) {
		let span = pageSpans[spanIndex];
		if (span.startIndex > ref[0]) {
			break;
		}
		let contentRange = pages[span.pageIndex]?.contentRange;
		if (ref[0] < span.endIndexExclusive
				&& compareRefs(ref, contentRange[0]) >= 0
				&& compareRefs(ref, contentRange[1]) < 0) {
			return getTargetPosition(
				{ position: { pageIndex: span.pageIndex } },
				pages
			);
		}
	}
	return null;
}

function projectCatalogOutline(items, pages, pageSpans) {
	let outline = [];
	for (let item of items || []) {
		if (!item || typeof item.title !== 'string') {
			continue;
		}
		let projected = {
			title: item.title,
			items: projectCatalogOutline(
				item.children,
				pages,
				pageSpans
			),
		};
		if (item.source === 'native' || item.source === 'detected') {
			projected.source = item.source;
		}
		let url = getSafeURL(item.target?.url);
		let position = getTargetPosition(item.target, pages)
			|| getCatalogRefPosition(item.ref, pages, pageSpans);
		if (position) {
			projected.location = { position };
		}
		else if (url) {
			projected.url = url;
		}
		outline.push(projected);
	}
	return outline;
}

/**
 * A validated PDF SDT catalog whose content chunks remain compressed until a
 * rendered page actually needs them.
 */
export class LazyPDFSDTDocument {
	static async open(reader, expectedDocument, options = {}) {
		let control = createProjectionControl(options);
		let createMapper = options.createMapper;
		if (typeof createMapper !== 'function') {
			throw new Error('PDF SDT position mapper factory is required');
		}
		control.throwIfAborted();
		let [metadata, catalog] = await Promise.all([
			reader.getMetadata(),
			reader.getCatalog(),
		]);
		control.throwIfAborted();
		let pages = catalog?.pages;
		if (metadata?.processor?.type !== 'pdf') {
			throw new Error('Expected PDF SDT');
		}
		if (!Array.isArray(pages)
				|| pages.length !== expectedDocument?.pageCount) {
			throw new Error('SDT page count does not match PDF');
		}
		validateDocumentPages(
			pages,
			expectedDocument,
			reader.header.schemaVersion
		);
		let pageLabels = pages.map((page, index) => (
			typeof page.label === 'string' && page.label
				? page.label
				: String(index + 1)
		));
		let pageSpans = pages.flatMap((page, pageIndex) => {
			let span = getContentRangeBlockSpan(
				page?.contentRange,
				reader.getTopLevelBlockCount()
			);
			return span ? [{ ...span, pageIndex }] : [];
		});
		let outline = projectCatalogOutline(
			catalog.outline,
			pages,
			pageSpans
		);
		return new LazyPDFSDTDocument(
			reader,
			metadata,
			catalog,
			pageLabels,
			outline,
			createMapper,
			{
				yieldControl: options.yieldControl,
				yieldAfter: options.yieldAfter,
				maxWorkMs: options.maxWorkMs,
			}
		);
	}

	constructor(
		reader,
		metadata,
		catalog,
		pageLabels,
		outline,
		createMapper,
		projectionOptions
	) {
		this._reader = reader;
		this._metadata = metadata;
		this._catalog = catalog;
		this._createMapper = createMapper;
		this._projectionOptions = projectionOptions;
		this.pageCount = catalog.pages.length;
		this.pageLabels = pageLabels;
		this.outline = outline;
		this._resolvedOutlinePromise = null;
		this._resolvedOutlineSignal = null;
	}

	_validatePage(expectedDocument) {
		if (expectedDocument?.pageCount !== this.pageCount) {
			throw new Error('SDT page does not match PDF view');
		}
		validateDocumentPages(
			this._catalog.pages,
			expectedDocument,
			this._reader.header.schemaVersion
		);
	}

	resolveOutline(options = {}) {
		if (!this._resolvedOutlinePromise
				|| this._resolvedOutlineSignal?.aborted) {
			let promise = (async () => {
				let control = createProjectionControl(options);
				let structure = await createSparseStructure(
					this._reader,
					this._metadata,
					this._catalog,
					[],
					[this._catalog.outline],
					control
				);
				let outline = await projectOutline(
					this._catalog.outline,
					structure,
					this._createMapper(structure),
					this._catalog.pages,
					new Map(),
					new Map(),
					control
				);
				this.outline = outline;
				if (this._resolvedOutlinePromise === promise) {
					this._resolvedOutlineSignal = null;
				}
				return outline;
			})().catch((error) => {
				if (this._resolvedOutlinePromise === promise) {
					this._resolvedOutlinePromise = null;
					this._resolvedOutlineSignal = null;
				}
				throw error;
			});
			this._resolvedOutlinePromise = promise;
			this._resolvedOutlineSignal = options.signal || null;
		}
		return this._resolvedOutlinePromise;
	}

	async projectPage(pageIndex, expectedDocument, options = {}) {
		let projectionOptions = {
			...this._projectionOptions,
			...options,
		};
		let control = createProjectionControl(projectionOptions);
		control.throwIfAborted();
		if (!Number.isInteger(pageIndex)
				|| pageIndex < 0
				|| pageIndex >= this.pageCount) {
			throw new Error('SDT page does not match PDF view');
		}
		this._validatePage(expectedDocument);
		let contentRange = this._catalog.pages[pageIndex]?.contentRange;
		let topLevelBlockCount = this._reader.getTopLevelBlockCount();
		if (compareRefs(contentRange?.[0] || [], contentRange?.[1] || []) > 0) {
			throw new Error('Invalid SDT page content range');
		}
		let span = getContentRangeBlockSpan(
			contentRange,
			topLevelBlockCount
		);
		if (!span) {
			throw new Error('Invalid SDT page content range');
		}
		let topLevelBlocks = [];
		let blockReadStart = span.startIndex;
		let blockReadEnd = span.endIndexExclusive - 1;
		if (span.startIndex === span.endIndexExclusive
				&& contentRange[0].length > 1
				&& span.startIndex < topLevelBlockCount) {
			blockReadEnd = blockReadStart;
		}
		if (blockReadStart <= blockReadEnd) {
			let blocks = await this._reader.getBlocks(
				blockReadStart,
				blockReadEnd
			);
			control.throwIfAborted();
			topLevelBlocks = blocks.map((node, offset) => ({
				index: blockReadStart + offset,
				node,
			}));
		}
		let structure = await createSparseStructure(
			this._reader,
			this._metadata,
			this._catalog,
			topLevelBlocks,
			[],
			control
		);
		if (!isValidContentBoundary(
			structure.content,
			contentRange[0],
			topLevelBlockCount
		) || !isValidContentBoundary(
			structure.content,
			contentRange[1],
			topLevelBlockCount
		)) {
			throw new Error('Invalid SDT page content range');
		}
		let roots = await getPageProjectionRoots(
			structure,
			contentRange,
			topLevelBlockCount,
			control
		);
		let textEntries = await collectSemanticTextEntries(roots, control);
		await loadReferencedBlocks(
			this._reader,
			structure.content,
			await getPageReferencedValues(
				textEntries,
				pageIndex,
				this.pageCount,
				control
			),
			control
		);
		let page = await projectPDFSDTPage(
			structure,
			this._createMapper(structure),
			pageIndex,
			textEntries,
			control
		);
		return {
			pageIndex,
			...page,
		};
	}
}

/**
 * Keep native PDF links as a fail-open fallback alongside semantic links.
 */
export function composePDFPageOverlays(fallbackOverlays, semanticOverlays) {
	fallbackOverlays = Array.isArray(fallbackOverlays) ? fallbackOverlays : [];
	semanticOverlays = Array.isArray(semanticOverlays) ? semanticOverlays : [];
	return [
		...semanticOverlays,
		...fallbackOverlays,
	];
}

function rectsOverlap(rectA, rectB) {
	return Math.min(rectA[2], rectB[2]) > Math.max(rectA[0], rectB[0])
		&& Math.min(rectA[3], rectB[3]) > Math.max(rectA[1], rectB[1]);
}

const flowRectIndexCache = new WeakMap();

function buildRectIndex(rects) {
	if (!rects.length) {
		return null;
	}
	let bounds = [Infinity, Infinity, -Infinity, -Infinity];
	let centerBounds = [Infinity, Infinity, -Infinity, -Infinity];
	for (let rect of rects) {
		let centerX = rect[0] + rect[2];
		let centerY = rect[1] + rect[3];
		bounds[0] = Math.min(bounds[0], rect[0]);
		bounds[1] = Math.min(bounds[1], rect[1]);
		bounds[2] = Math.max(bounds[2], rect[2]);
		bounds[3] = Math.max(bounds[3], rect[3]);
		centerBounds[0] = Math.min(centerBounds[0], centerX);
		centerBounds[1] = Math.min(centerBounds[1], centerY);
		centerBounds[2] = Math.max(centerBounds[2], centerX);
		centerBounds[3] = Math.max(centerBounds[3], centerY);
	}
	if (rects.length <= 8) {
		return { bounds, rects };
	}
	let xSpread = centerBounds[2] - centerBounds[0];
	let ySpread = centerBounds[3] - centerBounds[1];
	let axis = xSpread >= ySpread ? 0 : 1;
	let sorted = [...rects].sort((a, b) => (
		(a[axis] + a[axis + 2]) - (b[axis] + b[axis + 2])
	));
	let middle = sorted.length >> 1;
	return {
		bounds,
		left: buildRectIndex(sorted.slice(0, middle)),
		right: buildRectIndex(sorted.slice(middle)),
	};
}

function rectIndexOverlaps(index, rect) {
	if (!index || !rectsOverlap(index.bounds, rect)) {
		return false;
	}
	if (index.rects) {
		return index.rects.some(candidate => rectsOverlap(candidate, rect));
	}
	return rectIndexOverlaps(index.left, rect)
		|| rectIndexOverlaps(index.right, rect);
}

function getFlowRectIndexes(flowRects) {
	let cached = flowRectIndexCache.get(flowRects);
	if (cached) {
		return cached;
	}
	let indexes = Object.entries(flowRects)
		.map(([flowClass, rects]) => [
			flowClass,
			buildRectIndex(
				Array.isArray(rects)
					? rects.filter(rect => isFiniteRect(rect))
					: []
			),
		])
		.filter(([, index]) => index);
	flowRectIndexCache.set(flowRects, indexes);
	return indexes;
}

export function applyTextFlowClasses(chars, flowRects) {
	if (!Array.isArray(chars) || !flowRects || typeof flowRects !== 'object') {
		return Array.isArray(chars) ? chars : [];
	}
	let flowRectIndexes = getFlowRectIndexes(flowRects);
	return chars.map((char) => {
		let flowClass = isFiniteRect(char?.rect)
			? flowRectIndexes.find(([, index]) => (
				rectIndexOverlaps(index, char.rect)
			))?.[0]
			: undefined;
		if (char.flowClass === flowClass) {
			return char;
		}
		if (flowClass) {
			return { ...char, flowClass };
		}
		let clone = { ...char };
		delete clone.flowClass;
		return clone;
	});
}
