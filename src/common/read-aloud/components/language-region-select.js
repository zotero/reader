import React, { useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import CustomSelect from '../../components/common/custom-select';

function LanguageRegionSelect({ languages, lang, onLangChange, tabIndex }) {
	const { l10n } = useLocalization();

	let displayNames = useMemo(() => new Intl.DisplayNames(undefined, {
		type: 'language',
		languageDisplay: 'standard',
	}), []);

	let baseDisplayNames = useMemo(() => new Intl.DisplayNames(undefined, {
		type: 'language',
		languageDisplay: 'standard',
	}), []);

	let options = useMemo(() => {
		// Count how many entries share each base language
		let baseCounts = new Map();
		for (let language of languages) {
			let base = language.replace(/-.+$/, '');
			baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
		}

		let result = [];
		for (let language of languages) {
			let base = language.replace(/-.+$/, '');
			let hasMultipleRegions = baseCounts.get(base) > 1;

			// Use full label (with region) only when there are multiple
			// regions for the same base language
			let label;
			try {
				label = hasMultipleRegions
					? displayNames.of(language)
					: baseDisplayNames.of(base);
			}
			catch {
				continue;
			}
			if (!label) continue;
			result.push({ value: language, label });
		}

		return result.sort((a, b) => a.label.localeCompare(b.label));
	}, [languages, displayNames, baseDisplayNames]);

	return (
		<CustomSelect
			aria-label={l10n.getString('reader-read-aloud-language')}
			value={lang}
			tabIndex={tabIndex}
			onChange={onLangChange}
			options={options}
		/>
	);
}

export default LanguageRegionSelect;
