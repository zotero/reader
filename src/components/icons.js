'use strict';

import React from 'react';

export function IconHighlight() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12">
			<path fill="currentColor" d="M12,5H0V3H12Zm0,1H0V8H12ZM9,9H0v2H9Zm3-9H3V2h9Z"/>
		</svg>
	);
}

export function IconNote() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12">
			<path fill="currentColor" d="M0,7H5v5ZM0,0V6H6v6h6V0Z"/>
		</svg>
	);
}

export function IconArea() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12">
			<path fill="currentColor" d="M2,7V2H7V7Zm8,2V7H9V9H7v1H9v2h1V10h2V9ZM1,1H9V6h1V0H0V10H6V9H1Z"/>
		</svg>
	);
}

export function IconInk() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12">
			<path
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeMiterlimit="4"
				stroke="currentColor"
				fill="none"
				d="M 11.075423,10.940982 C 2.1007834,10.74643 3.2046232,-0.13478446 9,1.2287624 11.152259,2.2537259 10.06085,4.0872195 9,4.5910025 6.1497195,6 2.0752684,4.9659656 0.95896126,1.3633774"
			/>
		</svg>
	);
}

export function IconNoteLarge() {
	return (
		<svg width="24" height="24" viewBox="0 0 24 24">
			<polygon fill="currentColor" points="0.5 0.5 23.5 0.5 23.5 23.5 11.5 23.5 0.5 12.5 0.5 0.5"/>
			<polygon points="0.5 12.5 11.5 12.5 11.5 23.5 0.5 12.5" fill="#fff" opacity="0.4"/>
			<path d="M0,0V12.707L11.293,24H24V0ZM11,22.293,1.707,13H11ZM23,23H12V12H1V1H23Z"/>
		</svg>
	);
}

export function IconColor({ color }) {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16">
			<rect
				shapeRendering="geometricPrecision"
				fill={color}
				strokeWidth="1"
				x="2"
				y="2"
				stroke="rgba(0, 0, 0, 0.08)"
				width="12"
				height="12"
				rx="3"
			/>
		</svg>
	);
}
