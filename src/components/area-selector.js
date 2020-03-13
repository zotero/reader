'use strict';

import React from 'react';
import { getPageFromElement } from '../lib/pdfjs-dom';

class AreaSelector extends React.Component {
  state = {
    locked: false,
    start: null,
    end: null,
    bounds: null,
    page: null
  }
  
  reset = () => {
    let { onDragEnd } = this.props;
    onDragEnd();
    this.setState({ start: null, end: null, locked: false });
  }
  
  getBoundingRect(start, end) {
    return {
      left: Math.min(end.x, start.x),
      top: Math.min(end.y, start.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    };
  }
  
  componentDidMount() {
    if (!this.root) {
      return;
    }
    
    let that = this;
    let { onSelection, onDragStart, onDragEnd, shouldStart } = this.props;
    let container = this.root.parentElement.parentElement;
    let scrollTimeout = null;
    
    if (!(container instanceof HTMLElement)) {
      return;
    }
    
    let containerBoundingRect = null;
    
    let containerCoords = (pageX, pageY) => {
      if (!containerBoundingRect) {
        containerBoundingRect = container.getBoundingClientRect();
      }
      return {
        x: pageX - containerBoundingRect.left + container.scrollLeft,
        y: pageY - containerBoundingRect.top + container.scrollTop
      };
    };
    
    window.addEventListener('mousemove', (event) => {
      let { start, locked } = this.state;
      if (!start || locked) {
        return;
      }
      
      let selection = window.getSelection ? window.getSelection() : document.selection ? document.selection : null;
      if (!!selection) selection.empty ? selection.empty() : selection.removeAllRanges();
      
      let end = containerCoords(event.pageX, event.pageY);
      
      if (this.state.bounds) {
        if (end.x < this.state.bounds[0]) {
          end.x = this.state.bounds[0];
        }
        else if (end.x > this.state.bounds[2]) {
          end.x = this.state.bounds[2];
        }
        
        if (end.y < this.state.bounds[1]) {
          end.y = this.state.bounds[1];
        }
        else if (end.y > this.state.bounds[3]) {
          end.y = this.state.bounds[3];
        }
      }
      
      let br = container.getBoundingClientRect();
      
      let scroll = () => {
        let scrolled = false;
        let v = null;
        let h = null;
        if (event.clientY < br.y && this.state.bounds[1] < container.scrollTop) {
          v = 'top';
        }
        else if (event.clientY > br.y + br.height && this.state.bounds[3] > container.scrollTop + document.body.offsetHeight) {
          v = 'bottom';
        }
        
        if (event.clientX < br.x && this.state.bounds[0] < container.scrollLeft) {
          h = 'left';
        }
        else if (event.clientX > br.x + br.width && this.state.bounds[2] > container.scrollLeft + container.offsetWidth) {
          h = 'right';
        }
        
        if (v === 'top') {
          container.scrollTop -= 1;
          scrolled = true;
        }
        else if (v === 'bottom') {
          container.scrollTop += 1;
          scrolled = true;
        }
        
        if (h === 'left') {
          container.scrollLeft -= 1;
          scrolled = true;
        }
        else if (h === 'right') {
          container.scrollLeft += 1;
          scrolled = true;
        }
        
        if (scrolled) {
          scrollTimeout = setTimeout(scroll, 0);
        }
      };
      
      clearTimeout(scrollTimeout);
      scroll();
      
      this.setState({ end });
    });
    
    container.addEventListener('pointerdown', (event) => {
      containerBoundingRect = null;
      clearTimeout(scrollTimeout);
      if (!this.props.shouldStart) {
        this.reset();
        return;
      }
      
      let startTarget = event.target;
      
      if (!(startTarget instanceof HTMLElement)) {
        return;
      }
      
      onDragStart();
      
      let page = getPageFromElement(event.target);
      if (!page) return;
      
      let { node, number } = page;
      
      let bounds = [
        node.offsetLeft + 9,
        node.offsetTop + 10,
        node.offsetLeft + node.offsetWidth - 9,
        node.offsetTop + node.offsetHeight - 10
      ];
      
      
      this.setState({
        start: containerCoords(event.pageX, event.pageY),
        end: null,
        locked: false,
        bounds,
        page: {
          top: node.offsetTop,
          left: node.offsetLeft,
          number: number
        }
      });
      
      let onMouseUp = (event) => {
        clearTimeout(scrollTimeout);
        // emulate listen once
        event.currentTarget.removeEventListener('pointerup', onMouseUp);
        
        let { start } = this.state;
        
        if (!start) {
          return;
        }
        
        let end = containerCoords(event.pageX, event.pageY);
        
        if (this.state.bounds) {
          if (end.x < this.state.bounds[0]) {
            end.x = this.state.bounds[0];
          }
          else if (end.x > this.state.bounds[2]) {
            end.x = this.state.bounds[2];
          }
          
          if (end.y < this.state.bounds[1]) {
            end.y = this.state.bounds[1];
          }
          else if (end.y > this.state.bounds[3]) {
            end.y = this.state.bounds[3];
          }
        }
        
        let boundingRect = that.getBoundingRect(start, end);
        
        if (
          !that.shouldRender(boundingRect)
        ) {
          that.reset();
          return;
        }
        
        that.setState(
          {
            end,
            locked: true
          },
          () => {
            let { start, end } = that.state;
            
            if (!start || !end) {
              return;
            }
            
            
            let boundingRect = that.getBoundingRect(start, end);
            
            let pg = this.state.page;
            
            let rect = [
              boundingRect.left - pg.left - 9,
              boundingRect.top - pg.top - 10,
              boundingRect.left - pg.left + boundingRect.width - 9,
              boundingRect.top - pg.top + boundingRect.height - 10
            ];
            
            let position = {
              rects: [rect],
              pageIndex: pg.number - 1
            };
            
            this.reset();
            onSelection(position, that.reset);
            
            
          }
        );
      };
      
      // if (document.body) {
      window.addEventListener('pointerup', onMouseUp);
      // }
    });
  }
  
  shouldRender(boundingRect) {
    return boundingRect.width >= 1 && boundingRect.height >= 1;
  }
  
  render() {
    let { start, end } = this.state;
    let { color } = this.props;
    
    return (
      <div
        ref={node => (this.root = node)}
      >
        {start && end ? (
          <div
            className="area-selector"
            style={{
              ...this.getBoundingRect(start, end),
              backgroundColor: color
            }}
          />
        ) : null}
      </div>
    );
  }
}

export default AreaSelector;
