export interface ReflowableAppearance {
	lineHeight: number;
	wordSpacing: number;
	letterSpacing: number;
	pageWidth: PageWidth;
	useOriginalFont: boolean;
}

export const enum PageWidth {
	Narrow = -1,
	Normal = 0,
	Full = 1
}

export const DEFAULT_REFLOWABLE_APPEARANCE: ReflowableAppearance = Object.freeze({
	lineHeight: 1.2,
	wordSpacing: 0,
	letterSpacing: 0,
	pageWidth: PageWidth.Normal,
	useOriginalFont: false,
});
