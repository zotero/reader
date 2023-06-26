import { debounce } from './lib/debounce';
import { approximateMatch } from './lib/approximate-match';
import { measureTextAnnotationDimensions } from '../pdf/lib/text-annotation';

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

		this._unsavedAnnotations = [];
		// Debounce for 1 second but no more than 10 second
		this._debounceSave = debounce(() => {
			if (!this._unsavedAnnotations.length) {
				return;
			}
			// Image is sent in instant mode only
			let annotations = this._unsavedAnnotations.map(x => ({ ...x, image: undefined }));
			this._onSave(annotations);

			for (let annotation of this._unsavedAnnotations) {
				delete annotation.onlyTextOrComment;
			}

			this._unsavedAnnotations = [];
		}, 1000, { maxWait: 10000 });

		// window.PDFViewerApplication.eventBus.on('pagerendered', (e) => {
		// 	setTimeout(() => {
		// 		this._renderMissingImages();
		// 	}, 2000);
		// });

		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));

		// Necessary to set reader._state.annotation for the first time
		this.render();
		this._onChangeFilter(this._filter);
	}

	// Called when changes come from the client side
	async setAnnotations(annotations) {
		if (this._readOnly) {
			annotations.forEach(x => x.readOnly = true);
		}

		for (let annotation of annotations) {
			this._annotations = this._annotations.filter(x => x.id !== annotation.id);
			this._annotations.push(annotation);
		}
		this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));

		this.render();

		for (let annotation of annotations) {
			if (['image', 'ink'].includes(annotation.type) && !annotation.image) {
				annotation.image = await this.getAnnotationImage(annotation.id);
				this._save(annotation, true);
				this.render();
			}
		}
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
		this._save(annotation);
		this.render();
		return annotation;
	}

	updateAnnotations(annotations) {
		if (this._readOnly) {
			throw new Error('Cannot update annotation for read-only file');
		}
		// Validate data
		for (let annotation of annotations) {
			if (annotation.position && !annotation.sortIndex) {
				throw new Error(`If updating 'position', 'sortIndex' has to be provided as well`);
			}
			let existingAnnotation = this._getAnnotationByID(annotation.id);
			if (existingAnnotation.readOnly) {
				throw new Error('Cannot update read-only annotation');
			}
		}
		for (let annotation of annotations) {
			let existingAnnotation = this._getAnnotationByID(annotation.id);
			if (!annotation.onlyTextOrComment) {
				delete existingAnnotation.onlyTextOrComment;
			}
			if (annotation.image) {
				let { image } = annotation;
				delete annotation.image;
				// Instantly save annotation image to avoid batching them and accumulating in memory,
				// and then doing large transfers between iframe and main Zotero code
				this._save({ ...existingAnnotation, image }, true);
				// If only updating an image skip the code below together with dateModified updating
				if (Object.keys(annotation).length === 1) {
					continue;
				}
			}
			if (annotation.position) {
				annotation.image = undefined;
			}
			// All parameters in the existing annotation position are preserved except nextPageRects
			let deleteNextPageRects = !annotation.position?.nextPageRects;
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
			this._save(annotation);
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
		this._unsavedAnnotations = this._unsavedAnnotations.filter(x => !ids.includes(x.id));
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

	_save(annotation, instant) {
		let oldIndex = this._annotations.findIndex(x => x.id === annotation.id);
		if (oldIndex !== -1) {
			annotation = { ...annotation };
			this._annotations.splice(oldIndex, 1, annotation);
		}
		else {
			this._annotations.push(annotation);
			this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
		}

		this._unsavedAnnotations = this._unsavedAnnotations.filter(x => x.id !== annotation.id);

		if (instant) {
			this._onSave([annotation]);
		}
		else {
			this._unsavedAnnotations.push(annotation);
			this._debounceSave();
		}
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
