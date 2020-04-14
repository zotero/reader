'use strict';

import queue from 'queue';
import {
  getAnnotationsCount, getSortIndex,
  extractPageLabelPoints, extractPageLabel
} from './lib/extract';
import { renderAreaImage } from './lib/render';
import { annotationColors } from './lib/colors';
import {equalPositions} from './lib/utilities';

class AnnotationsStore {
  constructor(options) {
    this.annotations = options.annotations;
    this.onSetAnnotation = options.onSetAnnotation;
    this.onDeleteAnnotation = options.onDeleteAnnotation;
    this.onUpdateAnnotations = () => {
    };
    this.onImportableAnnotationsNum = () => {
    };
    
    this.renderQueue = queue({
      concurrency: 1,
      autostart: true
    });
    
    document.addEventListener('pagesinit', async (e) => {
      let count = await getAnnotationsCount();
      this.onImportableAnnotationsNum(count);
    });
    
    this.sortAnnotations(this.annotations);
  }
  
  async getPageLabelPoints() {
    if (!this.pageLabelPoints) {
      this.pageLabelPoints = await extractPageLabelPoints();
    }
    
    return this.pageLabelPoints;
  }
  
  genId() {
    return parseInt(String(Math.random()).slice(2, 17));
  }
  
  getAnnotations() {
    return this.annotations;
  }
  
  getAnnotationById(id) {
    return this.annotations.find(annotation => annotation.id === id);
  }
  
  sortAnnotations(annotations) {
    annotations.sort((a, b) =>
      (a.sortIndex > b.sortIndex) - (a.sortIndex < b.sortIndex)
    );
  }
  
  syncSetAnnotation = (annotation) => {
    let annotations = this.annotations;
    let existingAnnotationIdx = annotations.findIndex(x => x.id === annotation.id);
    if (existingAnnotationIdx >= 0) {
      let existingAnnotation = annotations[existingAnnotationIdx];
      if (existingAnnotation.dateModified < annotation.dateModified) {
        annotations.splice(existingAnnotationIdx, 1, annotation);
      }
    }
    else {
      annotations.push(annotation);
    }
    
    if (!annotation.image) {
      this.updateAnnotationImage(annotation.id);
    }
    
    this.sortAnnotations(annotations);
    this.onUpdateAnnotations(this.annotations);
  };
  
  syncDeleteAnnotation = (annotationId, dateDeleted) => {
    let existingAnnotationIdx = this.annotations.findIndex(x => x.id === annotationId);
    if (existingAnnotationIdx >= 0) {
      let existingAnnotation = this.annotations[existingAnnotationIdx];
      if (existingAnnotation.dateModified < dateDeleted) {
        this.annotations.splice(existingAnnotationIdx, 1);
        this.onUpdateAnnotations(this.annotations);
      }
    }
  };
  
  async addAnnotation(annotation) {
    // Those properties can be set on creation
    annotation.color = annotation.color || annotationColors[0];
    annotation.text = annotation.text || '';
    annotation.comment = annotation.comment || '';
    annotation.tags = annotation.tags || [];
    // annotation.sortIndex
    
    // All other are set automatically
    annotation.id = this.genId();
    annotation.dateCreated = (new Date()).toISOString();
    annotation.dateModified = annotation.dateCreated;
    annotation.authorName = '';
    annotation.pageLabel = '-';
    
    annotation.position.rects = annotation.position.rects.map(
      rect => rect.map(value => parseFloat(value.toFixed(3)))
    );
    
    // Immediately render the annotation to prevent
    // delay from the further async calls
    this.annotations.push(annotation);
    this.onUpdateAnnotations(this.annotations);
    
    let points = await this.getPageLabelPoints();
    if (points) {
      let pageLabel = await extractPageLabel(annotation.position.pageIndex, points);
      if (pageLabel) {
        annotation.pageLabel = pageLabel;
      }
    }
    else {
      let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
      if (pageLabels && pageLabels[annotation.position.pageIndex]) {
        annotation.pageLabel = pageLabels[annotation.position.pageIndex];
      }
      else {
        annotation.pageLabel = (annotation.position.pageIndex + 1).toString();
      }
    }
    
    if (annotation.type === 'note' || annotation.type === 'area') {
      annotation.sortIndex = await getSortIndex(annotation.position);
    }
    
    if (annotation.type === 'area') {
      annotation.image = await this.getAnnotationImage(annotation.id);
    }
    
    this.sortAnnotations(this.annotations);
    this.onSetAnnotation(annotation);
    this.onUpdateAnnotations(this.annotations);
  }
  
  async setAnnotation(annotation) {
    let existingAnnotationIdx = this.annotations.findIndex(x => x.id === annotation.id);
    if (existingAnnotationIdx >= 0) {
      this.annotations.splice(existingAnnotationIdx, 1);
    }
    
    this.annotations.push(annotation);
    this.sortAnnotations(this.annotations);
    this.onUpdateAnnotations(this.annotations);
    
    if (annotation.type === 'area' && !annotation.image) {
      annotation.image = await this.getAnnotationImage(annotation.id);
      this.onSetAnnotation(annotation);
      this.onUpdateAnnotations(this.annotations);
    }
  }
  
  async updateAnnotation(annotation) {
    let existingAnnotationIdx = this.annotations.findIndex(
      x => x.id === annotation.id
    );
    let existingAnnotation = this.getAnnotationById(annotation.id)
    annotation = { ...existingAnnotation, ...annotation };
    annotation.dateModified = (new Date()).toISOString();
    annotation.position.rects = annotation.position.rects.map(
      rect => rect.map(value => parseFloat(value.toFixed(3)))
    );
    
    // Immediately render the annotation to prevent
    // delay from the further async calls
    this.annotations.splice(existingAnnotationIdx, 1, annotation);
    this.onUpdateAnnotations(this.annotations);
  
    if (
      ['note', 'area'].includes(annotation.type) &&
      !equalPositions(existingAnnotation, annotation)
    ) {
      annotation.sortIndex = await getSortIndex(annotation.position);
    }
    
    if (
      annotation.type === 'area' &&
      !equalPositions(existingAnnotation, annotation)
    ) {
      annotation.image = await this.getAnnotationImage(annotation.id);
    }
    
    this.sortAnnotations(this.annotations);
    this.onSetAnnotation(annotation);
    this.onUpdateAnnotations(this.annotations);
  }
  
  deleteAnnotation(id) {
    this.annotations = this.annotations.filter(
      annotation => id !== annotation.id
    );
    
    this.onDeleteAnnotation(id);
    this.onUpdateAnnotations(this.annotations);
  }
  
  async getAnnotationImage(annotationId) {
    return new Promise((resolve) => {
      this.renderQueue.push(async () => {
        let image = '';
        try {
          let annotation = this.getAnnotationById(annotationId);
          if (annotation) {
            image = await renderAreaImage(annotation.position);
          }
        }
        catch (e) {
        }
        resolve(image);
      });
    });
  }
  
  resetPageLabels(pageIndex, pageLabel) {
    if (parseInt(pageLabel).toString() !== pageLabel) {
      return;
    }
    
    let startPageNumber = parseInt(pageLabel) - pageIndex;
    
    for (let annotation of this.annotations) {
      let pageNumber = startPageNumber + annotation.position.pageIndex;
      annotation.pageLabel = pageNumber.toString();
      this.onSetAnnotation(annotation);
    }
    
    this.onUpdateAnnotations(this.annotations);
  }
}

export default AnnotationsStore;
