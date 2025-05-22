import { PageWidth, ReflowableAppearance } from "./dom-view";

export const DEFAULT_REFLOWABLE_APPEARANCE: ReflowableAppearance = Object.freeze({
	lineHeight: 1.2,
	wordSpacing: 0,
	letterSpacing: 0,
	pageWidth: PageWidth.Normal,
	useOriginalFont: false,
});
