'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames'

class Toolbar extends React.Component {
  getContainerNode() {
    return document.getElementById('toolbarViewerMiddle');
  }
  
  render() {
    let { active, color, onColorClick, onMode } = this.props;
    let containerNode = this.getContainerNode();
    return ReactDOM.createPortal(
      <React.Fragment>
        <button
          id="globalColorButton"
          className="toolbarButton"
          style={{ color }}
          onClick={onColorClick}
        />
        <button
          className={cx({
            toolbarButton: true,
            highlight: true,
            active: active === 'highlight'
          })}
          onClick={() => {
            onMode('highlight');
          }}/>
        <button
          className={cx({
            toolbarButton: true,
            note: true,
            active: active === 'note'
          })}
          onClick={() => {
            onMode('note');
          }}/>
        <button
          className={cx({
            toolbarButton: true,
            area: true,
            active: active === 'area'
          })}
          onClick={() => {
            onMode('area');
          }}/>
      </React.Fragment>,
      containerNode
    );
  }
}

export default Toolbar;
