import { approximateMatch } from './lib/approximate-match';
import { ANNOTATION_POSITION_MAX_SIZE } from './defines';
import { basicDeepEqual, sortTags } from './lib/utilities';
import { isSelector } from "../dom/common/lib/selector";
import { roundPositionValues } from '../pdf/lib/utilities';

const DEBOUNCE_TIME = 1000; // 1s
const DEBOUNCE_MAX_TIME = 10000; // 10s

class AnnotationManager {
	constructor(options) {
		this._filter = {
			query: '',
			colors: [],
			tags: [],
			authors: [],
			hiddenIDs: [],
		};
		this._readOnly = options.readOnly;
		this._authorName = options.authorName;
		this._annotations = options.annotations;
		this._onChangeFilter = options.onChangeFilter;
		this._onSave = options.onSave;
		this._onDelete = options.onDelete;
		this._adjustTextAnnotationPosition = options.adjustTextAnnotationPosition;
		this.render = () => {
			options.onRender([...this._annotations]);
		};

		this._unsavedAnnotations = new Map();
		this._highVolatilityAnnotationIDs = new Set();

		this._lastChangeTime = 0;
		this._lastSaveTime = 0;

		this._undoStack = [];
		this._redoStack = [];

		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));

		// Necessary to set reader._state.annotation for the first time
		this.render();
		this._onChangeFilter(this._filter);
	}

	setReadOnly(readOnly) {
		this._readOnly = readOnly;
	}

	// Called when changes come from the client side
	async setAnnotations(annotations) {
		for (let annotation of annotations) {
			this._annotations = this._annotations.filter(x => x.id !== annotation.id);
			this._annotations.push(annotation);
		}
		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
		this._clearInterferingHistory(annotations.map(x => x.id));
		this.render();
	}

	// Called when deletions come from the client side
	unsetAnnotations(ids) {
		this._annotations = this._annotations.filter(x => !ids.includes(x.id));
		this.render();
	}

	addAnnotation(annotation) {
		if (this._readOnly) {
			return null;
		}
		// Mandatory properties
		let { color, sortIndex } = annotation;
		if (!color) {
			throw new Error(`Missing 'color' property`);
		}
		if (!sortIndex) {
			throw new Error(`Missing 'sortIndex' property`);
		}

		// Optional properties
		annotation.pageLabel = annotation.pageLabel || '';
		annotation.text = annotation.text || '';
		annotation.comment = annotation.comment || '';
		annotation.tags = annotation.tags || [];
		// Automatically set properties
		annotation.id = this._generateObjectKey();
		annotation.dateCreated = (new Date()).toISOString();
		annotation.dateModified = annotation.dateCreated;
		annotation.authorName = this._authorName;
		if (this._authorName) {
			annotation.isAuthorNameAuthoritative = true;
		}

		annotation.position = roundPositionValues(annotation.position);

		let changedAnnotations = new Map([[annotation.id, annotation]]);
		this._applyChanges(changedAnnotations);
		return annotation;
	}

	updateAnnotations(annotations) {
		let changedAnnotations = new Map();
		// Validate data
		for (let annotation of annotations) {
			if (annotation.position && !annotation.sortIndex) {
				throw new Error(`If updating 'position', 'sortIndex' has to be provided as well`);
			}
			let existingAnnotation = this._getAnnotationByID(annotation.id);
			if (existingAnnotation.readOnly && !(annotation.image && Object.keys(annotation).length === 2)) {
				throw new Error('Cannot update read-only annotation');
			}
			// To save image it should have only id and image properties
			if (this._readOnly && !(annotation.image && Object.keys(annotation).length === 2)) {
				throw new Error('Cannot update annotations for read-only file');
			}

			// A special case for for annotation image updating
			if (annotation.image) {
				if (annotations.length > 1) {
					throw new Error('Only one image can be updated at the time');
				}
				if (Object.keys(annotation).length !== 2) {
					throw new Error('Only image property can be updated at the time');
				}
				this._applyImageChange(annotation.id, annotation.image);
				return;
			}
		}

		for (let annotation of annotations) {
			if (Object.keys(annotation).length === 2 && (annotation.text || annotation.comment)) {
				this._highVolatilityAnnotationIDs.add(annotation.id);
			}
			let existingAnnotation = this._getAnnotationByID(annotation.id);
			if (annotation.position || annotation.color) {
				annotation.image = undefined;
			}

			if (existingAnnotation.position && isSelector(existingAnnotation.position)) {
				// EPUB/Snapshot: Just merge top-level properties
				annotation = {
					...existingAnnotation,
					...annotation,
				};
			}
			else {
				// PDF: All properties in the existing annotation position are preserved except nextPageRects,
				// which isn't preserved only when a new rects property is given
				let deleteNextPageRects = annotation.position?.rects && !annotation.position?.nextPageRects;
				annotation = {
					...existingAnnotation,
					...annotation,
					position: { ...existingAnnotation.position, ...annotation.position }
				};
				if (!annotation.image) {
					delete annotation.image;
				}
				if (deleteNextPageRects) {
					delete annotation.position.nextPageRects;
				}

				// Updating annotation position when editing comment
				if (annotation.type === 'text' && existingAnnotation.comment !== annotation.comment) {
					annotation.position = this._adjustTextAnnotationPosition(annotation, { adjustSingleLineWidth: true, enableSingleLineMaxWidth: true });
				}
			}

			annotation.dateModified = (new Date()).toISOString();
			annotation.position = roundPositionValues(annotation.position);
			changedAnnotations.set(annotation.id, annotation);
		}
		this._applyChanges(changedAnnotations);
		this.render();
	}

	deleteAnnotations(ids) {
		let someExternal = this._annotations.some(
			annotation => ids.includes(annotation.id) && annotation.isExternal
		);
		// Don't delete anything if the PDF file is read-only, or at least one provided annotation is external
		if (!ids.length || this._readOnly || someExternal) {
			return 0;
		}
		let changedAnnotations = new Map(ids.map(id => [id, null]));
		this._applyChanges(changedAnnotations);
		return changedAnnotations.size;
	}

	convertAnnotations(ids, type) {
		let changedAnnotations = new Map();
		let annotations = [];
		for (let id of ids) {
			let annotation = this._getAnnotationByID(id);
			if (annotation) {
				if (!['highlight', 'underline'].includes(annotation.type)) {
					throw new Error('Only highlight ↔ underline conversion is supported');
				}
				if (annotation.type === type) {
					continue;
				}
				annotations.push(annotation);
			}
		}
		for (let annotation of annotations) {
			let dateModified = (new Date()).toISOString();
			// Delete existing
			changedAnnotations.set(annotation.id, null);
			// Create a new annotation with different type
			annotation = { ...annotation, type, dateModified, id: this._generateObjectKey() };
			changedAnnotations.set(annotation.id, annotation);
		}
		this._applyChanges(changedAnnotations);
	}

	mergeAnnotations(ids) {
		let annotations = [];
		for (let id of ids) {
			let annotation = this._getAnnotationByID(id);
			if (annotation) {
				if (annotation.type !== 'ink') {
					throw new Error('Only ink annotations can be merged');
				}
				if (annotation.readOnly) {
					throw new Error('Cannot update read-only annotation');
				}
				if (this._readOnly) {
					throw new Error('Cannot update annotations for read-only file');
				}
			}
			annotations.push(annotation);
		}
		if (annotations.length < 2) {
			throw new Error('At least two annotations must be provided');
		}
		if (new Set(annotations.map(x => x.color)).size !== 1) {
			throw new Error('Annotations must have the same color');
		}
		if (new Set(annotations.map(x => x.position.pageIndex)).size !== 1) {
			throw new Error('Annotations must be in the same page');
		}

		let { color, pageLabel } = annotations[0];

		// Create a new annotation
		let annotation = { type: 'ink', color, pageLabel };

		if (this._authorName) {
			annotation.authorName = this._authorName;
			annotation.isAuthorNameAuthoritative = true;
		}

		annotation.id = this._generateObjectKey();
		// Page index closest to the beginning of the page
		annotation.sortIndex = annotations.sort((a, b) => a.sortIndex - b.sortIndex)[0].sortIndex;
		// Oldest creation date
		annotation.dateCreated = annotations.sort((a, b) => a.dateCreated - b.dateCreated)[0].dateCreated;
		annotation.dateModified = (new Date()).toISOString();
		// Combine and deduplicate tags from all annotations
		annotation.tags = [];
		for (let existingAnnotation of annotations) {
			for (let tag of existingAnnotation.tags) {
				if (!annotation.tags.find(x => x.name === tag.name)) {
					annotation.tags.push({ ...tag });
				}
			}
		}
		sortTags(annotation.tags);

		// Get the most common width
		let widthMap = new Map();
		for (let annotation of annotations) {
			let { width, paths } = annotation.position;
			let num = widthMap.get(width) || 0;
			num += paths.flat().length;
			widthMap.set(width, num);
		}
		let width = [...widthMap.entries()].sort((a, b) => b[1] - a[1])[0][0];

		annotation.position = {
			// Preserve pageIndex and potentially other unknown properties
			...annotations[0].position,
			width,
			paths: annotations.flatMap(x => x.position.paths)
		};

		if (JSON.stringify(annotation.position).length > ANNOTATION_POSITION_MAX_SIZE) {
			throw new Error(`Merged annotation 'position' exceeds ${ANNOTATION_POSITION_MAX_SIZE}`);
		}

		let changedAnnotations = new Map(annotations.map(x => [x.id, null]));
		changedAnnotations.set(annotation.id, annotation);
		this._applyChanges(changedAnnotations);

		return annotation;
	}

	// Note: Keep in sync with Zotero client
	_generateObjectKey() {
		let len = 8;
		let allowedKeyChars = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';

		var randomstring = '';
		for (var i = 0; i < len; i++) {
			var rnum = Math.floor(Math.random() * allowedKeyChars.length);
			randomstring += allowedKeyChars.substring(rnum, rnum + 1);
		}
		return randomstring;
	}

	_applyChanges(changedAnnotations) {
		if (!changedAnnotations.size) {
			return;
		}
		this._lastChangeTime = Date.now();
		let annotations = new Map(this._annotations.map(x => [x.id, x]));
		for (let [id, changedAnnotation] of changedAnnotations) {
			changedAnnotation = changedAnnotation && { ...changedAnnotation };
			if (changedAnnotation && !this._unsavedAnnotations.get(id)?.image) {
				delete changedAnnotation.image;
			}
			this._unsavedAnnotations.set(id, changedAnnotation);
		}
		this._historySave(changedAnnotations);
		annotations = new Map([...annotations, ...changedAnnotations]);
		this._annotations = [...annotations.values()].filter(x => x);
		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
		this._triggerSaving();
		this.render();
	}

	_applyImageChange(id, image) {
		this._lastChangeTime = Date.now();
		let idx = this._annotations.findIndex(x => x.id === id);
		if (idx === -1) {
			return;
		}
		let annotation = this._annotations[idx];
		annotation = { ...annotation, image };
		this._annotations.splice(idx, 1, annotation);
		this._unsavedAnnotations.set(id, annotation);
		this._triggerSaving();
		this.render();
	}

	async _triggerSaving() {
		if (!this._unsavedAnnotations.size || this._savingInProgress) {
			return;
		}
		if ((Date.now() - this._lastChangeTime < DEBOUNCE_TIME)
			&& (Date.now() - this._lastSaveTime < DEBOUNCE_MAX_TIME)
			&& !this._skipAnnotationSavingDebounce) {
			setTimeout(this._triggerSaving.bind(this), 1000);
			return;
		}
		this._lastSaveTime = Date.now();
		this._savingInProgress = true;

		let saveAnnotations = [];
		let deleteAnnotationIDs = [];
		for (let [id, annotation] of this._unsavedAnnotations) {
			if (annotation) {
				saveAnnotations.push(annotation);
			}
			else {
				deleteAnnotationIDs.push(id);
			}
		}

		this._unsavedAnnotations.clear();

		this._onDelete(deleteAnnotationIDs);

		let clonedAnnotations = saveAnnotations.map(x => JSON.parse(JSON.stringify(x)));
		for (let clonedAnnotation of clonedAnnotations) {
			if (this._highVolatilityAnnotationIDs.has(clonedAnnotation.id)) {
				clonedAnnotation.onlyTextOrComment = true;
			}
		}
		this._highVolatilityAnnotationIDs.clear();
		await this._onSave(clonedAnnotations);
		this._savingInProgress = false;
		this._triggerSaving();
	}

	_getAnnotationByID(id) {
		return this._annotations.find(annotation => annotation.id === id);
	}

	async setFilter(filter) {
		this._filter = { ...this._filter, ...filter };
		this._onChangeFilter(this._filter);
		this._annotations.forEach(x => x._hidden = true);
		this._annotations.forEach(x => delete x._score);

		let annotations = this._annotations.slice();
		let { tags, colors, authors, query, hiddenIDs } = this._filter;

		if (hiddenIDs.length) {
			annotations = annotations.filter(x => !hiddenIDs.includes(x.id));
		}

		if (tags.length || colors.length || authors.length) {
			annotations = annotations.filter(x => {
				const matchesTags = tags.length === 0 || x.tags.some(t => tags.includes(t.name));
				const matchesColors = colors.length === 0 || colors.includes(x.color);
				const matchesAuthors = authors.length === 0 || authors.includes(x.authorName);
				return matchesTags && matchesColors && matchesAuthors;
			});
		}

		if (query) {
			annotations = annotations.slice();
			query = query.toLowerCase();
			let results = [];
			for (let annotation of annotations) {
				let errors = null;
				let match = null;

				if (annotation.text) {
					match = approximateMatch(annotation.text.toLowerCase(), query, Math.floor(query.length / 5));
					if (match.length) {
						errors = Math.min(...match.map(x => x.errors));
					}
				}

				if (annotation.comment) {
					match = approximateMatch(annotation.comment.toLowerCase(), query, Math.floor(query.length / 5));
					if (match.length) {
						let er = Math.min(...match.map(x => x.errors));
						if (errors !== null) {
							errors = Math.min(errors, er);
						}
						else {
							errors = er;
						}
					}
				}

				if (errors !== null) {
					results.push({
						errors,
						annotation
					});
				}
			}

			let maxErrors = Math.max(...results.map(x => x.errors), 0);
			results.forEach(result => (result.annotation._score = maxErrors - result.errors));
			annotations = results.map(x => x.annotation);
		}
		annotations.forEach(x => delete x._hidden);
		this.render();
	}

	_historySave(changedAnnotations) {
		if (!changedAnnotations.size) {
			return;
		}

		let annotations = new Map(this._annotations.map(x => [x.id, x]));

		let oldAnnotations = new Map();
		for (let [id, changedAnnotation] of changedAnnotations) {
			let existingAnnotation = annotations.get(id);
			oldAnnotations.set(id, existingAnnotation);
		}

		let point = this._undoStack[this._undoStack.length - 1];
		let prevPoint = this._undoStack[this._undoStack.length - 2];

		let disableJoin = true;
		let disableTextualJoin = true;
		if (
			prevPoint && point
			&& prevPoint.size === 1 && point.size === 1 && oldAnnotations.size === 1
		) {
			let [id1, annotation1] = [...prevPoint][0];
			let [id2, annotation2] = [...point][0];
			let [id3, annotation3] = [...oldAnnotations][0];
			if (id1 === id2 && id2 === id3) {
				disableJoin = false;
			}
			let a = { ...annotation2 };
			let b = { ...annotation3 };
			delete a.text;
			delete b.text;
			delete a.comment;
			delete b.comment;
			delete a.dateModified;
			delete b.dateModified;
			delete a.image;
			delete b.image;
			if (basicDeepEqual(a, b)) {
				disableTextualJoin = false;
			}
		}

		if (!point || disableJoin || Date.now() - this._lastChange > 500 && disableTextualJoin) {
			point = new Map();
			this._undoStack.push(point);
		}
		for (let [id, annotation] of oldAnnotations) {
			if (annotation) {
				annotation = JSON.parse(JSON.stringify(annotation));
				delete annotation.image;
			}
			point.set(id, annotation);
		}

		this._lastChange = Date.now();
		this._redoStack = [];
	}

	remapHistory(mapping) {
		for (let [oldID, newID] of mapping) {
			for (let point of this._undoStack) {
				if (point.has(oldID)) {
					let annotation = point.get(oldID);
					if (annotation) {
						annotation.id = newID;
					}
					point.delete(oldID);
					point.set(newID, annotation);
				}
			}

			for (let point of this._redoStack) {
				if (point.has(oldID)) {
					let annotation = point.get(oldID);
					if (annotation) {
						annotation.id = newID;
					}
					point.delete(oldID);
					point.set(newID, annotation);
				}
			}
		}
	}

	undo() {
		let undoPoint = this._undoStack.pop();
		if (!undoPoint) {
			return false;
		}
		let mapping = new Map();
		let redoPoint = new Map();
		let allAnnotations = new Map(this._annotations.map(x => [x.id, x]));
		for (let [id, annotation] of undoPoint) {
			annotation = annotation && { ...annotation };
			let prevAnnotation = allAnnotations.get(id);
			redoPoint.set(id, prevAnnotation);
			if (annotation) {
				annotation.dateModified = (new Date()).toISOString();
			}
			// Assign new id when undeleting to reduce sync conflicts
			if (!prevAnnotation) {
				let newID = this._generateObjectKey();
				mapping.set(annotation.id, newID);
				annotation.id = newID;
			}
			allAnnotations.set(id, annotation);
			this._unsavedAnnotations.set(id, annotation);
		}
		this._redoStack.push(redoPoint);
		this.remapHistory(mapping);
		this._annotations = [...allAnnotations.values()].filter(x => x);
		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
		this._triggerSaving();
		this.render();
		return true;
	}

	redo() {
		let redoPoint = this._redoStack.pop();
		if (!redoPoint) {
			return false;
		}
		let mapping = new Map();
		let undoPoint = new Map();
		let allAnnotations = new Map(this._annotations.map(x => [x.id, x]));
		for (let [id, annotation] of redoPoint) {
			annotation = annotation && { ...annotation };
			let prevAnnotation = allAnnotations.get(id);
			undoPoint.set(id, prevAnnotation);
			if (annotation) {
				annotation.dateModified = (new Date()).toISOString();
			}
			// Assign new id when undeleting to reduce sync conflicts
			if (!prevAnnotation) {
				let newID = this._generateObjectKey();
				mapping.set(annotation.id, newID);
				annotation.id = newID;
			}
			allAnnotations.set(id, annotation);
			this._unsavedAnnotations.set(id, annotation);
		}
		this._undoStack.push(undoPoint);
		this.remapHistory(mapping);
		this._annotations = [...allAnnotations.values()].filter(x => x);
		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
		this._triggerSaving();
		this.render();
		return true;
	}

	_clearInterferingHistory(affectedAnnotationIDs) {
		for (let i = this._undoStack.length - 1; i >= 0; i--) {
			if (affectedAnnotationIDs.some(id => this._undoStack[i].has(id))) {
				this._undoStack = this._undoStack.slice(i + 1);
				break;
			}
		}
		for (let i = 0; i < this._redoStack.length; i++) {
			if (affectedAnnotationIDs.some(id => this._redoStack[i].has(id))) {
				this._redoStack = this._redoStack.slice(0, Math.max(0, i - 1));
				break;
			}
		}
	}
}

export default AnnotationManager;
