'use strict';

import React from 'react';

class SelectionMenu extends React.Component {
  handleColorPick = (event) => {
    this.props.onColorPick(event.screenX, event.screenY)
  }

  render() {
    let { color } = this.props;
    return (
      <div className="selection-menu">
        <button
          className="toolbarButton global-color"
          style={{ color }}
          onClick={this.handleColorPick}
        />
        <button
          className="toolbarButton global-color"
          style={{ color }}
          onClick={this.handleColorPick}
        />
        <button
          className="toolbarButton global-color"
          style={{ color }}
          onClick={this.handleColorPick}
        />
        <button
          className="toolbarButton global-color"
          style={{ color }}
          onClick={this.handleColorPick}
        />
        <button
          className="toolbarButton global-color"
          style={{ color }}
          onClick={this.handleColorPick}
        />
      </div>
    );
  }
}

export default SelectionMenu;
