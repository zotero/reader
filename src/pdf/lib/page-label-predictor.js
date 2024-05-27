
function arabicToRoman(num) {
	const romanKeys = {
		M: 1000,
		CM: 900,
		D: 500,
		CD: 400,
		C: 100,
		XC: 90,
		L: 50,
		XL: 40,
		X: 10,
		IX: 9,
		V: 5,
		IV: 4,
		I: 1
	};
	let roman = '';

	for (let key in romanKeys) {
		while (num >= romanKeys[key]) {
			roman += key;
			num -= romanKeys[key];
		}
	}

	return roman;
}

export function predictPageLabels(pdfPages, pagesCount, pdfPageLabels) {
	let pageLabels = [];

	if (!pdfPageLabels || !pdfPageLabels.length) {
		for (let i = 0; i < pagesCount; i++) {
			pageLabels[i] = i + 1;
		}
		return pageLabels;
	}

	for (let i = 0; i < pagesCount; i++) {
		pageLabels[i] = '-';
	}

	let allPageLabels = Object.values(pdfPages).map(x => x.pageLabel).filter(x => x).sort((a, b) => a.pageIndex - b.pageIndex);

	if (
		pdfPageLabels
		&& pdfPageLabels.length === pagesCount
		&& allPageLabels[0]
		&& pdfPageLabels[allPageLabels[0].pageIndex] === allPageLabels[0].chars.map(x => x.u).join('')
	) {
		for (let i = 0; i < pagesCount; i++) {
			pageLabels[i] = pdfPageLabels[i];
		}
	}

	let firstArabicPageLabel = Object.values(pdfPages).map(x => x.pageLabel).filter(x => x).filter(x => x.type === 'arabic')[0];

	if (firstArabicPageLabel) {
		let startInteger = firstArabicPageLabel.integer - firstArabicPageLabel.pageIndex;
		for (let i = 0; i < pagesCount; i++) {
			if (startInteger + i >= 1) {
				pageLabels[i] = (startInteger + i).toString();
			}
		}
	}
	return pageLabels;
}
