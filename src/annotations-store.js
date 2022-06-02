'use strict';

import queue from 'queue';

import { renderAreaImage } from './lib/render';
import { annotationColors } from './lib/colors';
import { positionsEqual } from './lib/utilities';
import { debounce } from './lib/debounce';

// TODO: Debounce image annotation resizing to reduce useless intermediate images

class AnnotationsStore {
	constructor(options) {
		this._readOnly = options.readOnly;
		this._authorName = options.authorName;
		this._annotations = options.annotations;
		this._onSave = options.onSave;
		this._onDelete = options.onDelete;
		this.render = () => {
			this._annotations.sort((a, b) => (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex));
			options.onRender(this._annotations);
		};

		this._renderQueue = queue({
			concurrency: 1,
			autostart: true
		});

		this._unsavedAnnotations = [];
		// Debounce for 1s but no more than 10s
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

		window.PDFViewerApplication.eventBus.on('pagerendered', (e) => {
			setTimeout(() => {
				this._renderMissingImages();
			}, 2000);
		});
	}

	// Called when changes come from the client side
	async setAnnotations(annotations) {
		for (let annotation of annotations) {
			this._annotations = this._annotations.filter(x => x.id !== annotation.id);
			this._annotations.push(annotation);
		}

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
	async addAnnotation(annotation) {
		if (this._readOnly) {
			return;
		}

		// Those properties can be set on creation
		annotation.color = annotation.color || annotationColors[0];
		annotation.text = annotation.text || '';
		annotation.comment = annotation.comment || '';
		annotation.tags = annotation.tags || [];
		// annotation.sortIndex

		// All others are set automatically
		annotation.id = this._generateObjectKey();
		annotation.dateCreated = (new Date()).toISOString();
		annotation.dateModified = annotation.dateCreated;
		annotation.authorName = this._authorName;
		annotation.pageLabel = '-';

		if (!annotation.sortIndex) {
			annotation.sortIndex = '00000|000000|00000';
		}

		if (annotation.position.rects) {
			annotation.position.rects = annotation.position.rects.map(
				rect => rect.map(value => parseFloat(value.toFixed(3)))
			);
		}

		// Immediately render the annotation to prevent
		// delay from further async calls
		this._save(annotation);
		this.render();

		annotation.pageLabel = await window.extractor.getPageLabel(annotation.position.pageIndex, true);

		if (annotation.type === 'note' || annotation.type === 'image') {
			annotation.sortIndex = await window.extractor.getSortIndex(annotation.position);
		}

		this._save(annotation);
		this.render();

		if (['image', 'ink'].includes(annotation.type)) {
			annotation.image = await this.getAnnotationImage(annotation.id);
			this._save(annotation, true);
			this.render();
		}

		return annotation;
	}

	async updateAnnotations(annotations) {
		let updateSortIndex = [];
		let updateImage = [];

		for (let annotation of annotations) {
			if (annotation.readOnly || this._readOnly) {
				continue;
			}

			let existingAnnotation = this._getAnnotationByID(annotation.id);

			if (!annotation.onlyTextOrComment) {
				delete existingAnnotation.onlyTextOrComment;
			}

			annotation = {
				...existingAnnotation,
				...annotation,
				position: { ...existingAnnotation.position, ...annotation.position }
			};
			annotation.dateModified = (new Date()).toISOString();

			if (annotation.rects) {
				annotation.position.rects = annotation.position.rects.map(
					rect => rect.map(value => parseFloat(value.toFixed(3)))
				);
			}

			this._save(annotation);

			if (['note', 'image'].includes(annotation.type)
				&& !positionsEqual(existingAnnotation.position, annotation.position)) {
				updateSortIndex.push(annotation);
			}

			if (
				['image', 'ink'].includes(annotation.type)
				&& !positionsEqual(existingAnnotation.position, annotation.position)
				|| (
					annotation.type === 'ink'
					&& existingAnnotation.color.toLowerCase() !== annotation.color.toLowerCase()
				)
			) {
				updateImage.push(annotation);
			}
		}

		this.render();

		for (let annotation of updateSortIndex) {
			annotation.sortIndex = await window.extractor.getSortIndex(annotation.position);
			this._save(annotation);
		}

		for (let annotation of updateImage) {
			annotation.image = await this.getAnnotationImage(annotation.id);
			this._save(annotation, true);
		}

		if (updateSortIndex.length || updateImage.length) {
			this.render();
		}
	}

	deleteAnnotations(ids) {
		let someExternal = this._annotations.some(
			annotation => ids.includes(annotation.id) && annotation.isExternal
		);

		// Don't delete anything if the PDF file is read-only, or at least one provided annotation is external
		if (this._readOnly || someExternal) {
			return;
		}

		if (!ids.length || ids.length > 1 && !zoteroConfirmDeletion(ids.length > 1)) {
			return;
		}

		this._annotations = this._annotations.filter(annotation => !ids.includes(annotation.id));
		this._unsavedAnnotations = this._unsavedAnnotations.filter(x => !ids.includes(x.id));
		this._onDelete(ids);
		this.render();
	}

	async getAnnotationImage(annotationID) {
		return new Promise((resolve) => {
			this._renderQueue.push(async () => {
				let image = '';
				try {
					let annotation = this._getAnnotationByID(annotationID);
					if (annotation) {
						image = await renderAreaImage(annotation);
					}
				}
				catch (e) {
				}
				resolve(image);
			});
		});
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

	async _renderMissingImages() {
		for (let annotation of this._annotations) {
			if (['image', 'ink'].includes(annotation.type) && !annotation.image) {
				annotation.image = await this.getAnnotationImage(annotation.id);
				this._save(annotation, true);
				this.render();
			}
		}
	}
}

export default AnnotationsStore;
