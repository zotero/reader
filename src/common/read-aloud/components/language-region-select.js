import React, { useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import CustomSelect from '../../components/common/custom-select';

function LanguageRegionSelect({ languages, lang, onLangChange, tabIndex }) {
	const { l10n } = useLocalization();

	let displayNames = useMemo(() => new Intl.DisplayNames(undefined, {
		type: 'language',
		languageDisplay: 'standard',
	}), []);

	let options = useMemo(() => {
		let result = [];

		for (let language of languages) {
			let label;
			try {
				label = displayNames.of(language);
			}
			catch {
				continue;
			}
			if (!label) continue;
			result.push({ value: language, label });
		}

		// Merge entries that resolved to the same label (e.g. because
		// displayNames trimmed unrecognized subtags). The merged entry
		// keeps the longest common prefix of all its values' segments.
		let byLabel = new Map();
		for (let entry of result) {
			let existing = byLabel.get(entry.label);
			if (existing) {
				let a = existing.value.split('-');
				let b = entry.value.split('-');
				let common = [];
				for (let i = 0; i < Math.min(a.length, b.length); i++) {
					if (a[i] !== b[i]) break;
					common.push(a[i]);
				}
				existing.value = common.join('-') || existing.value;
			}
			else {
				byLabel.set(entry.label, entry);
			}
		}
		result = [...byLabel.values()];

		return result.sort((a, b) => a.label.localeCompare(b.label));
	}, [languages, displayNames]);

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
