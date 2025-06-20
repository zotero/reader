import React from 'react';

import cx from 'classnames';

import IconChevronDown8 from '../../../../res/icons/8/chevron-8.svg';

function Select({ className, children, ...rest }) {
	return (
		<div className={cx('select', className)}>
			<select {...rest}>
				{children}
			</select>
			<IconChevronDown8 className="chevron"/>
		</div>
	);
}

export default Select;
