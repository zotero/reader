import React from 'react';
import cx from 'classnames';
import Editor from './editor';
import { lineClamp } from '../lib/clamp';
import { debounce } from '../lib/utilities';

class ExpandableEditor extends React.Component {

  state = {
    isResizing: false,
    clampedHtml: null
  }

  debounceUpdate = debounce(this.update, 1000);

  initialized = false;

  getClampingContainer() {
    let container = document.getElementById('clamp1');
    if (!container) {
      container = document.createElement('div');
      container.id = 'clamp1';

      let clampParent = document.createElement('div');
      clampParent.id = 'clamp1Container'
      clampParent.appendChild(container)
      document.body.appendChild(clampParent);
    }
    return container;
  }

  componentDidMount() {
    // // this.observer = this.observeVisibility(document.getElementById('annotationsView'), () => {
    // //   if (!this.refs.outer) return;
    // //   let outerHeight = this.refs.outer.offsetHeight;
    // //   let innerHeight = this.refs.inner.offsetHeight;
    // //   let isOverflowed = !(outerHeight === innerHeight);
    // //   if (isOverflowed !== this.state.isOverflowed) {
    // //     this.setState({ isOverflowed });
    // //   }
    // })
    //
    // document
    //   .getElementById('viewer')
    //   .addEventListener('pointerdown', this.handleBlur);

    document.getElementById('sidebarResizer').addEventListener('mousedown', this.handleResizerDown)
    window.addEventListener('mouseup', this.handleResizerUp)
  }

  componentWillUnmount() {
    // this.observer.disconnect();
    // document
    //   .getElementById('viewer')
    //   .removeEventListener('pointerdown', this.handleBlur);

    document.getElementById('sidebarResizer').removeEventListener('mousedown', this.handleResizerDown)
    window.removeEventListener('mouseup', this.handleResizerUp);
    this.unmounted = true;
  }

  componentDidUpdate(prevProps, prevState) {
    if (!this.initialized) {
      this.initialized = true;
      setTimeout(() => {
        this.update();
      }, 100)

    }
    else {
      if (prevProps.text !== this.props.text) {
        this.setState({ clampedHtml: null });
        this.debounceUpdate();
      }
    }
  }

  handleResizerDown = (event) => {
    this.setState({ isResizing: true });
  }

  handleResizerUp = (event) => {
    if (this.state.isResizing) {
      this.setState({ isResizing: false });
      this.update();
    }
  }

  async update() {
    if (this.unmounted) return;
    this.setState({ clampedHtml: null });
    let node = this.refs.editorView.querySelector('.content');
    if (!node) return;
    let renderedEditorHtml = node.innerHTML;
    let clampedHtml = await lineClamp(renderedEditorHtml, this.getClampingContainer());
    if (!this.unmounted) this.setState({ clampedHtml });
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

  handleChange = (text) => {
    this.props.onChange(text)
  }

  render() {
    let showClampedEditor = !this.props.isExpanded && !this.state.isResizing && this.state.clampedHtml;

    return (
      <div
        className={cx('expandable-editor', {
          expanded: this.props.isExpanded,
          editable: !this.props.isReadOnly && this.props.isEditable
        })}
        ref="ex"
      >
        <div ref="editorView" className={cx('editor-view')}
             style={{ display: showClampedEditor ? 'none' : 'block' }}>
          <Editor {...this.props} onChange={this.handleChange}
                  isReadOnly={this.props.isReadOnly || !this.props.isEditable}/>
        </div>
        {showClampedEditor && <div className="clamped-view">
          <div className={cx('editor', { 'read-only': this.props.isReadOnly || !this.props.isEditable })}>
            <div className="content" dangerouslySetInnerHTML={{ __html: this.state.clampedHtml }}/>
          </div>
        </div>
        }
      </div>

    )
  }
}

export default ExpandableEditor;
