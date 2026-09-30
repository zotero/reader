// TEMP: Local voices make loud pops at the end of every utterance on macOS 27
// without a patch to libmozglue (a64e3671 in zotero/zotero) that would be
// risky to backport, so disable them.

let localVoicesUnavailable = false;

export function setLocalVoicesUnavailable(value: boolean): void {
	localVoicesUnavailable = value;
}

export function areLocalVoicesUnavailable(): boolean {
	return localVoicesUnavailable;
}
