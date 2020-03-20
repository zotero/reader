import React from 'react';
import cx from 'classnames';
import Editor from './editor';

class CollapsedEditor extends React.Component {
  state = {
    overflowed: false,
    expanded: false
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
      let overflowed = !(outerHeight === innerHeight);
      if (overflowed !== this.state.overflowed) {
        this.setState({ overflowed });
      }
    })
    
    document
      .getElementById('viewer')
      .addEventListener('pointerdown', this.handleBlur)
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
    let overflowed = !(outerHeight === innerHeight);
    if (overflowed !== this.state.overflowed) {
      this.setState({ overflowed });
    }
  }
  
  handleBlur = () => {
    this.setState({ expanded: false });
  }
  
  handleExpand = () => {
    this.setState({ expanded: true });
  }
  
  render() {
    return (
      <div className="collapsed-editor">
        <div ref="outer" className={cx('outer', { expanded: this.state.expanded })}>
          <div ref="inner" className="inner">
            <Editor
              {...this.props}
              onChange={(text) => {
                this.setState({ expanded: true });
                this.props.onChange(text);
              }}
              onSelectionChange={(isSelected) => {
                if (isSelected) {
                  this.setState({ expanded: true });
                }
              }}
            />
          </div>
        </div>
        <div
          className={cx('expander', { hidden: !this.state.overflowed })}
          onClick={this.handleExpand}
        >˅
        </div>
      </div>
    )
  }
}

export default CollapsedEditor;
