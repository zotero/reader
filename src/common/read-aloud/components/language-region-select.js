import React, { useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import Select from '../../components/common/select';

function LanguageRegionSelect({ languages, regions, lang, region, onLangChange, onRegionChange, tabIndex }) {
	const { l10n } = useLocalization();

	let displayNames = useMemo(() => new Intl.DisplayNames(undefined, {
		type: 'language',
		languageDisplay: 'standard',
	}), []);

	let options = useMemo(() => {
		let result = [];

		for (let language of languages) {
			let langRegions = regions[language] || [];
			if (langRegions.length > 1) {
				result.push({
					value: language,
					label: `${displayNames.of(language)} (${l10n.getString('reader-read-aloud-region-auto')})`
				});
				for (let r of langRegions) {
					let code = `${language}-${r}`;
					result.push({
						value: code,
						label: displayNames.of(code),
					});
				}
			}
			else {
				result.push({
					value: language,
					label: displayNames.of(language)
				});
			}
		}

		return result.sort((a, b) => a.label.localeCompare(b.label));
	}, [languages, regions, displayNames, l10n]);

	function handleChange(event) {
		let newValue = event.target.value;

		// Check if it's just a language code with no region
		if (languages.includes(newValue)) {
			if (newValue !== lang) {
				onLangChange(newValue);
			}
			onRegionChange(null);
			return;
		}

		let [newLang, newRegion] = newValue.split('-');
		if (newLang !== lang) {
			onLangChange(newLang);
		}
		onRegionChange(newRegion);
	}

	return (
		<Select
			aria-label={l10n.getString('reader-read-aloud-language')}
			value={region ? `${lang}-${region}` : lang}
			tabIndex={tabIndex}
			onChange={handleChange}
		>
			{options.map(opt => (
				<option key={opt.value} value={opt.value}>{opt.label}</option>
			))}
		</Select>
	);
}

export default LanguageRegionSelect;
