export function debounce<F extends CallableFunction>(func: F, wait?: number, options?: {
	leading?: boolean;
	maxWait?: number;
	trailing?: boolean;
}): F;
