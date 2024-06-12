import { approximateMatch } from './lib/approximate-match';
import { measureTextAnnotationDimensions } from '../pdf/lib/text-annotation';

const DEBOUNCE_TIME = 1000; // 1s
const DEBOUNCE_MAX_TIME = 10000; // 10s

class AnnotationManager {
	constructor(options) {
		this._filter = {
			query: '',
			colors: [],
			tags: [],
			authors: []
		};
		this._readOnly = options.readOnly;
		this._authorName = options.authorName;
		this._annotations = options.annotations;
		this._onChangeFilter = options.onChangeFilter;
		this._onSave = options.onSave;
		this._onDelete = options.onDelete;
		this.render = () => {
			options.onRender([...this._annotations]);
		};

		this._unsavedAnnotations = new Map();
		this._lastChangeTime = 0;
		this._lastSaveTime = 0;

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
		this.render();
	}

	// Called when deletions come from the client side
	unsetAnnotations(ids) {
		this._annotations = this._annotations.filter(x => !ids.includes(x.id));
		this.render();
	}

	//
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
		// Ensure numbers have 3 or less decimal places
		if (annotation.position.rects) {
			annotation.position.rects = annotation.position.rects.map(
				rect => rect.map(value => parseFloat(value.toFixed(3)))
			);
		}
		this._save(annotation, !!annotation?.image);
		this.render();
		return annotation;
	}

	updateAnnotations(annotations) {
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
		}
		for (let annotation of annotations) {
			let existingAnnotation = this._getAnnotationByID(annotation.id);
			if (!annotation.onlyTextOrComment) {
				delete existingAnnotation.onlyTextOrComment;
			}
			let includeImage = !!annotation.image;
			// If only updating an image skip the code below together with dateModified updating
			if (annotation.image && Object.keys(annotation).length === 2) {
				let { image } = annotation;
				this._save({ ...existingAnnotation, image }, includeImage);
				continue;
			}
			if (annotation.position) {
				annotation.image = undefined;
			}
			// All properties in the existing annotation position are preserved except nextPageRects,
			// which isn't preserved only when a new rects property is given
			let deleteNextPageRects = annotation.rects && !annotation.position?.nextPageRects;
			annotation = {
				...existingAnnotation,
				...annotation,
				position: { ...existingAnnotation.position, ...annotation.position }
			};
			if (deleteNextPageRects) {
				delete annotation.position.nextPageRects;
			}

			// Updating annotation position when editing comment
			if (annotation.type === 'text' && existingAnnotation.comment !== annotation.comment) {
				annotation.position = measureTextAnnotationDimensions(annotation, { adjustSingleLineWidth: true, enableSingleLineMaxWidth: true });
			}

			annotation.dateModified = (new Date()).toISOString();
			if (annotation.rects) {
				annotation.position.rects = annotation.position.rects.map(
					rect => rect.map(value => parseFloat(value.toFixed(3)))
				);
			}
			this._save(annotation, includeImage);
		}
		this.render();
	}

	deleteAnnotations(ids) {
		let someExternal = this._annotations.some(
			annotation => ids.includes(annotation.id) && annotation.isExternal
		);
		// Don't delete anything if the PDF file is read-only, or at least one provided annotation is external
		if (!ids.length || this._readOnly || someExternal) {
			return;
		}
		this._annotations = this._annotations.filter(annotation => !ids.includes(annotation.id));
		for (let id of ids) {
			this._unsavedAnnotations.delete(id);
		}
		this._onDelete(ids);
		this.render();
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

	_save(annotation, includeImage) {
		this._lastChangeTime = Date.now();
		let oldIndex = this._annotations.findIndex(x => x.id === annotation.id);
		if (oldIndex !== -1) {
			annotation = { ...annotation };
			this._annotations.splice(oldIndex, 1, annotation);
		}
		else {
			this._annotations.push(annotation);
		}
		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
		annotation = { ...annotation };

		let existingUnsavedAnnotation = this._unsavedAnnotations.get(annotation.id);
		if (existingUnsavedAnnotation?.image) {
			includeImage = true;
		}
		if (!includeImage) {
			delete annotation.image;
		}
		this._unsavedAnnotations.set(annotation.id, annotation);
		this._triggerSaving();
	}

	async _triggerSaving() {
		if (!this._unsavedAnnotations.size || this._savingInProgress) {
			return;
		}
		if ((Date.now() - this._lastChangeTime < DEBOUNCE_TIME)
			&& (Date.now() - this._lastSaveTime < DEBOUNCE_MAX_TIME)) {
			setTimeout(this._triggerSaving.bind(this), 1000);
			return;
		}
		this._lastSaveTime = Date.now();
		this._savingInProgress = true;
		let annotations = Array.from(this._unsavedAnnotations.values());
		this._unsavedAnnotations.clear();
		let clonedAnnotations = annotations.map(x => JSON.parse(JSON.stringify(x)));
		annotations.forEach(x => delete x.onlyTextOrComment);
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
		let { tags, colors, authors } = this._filter;
		if (tags.length || colors.length || authors.length) {
			annotations = annotations.filter(x => (
				tags && x.tags.some(t => tags.includes(t.name))
				|| colors && colors.includes(x.color)
				|| authors && authors.includes(x.authorName)
			));
		}

		if (this._filter.query) {
			annotations = annotations.slice();
			let query = this._filter.query.toLowerCase();
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
}

export default AnnotationManager;
