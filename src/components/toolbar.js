'use strict';

import React from 'react';
import ReactDOM from 'react-dom';
import cx from 'classnames'

class Toolbar extends React.Component {
  getContainerNode() {
    return document.getElementById('toolbarViewerMiddle');
  }
  
  handleColorPick = (event) => {
    this.props.onColorPick(event.screenX, event.screenY)
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
          onClick={this.handleColorPick}
        />
        <button
          className={cx('toolbarButton highlight', {
            active: active === 'highlight'
          })}
          onClick={() => {
            onMode('highlight');
          }}/>
        <button
          className={cx('toolbarButton note', {
            active: active === 'note'
          })}
          onClick={() => {
            onMode('note');
          }}/>
        <button
          className={cx('toolbarButton area', {
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
