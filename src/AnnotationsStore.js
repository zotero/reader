import queue from "queue";
import { extractExternalAnnotations, getAnnotationsCount, getSortIndex } from "./lib/extract";
import { renderSquareImage } from "./lib/render";
import { p2v, v2p, wx, hy } from "./lib/coordinates";

class AnnotationsStore {
  constructor(options) {
    this.annotations = [];
    this.onSetAnnotation = options.onSetAnnotation;
    this.onDeleteAnnotation = options.onDeleteAnnotation;
    this.onUpdateAnnotations = () => {
    };
    this.onImportableAnnotationsNum = () => {
    };
    this.userId = options.userId;
    this.label = options.label;
    
    this.renderQueue = queue({
      concurrency: 1,
      autostart: true
    });
    
    document.addEventListener("pagesinit", async (e) => {
      let count = await getAnnotationsCount();
      this.onImportableAnnotationsNum(count);
      // console.time("extracted external annotations");
      // let externalAnnotations = await extractExternalAnnotations();
      // for (let externalAnnotation of externalAnnotations) {
      //   externalAnnotation.id = this.genId();
      //   // annotation.dateCreated = annotation.dateModified = (new Date()).toISOString(); // TODO: external?
      //   // annotation.userId = userId || null;
      //   // annotation.label = label || "";
      //   // annotation.color = color;
      //   this.annotations.push(externalAnnotation);
      // }
      // this.sortAnnotations(this.annotations);
      // this.onUpdateAnnotations(this.annotations);
      // console.timeEnd("extracted external annotations");
    });
    
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
    annotations.sort((a, b) => {
      // TODO: Remove
      a = a.sortIndex || '';
      b = b.sortIndex || '';
      return a.localeCompare(b);
    });
    return annotations;
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
    annotation.id = this.genId();
    annotation.dateCreated = annotation.dateModified = (new Date()).toISOString(); // TODO: external?
    annotation.userId = this.userId || null;
    annotation.label = this.label || "";
    // annotation.color = color;
    
    annotation.position.rects = annotation.position.rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
  
  
    // Todo: Move this out from here
    let pageLabels = window.PDFViewerApplication.pdfViewer._pageLabels;
  
    if (pageLabels && pageLabels[annotation.position.pageNumber - 1]) {
      annotation.page = pageLabels[annotation.position.pageNumber - 1];
    }
    else {
      annotation.page = annotation.position.pageNumber;
    }
    
    
    let updateImage = false;
    if (annotation.type === "square" && !annotation.image) {
      annotation.image = "";
      updateImage = true;
    }
    
    this.annotations.push(annotation);
    
    this.sortAnnotations(this.annotations);
    this.onSetAnnotation(annotation);
    // this.setState({ recentlyCreatedAnnotationId: annotation.id });
    
    if (annotation.type === 'text' || annotation.type === 'square') {
      annotation.sortIndex = await getSortIndex(annotation.position);
    }
    
    this.onUpdateAnnotations(this.annotations);
    
    if (updateImage) {
      this.updateAnnotationImage(annotation.id);
    }
    
    return annotation;
  }
  
  async updateAnnotation(annotation) {
    let prevAnnotationIdx = this.annotations.findIndex(x => x.id === annotation.id);
    let prevAnnotation = this.annotations[prevAnnotationIdx];
    annotation = { ...this.annotations[prevAnnotationIdx], ...annotation };
    annotation.dateModified = (new Date()).toISOString();
    annotation.position.rects = annotation.position.rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
    
    let updateImage = false;
    if (
      annotation.type === "square" &&
      JSON.stringify(prevAnnotation.position.rects) !== JSON.stringify(annotation.position.rects)
    ) {
      annotation.image = "";
      updateImage = true;
    }
    
    if (
      ["text", "square"].includes(annotation.type) &&
      prevAnnotation.position.pageNumber === annotation.position.pageNumber &&
      JSON.stringify(prevAnnotation.position.rects) !== JSON.stringify(annotation.position.rects)
    ) {
      annotation.sortIndex = await getSortIndex(annotation.position);
    }
    
    this.annotations.splice(prevAnnotationIdx, 1, annotation);
    
    this.sortAnnotations(this.annotations);
    
    // this.setState({ recentlyUpdatedAnnotationId: annotation.id });
    this.onSetAnnotation(annotation);
    this.onUpdateAnnotations(this.annotations);
    
    if (updateImage) {
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
      let image = await renderSquareImage(annotation.position);
      if (!image) return;
      this.updateAnnotation({
        id: annotation.id,
        image
      });
    });
  }
  
  async importAnnotations() {
    console.time("imported annotations");
    let externalAnnotations = await extractExternalAnnotations();
    for (let externalAnnotation of externalAnnotations) {
      externalAnnotation.id = this.genId();
      // annotation.dateCreated = annotation.dateModified = (new Date()).toISOString(); // TODO: external?
      // annotation.userId = userId || null;
      // annotation.label = label || "";
      // annotation.color = color;
      this.annotations.push(externalAnnotation);
      this.onSetAnnotation(externalAnnotation);
    }
    this.sortAnnotations(this.annotations);
    this.onUpdateAnnotations(this.annotations);
    console.timeEnd("imported annotations");
  }
}

export default AnnotationsStore;
