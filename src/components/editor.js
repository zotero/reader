'use strict';

import React from 'react';

let map = {
  'strong': 'b'
};

function clean(parent) {
  let child = parent.firstChild;
  while (child) {
    if (child.nodeType === 1) {
      for (let el in map) {
        if (child.nodeName.toLowerCase() === el) {
          let children = child.childNodes;
          let aa = document.createElement(map[el]);
          aa.append(...children);
          
          child.replaceWith(aa);
          child = aa;
          continue;
        }
      }
      
      if (!['b', 'i', 'sub', 'sup'].includes(child.nodeName.toLowerCase())) {
        let first = child.firstChild;
        let next = child.nextSibling;
        
        child.replaceWith(...child.childNodes);
        if (first) {
          child = first;
        }
        else {
          child = next;
        }
        continue;
      }
      else {
        while (child.attributes.length > 0) {
          child.removeAttribute(child.attributes[0].name);
        }
      }
    }
    else if (child.nodeType === 3) {
    
    }
    else {
      parent.removeChild(child);
    }
    clean(child);
    child = child.nextSibling;
  }
}

var actions = [
  {
    icon: '<b>B</b>',
    title: 'Bold',
    command: 'bold'
  },
  {
    icon: '<i>I</i>',
    title: 'Italic',
    command: 'italic'
  },
  {
    icon: 'X<sub>2</sub>',
    title: 'Subscript',
    command: 'subscript'
  },
  {
    icon: 'X<sup>2</sup>',
    title: 'Superscript',
    command: 'subscript'
  },
  {
    icon: 'T<sub>x</sub>',
    title: 'Superscript',
    command: 'removeformat'
  }
];

class Content extends React.Component {
  constructor(props) {
    super(props)
  }
  
  componentDidMount() {
    document.addEventListener('selectionchange', this.onSelectionChange);
  }
  
  componentWillUnmount() {
    document.removeEventListener('selectionchange', this.onSelectionChange);
  }
  
  onSelectionChange = () => {
    let { onSelectionChange, innerRef } = this.props;
    let selection = window.getSelection();
    
    // let range = null;
    
    // if (selection.isCollapsed) {
    // 	range = selection.getRangeAt(0);
    // }
    
    
    let node = selection.anchorNode;
    
    let found = false;
    do {
      if (node === innerRef.current) {
        found = true;
        break;
      }
    }
    while (node && (node = node.parentNode));
    
    let isSelected = false;
    
    if (!selection.isCollapsed && found) {
      isSelected = true;
    }
    
    onSelectionChange(isSelected);
  }
  
  shouldComponentUpdate(nextProps) {
    let { innerRef } = this.props;
    
    if (innerRef.current.innerHTML !== nextProps.text) {
      return true;
    }
    return false;
  }
  
  render() {
    let { plainTextOnly, text, placeholder, onChange, innerRef } = this.props;
    return (
      <div
        ref={innerRef}
        className="content"
        contentEditable={true}
        dangerouslySetInnerHTML={{ __html: text }}
        onInput={() => {
          clean(innerRef.current);
          onChange(innerRef.current.innerHTML);
        }}
        placeholder={placeholder}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      />
    );
  }
}

class Editor extends React.Component {
  constructor(props) {
    super(props)
  }
  
  contentRef = React.createRef();
  state = {
    isSelected: false
  }
  
  render() {
    let { plainTextOnly, text, placeholder, onChange } = this.props;
    return (
      <div ref="editor" className="editor">
        <Content
          text={text}
          onChange={onChange}
          innerRef={this.contentRef}
          onSelectionChange={(isSelected) => {
            this.setState({ isSelected });
          }}
          placeholder={placeholder}
        />
        {!plainTextOnly && this.state.isSelected ? (
          <div className="toolbar">
            {
              actions.map((action, idx) => (
                <button
                  key={idx}
                  className="button"
                  dangerouslySetInnerHTML={{ __html: action.icon }}
                  onClick={() => {
                    document.execCommand(action.command, false, null);
                    this.contentRef.current.focus();
                  }}
                />
              ))
            }
          </div>) : null}
      </div>
    );
  }
}

export default Editor;
