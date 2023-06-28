export function debounce<F extends () => void>(func: F, wait?: number, options?: {
	leading?: boolean;
	maxWait?: number;
	trailing?: boolean;
}): F;
