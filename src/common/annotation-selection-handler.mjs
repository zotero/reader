function sameIDs(a, b) {
	return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function createAnnotationSelectionHandler({ select, notify, defer, getSelectedIDs }) {
	let pendingNotification = 0;
	return (ids, options = {}) => {
		// Any newer selection supersedes a deferred notification that hasn't fired yet
		let current = ++pendingNotification;

		if (!options.inlineTextEditing) {
			notify(ids, options);
			select(ids);
			return;
		}

		select(ids);
		defer(() => {
			if (current === pendingNotification && sameIDs(ids, getSelectedIDs())) {
				notify(ids, options);
			}
		});
	};
}
