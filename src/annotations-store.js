'use strict';

import queue from 'queue';
import { getAnnotationsCount, getSortIndex } from './lib/extract';
import { renderAreaImage } from './lib/render';
import { annotationColors } from './lib/colors';

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
    // Those properties can be set on creator
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
    
    annotation.position.rects = annotation.position.rects.map(
      rect => rect.map(value => parseFloat(value.toFixed(3)))
    );
    
    // Todo: Move this out from here
    let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
    if (pageLabels && pageLabels[annotation.position.pageIndex]) {
      annotation.page = pageLabels[annotation.position.pageIndex];
    }
    else {
      annotation.page = (annotation.position.pageIndex + 1).toString();
    }
    
    let updateImage = false;
    if (annotation.type === 'area' && !annotation.image) {
      annotation.image = '';
      updateImage = true;
    }
    
    if (annotation.type === 'note' || annotation.type === 'area') {
      annotation.sortIndex = await getSortIndex(annotation.position);
    }
    
    this.annotations.push(annotation);
    this.sortAnnotations(this.annotations);
    this.onSetAnnotation(annotation);
    this.onUpdateAnnotations(this.annotations);
    
    if (updateImage) {
      this.updateAnnotationImage(annotation.id);
    }
    
    return annotation;
  }
  
  async setAnnotation(annotation) {
    let existingAnnotationIdx = this.annotations.findIndex(x => x.id === annotation.id);
    if (existingAnnotationIdx >= 0) {
      this.annotations.splice(existingAnnotationIdx, 1);
    }
    
    this.annotations.push(annotation);
    
    this.sortAnnotations(this.annotations);
    
    this.onUpdateAnnotations(this.annotations);
    
    // if (updateImage) {
    //   this.updateAnnotationImage(annotation.id);
    // }
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
    
    if (
      ['note', 'area'].includes(annotation.type) &&
      existingAnnotation.position.pageIndex === annotation.position.pageIndex &&
      JSON.stringify(existingAnnotation.position.rects) !== JSON.stringify(annotation.position.rects)
    ) {
      annotation.sortIndex = await getSortIndex(annotation.position);
    }
    
    this.annotations.splice(existingAnnotationIdx, 1, annotation);
    this.sortAnnotations(this.annotations);
    this.onSetAnnotation(annotation);
    this.onUpdateAnnotations(this.annotations);
    
    if (
      annotation.type === 'area' &&
      JSON.stringify(existingAnnotation.position.rects) !== JSON.stringify(annotation.position.rects)
    ) {
      annotation.image = '';
      this.updateAnnotationImage(annotation.id);
    }
  }
  
  deleteAnnotation(id) {
    this.annotations = this.annotations.filter(
      annotation => id !== annotation.id
    );
    
    this.onDeleteAnnotation(id);
    this.onUpdateAnnotations(this.annotations);
  }
  
  updateAnnotationImage(annotationId) {
    this.renderQueue.push(async () => {
      let annotation = this.getAnnotationById(annotationId);
      if (!annotation || annotation.image) return;
      let image = await renderAreaImage(annotation.position);
      if (!image) return;
      this.updateAnnotation({
        id: annotation.id,
        image
      });
    });
  }
}

export default AnnotationsStore;
