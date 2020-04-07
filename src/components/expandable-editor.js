import React from 'react';
import cx from 'classnames';
import Editor from './editor';

class ExpandableEditor extends React.Component {
  state = {
    isOverflowed: false,
    isExpanded: false
  }
  
  observeVisibility(element, callback) {
    let options = {
      root: document.documentElement
    };
    let observer = new IntersectionObserver(([entry], observer) => {
      if (entry && entry.isIntersecting) {
        callback();
      }
    }, options);
    observer.observe(element);
    return observer;
  }
  
  componentDidMount() {
    this.observer = this.observeVisibility(document.getElementById('annotationsView'), () => {
      if (!this.refs.outer) return;
      let outerHeight = this.refs.outer.offsetHeight;
      let innerHeight = this.refs.inner.offsetHeight;
      let isOverflowed = !(outerHeight === innerHeight);
      if (isOverflowed !== this.state.isOverflowed) {
        this.setState({ isOverflowed });
      }
    })
    
    document
      .getElementById('viewer')
      .addEventListener('pointerdown', this.handleBlur);
  }
  
  componentWillUnmount() {
    this.observer.disconnect();
    document
      .getElementById('viewer')
      .removeEventListener('pointerdown', this.handleBlur);
  }
  
  componentDidUpdate() {
    let outerHeight = this.refs.outer.offsetHeight;
    let innerHeight = this.refs.inner.offsetHeight;
    let isOverflowed = !(outerHeight === innerHeight);
    if (isOverflowed !== this.state.isOverflowed) {
      this.setState({ isOverflowed });
    }
  }
  
  setCaretToEnd(target) {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(target);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    target.focus();
    range.detach();
  }
  
  handleBlur = () => {
    this.setState({ isExpanded: false });
  }
  
  handleDoubleClick = () => {
    if (this.state.isOverflowed) {
      let content = this.refs.inner.querySelector('.content');
      this.setCaretToEnd(content);
    }
  }
  
  handleClick = () => {
    if (!this.state.isExpanded) {
      // Hold on until handleDoubleClick is triggered
      setTimeout(() => {
        this.setState({ isExpanded: true });
      }, 0);
    }
  }
  
  render() {
    return (
      <div
        className={cx('expandable-editor', { overflowed: this.state.isOverflowed })}
        onDoubleClick={this.handleDoubleClick}
      >
        <div
          ref="outer"
          className={cx('outer', { expanded: this.state.isExpanded })}
          onClick={this.handleClick}
        >
          <div ref="inner" className="inner">
            <Editor
              {...this.props}
              onChange={(text) => {
                this.props.onChange(text);
              }}
            />
          </div>
        </div>
                {/*{this.state.isOverflowed && <div style={{position:'relative'}}> <div className="continued"/></div> }*/}

      </div>
    )
  }
}

export default ExpandableEditor;
