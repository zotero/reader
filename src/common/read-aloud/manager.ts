import { Position, ReadAloudGranularity, ReadAloudSegment } from '../types';
import { ErrorState, ReadAloudController, ReadAloudEvent } from './controller';
import { getSupportedLanguages, getVoiceRegion, getVoicesForLanguage, ReadAloudVoice, Tier } from './voice';
import { RemoteReadAloudProvider } from './remote/provider';
import { BrowserReadAloudProvider } from './browser/provider';
import { RemoteInterface } from './remote';
import { getBaseLanguage, getPreferredRegion, resolveLanguage } from './lang';

const URGENT_THRESHOLD_MINUTES = 3;

type PersistedVoiceData = {
	voice?: string;
	region?: string;
	speed?: number;
	tierVoices?: Record<string, string>;
};

export type ReadAloudManagerOptions = {
	remoteInterface: RemoteInterface | null;
	onStateChange: () => void;
	onRequestSegments: () => void;
	onComputeRepositionIndex: (position: Position) => number | null;
	onSetVoice: (data: { lang: string, region: string | null, voice: string, speed: number, tier: string | null }) => void;
};

/**
 * Owns the Read Aloud engine lifecycle: controller creation/destruction,
 * voice resolution, credit polling, and playback state.
 * Does not know about React or the DOM.
 */
export class ReadAloudManager {
	private _options: ReadAloudManagerOptions;

	// Engine
	private _controller: ReadAloudController | null = null;

	private _voice: ReadAloudVoice | null = null;

	// Segments
	private _segments: ReadAloudSegment[] | null = null;

	private _backwardStopIndex: number | null = null;

	private _forwardStopIndex: number | null = null;

	/**
	 * Transient target position for initial segment computation.
	 * Set before activation, consumed by _composeReadAloudStateSnapshot,
	 * then cleared.
	 */
	private _targetPosition: Position | null = null;

	// Playback state
	private _active = false;

	private _paused = true;

	private _speed = 1;

	private _activeSegment: ReadAloudSegment | null = null;

	private _lastSkipGranularity: 'sentence' | 'paragraph' | null = null;

	private _buffering = false;

	private _error: ErrorState | null = null;

	// Voice catalog
	private _allVoices: ReadAloudVoice[] = [];

	private _selectedTier: Tier | null = null;

	private _lang: string | null = null;

	private _region: string | null = null;

	private _voiceID: string | null = null;

	private _segmentGranularity: ReadAloudGranularity | null = null;

	private _devMode = false;

	private _persistedVoices: PersistedVoiceData = {};

	private _pendingSetVoice = false;

	// Periodic server refresh for credit balance
	private _creditRefreshInterval: ReturnType<typeof setInterval> | null = null;

	constructor(options: ReadAloudManagerOptions) {
		this._options = options;
	}

	get active(): boolean {
		return this._active;
	}

	get paused(): boolean {
		return this._paused;
	}

	get speed(): number {
		return this._speed;
	}

	get activeSegment(): ReadAloudSegment | null {
		return this._activeSegment;
	}

	get lastSkipGranularity(): 'sentence' | 'paragraph' | null {
		return this._lastSkipGranularity;
	}

	get buffering(): boolean {
		return this._buffering;
	}

	get error(): ErrorState | null {
		return this._error;
	}

	get segments(): ReadAloudSegment[] | null {
		return this._segments;
	}

	get minutesRemaining(): number | null {
		return this._controller?.minutesRemaining ?? null;
	}

	get isQuotaExceeded(): boolean {
		return this._controller?.error === 'quota-exceeded';
	}

	get isQuotaLow(): boolean {
		return this.isQuotaExceeded
			|| (this.minutesRemaining !== null && this.minutesRemaining < URGENT_THRESHOLD_MINUTES);
	}

	get hasStandardMinutesRemaining(): boolean {
		return this._controller?.hasStandardMinutesRemaining ?? false;
	}

	get segmentGranularity(): ReadAloudGranularity | null {
		return this._segmentGranularity;
	}

	get lang(): string | null {
		return this._lang;
	}

	get region(): string | null {
		return this._region;
	}

	get selectedVoiceID(): string | null {
		return this._voiceID;
	}

	get selectedTier(): Tier | null {
		return this._selectedTier;
	}

	get allVoices(): ReadAloudVoice[] {
		return this._allVoices;
	}

	get devMode(): boolean {
		return this._devMode;
	}

	get voices(): ReadAloudVoice[] {
		return this._allVoices.filter(
			v => this._selectedTier === null || v.tier === this._selectedTier
		);
	}

	get languages(): string[] {
		return getSupportedLanguages(this.voices);
	}

	get currentVoiceRegion(): string | null {
		let voice = this._allVoices.find(v => v.id === this._voiceID);
		return voice ? getVoiceRegion(voice) : null;
	}

	get voicesForLanguage(): ReadAloudVoice[] {
		let region = this.currentVoiceRegion ?? this._region;
		let lang = region ? `${this._lang}-${region}` : this._lang;
		return getVoicesForLanguage(this.voices, lang ?? '');
	}

	get tiers(): Set<Tier> {
		return new Set(this._allVoices.map(v => v.tier));
	}

	get targetPosition(): Position | null {
		return this._targetPosition;
	}

	setTargetPosition(position: Position | null): void {
		this._targetPosition = position;
	}

	consumeTargetPosition(): Position | undefined {
		let pos = this._targetPosition ?? undefined;
		this._targetPosition = null;
		return pos;
	}

	async loadVoices(loadRemote: boolean): Promise<void> {
		let remoteProvider = this._options.remoteInterface
			? new RemoteReadAloudProvider(this._options.remoteInterface)
			: null;
		let browserProvider = new BrowserReadAloudProvider();

		let handleError = (e: unknown) => {
			console.error(e);
			return [] as ReadAloudVoice[];
		};
		let [remoteVoices, browserVoices] = await Promise.all([
			loadRemote && remoteProvider ? remoteProvider.getVoices().catch(handleError) : [],
			browserProvider.getVoices().catch(handleError),
		]);
		this._allVoices = [...remoteVoices, ...browserVoices];
		this._devMode = remoteProvider?.devMode ?? false;

		this._resolveVoice();
		this._stateChanged();
	}

	/**
	 * Set the language. If the language actually changed, clears the
	 * current voice and re-resolves.
	 */
	setLanguage(lang: string, { region = null, persist = false }: { region?: string | null, persist?: boolean } = {}): void {
		let base = getBaseLanguage(lang);
		if (base === this._lang && region === this._region) {
			return;
		}
		this._lang = base;
		this._region = region;
		this._voiceID = null;
		if (persist) {
			this._pendingSetVoice = true;
		}
		if (this._allVoices.length) {
			this._resolveVoice();
		}
		this._stateChanged();
	}

	selectVoice(voiceID: string): void {
		this._voiceID = voiceID;
		this._applyVoice();
		this._persistCurrentVoice();
		this._stateChanged();
	}

	selectTier(tier: Tier): void {
		this._selectedTier = tier;
		// Preserve the current region so the fallback logic tries to
		// match it in the new tier
		this._region = this.currentVoiceRegion ?? this._region;
		// Restore persisted voice for this tier, if any
		this._voiceID = this._persistedVoices.tierVoices?.[tier] ?? null;
		this._pendingSetVoice = true;
		this._resolveVoice();
		this._stateChanged();
	}

	applyPersistedVoices(persisted: PersistedVoiceData): void {
		this._persistedVoices = persisted;
		// Clear current voice and tier so _resolveVoice re-evaluates
		// from scratch using the new persisted preferences
		this._voiceID = null;
		this._selectedTier = null;
		this._resolveVoice();
		this._stateChanged();
	}

	setSpeed(speed: number, persist = false): void {
		this._speed = speed;
		if (this._controller && this._controller.speed !== speed) {
			this._controller.speed = speed;
		}
		if (persist) {
			this._persistCurrentVoice();
		}
		this._stateChanged();
	}

	/**
	 * Persist the current voice preferences via the onSetVoice callback.
	 */
	private _persistCurrentVoice(): void {
		if (!this._voiceID) return;
		let voice = this._allVoices.find(v => v.id === this._voiceID);
		let tier = this._selectedTier || voice?.tier || null;
		let region = voice ? getVoiceRegion(voice) : null;
		this._options.onSetVoice({
			lang: getBaseLanguage(this._lang ?? ''),
			region,
			voice: this._voiceID,
			speed: this._speed,
			tier,
		});
	}

	/**
	 * Resolve the best voice for the current language/tier/persisted preferences.
	 * Mirrors the fallback logic formerly in ReadAloudPopup's fallbackVoiceID useMemo
	 * and voice selection useEffect.
	 */
	private _resolveVoice(): void {
		// If no language yet, wait for the view to report one
		if (!this._lang) {
			return;
		}

		// Cache tier-filtered voices to avoid redundant getter evaluations
		let tierVoices = this.voices;
		let languages = getSupportedLanguages(tierVoices);

		// Compute candidate voices from the base language, not from
		// currentVoiceRegion - voice could've been set before lang changed
		let lang = this._region ? `${this._lang}-${this._region}` : this._lang;
		let voicesForLang = getVoicesForLanguage(tierVoices, lang);

		// Reset language if it's no longer available
		let baseLang = getBaseLanguage(this._lang);
		if (languages.length && !languages.some(l => getBaseLanguage(l) === baseLang)) {
			let resolved = resolveLanguage(this._lang, languages) || languages[0];
			this._lang = getBaseLanguage(resolved);
			this._region = null;
			this._voiceID = null;
			lang = this._lang;
			voicesForLang = getVoicesForLanguage(tierVoices, lang);
		}

		// Fall back to local when selected tier becomes unavailable
		let tiers = this.tiers;
		if (this._selectedTier !== null && !tiers.has(this._selectedTier) && tiers.has('local')) {
			this._selectedTier = 'local';
		}

		// If current voice is still valid, keep it
		let voiceResolved = false;
		if (this._voiceID && voicesForLang.some(v => v.id === this._voiceID)) {
			this._applyVoice();
			voiceResolved = true;
		}
		// Otherwise, find a fallback
		else if (voicesForLang.length) {
			let voiceID = this._findFallbackVoice(voicesForLang) ?? voicesForLang[0].id;
			if (voiceID !== this._voiceID) {
				this._voiceID = voiceID;
				this._applyVoice();
			}
			voiceResolved = true;
		}

		// Persist if this change was initiated by the user
		if (voiceResolved && this._pendingSetVoice) {
			this._pendingSetVoice = false;
			this._persistCurrentVoice();
		}
	}

	private _findFallbackVoice(voicesForLang: ReadAloudVoice[]): string | null {
		let { voice: persistedVoice, region: persistedRegion, tierVoices: persistedTierVoices }
			= this._persistedVoices;

		let targetTier = this._selectedTier;
		if (!targetTier && persistedTierVoices) {
			let persistedTier = Object.keys(persistedTierVoices).pop();
			if (persistedTier) {
				targetTier = persistedTier as Tier;
			}
		}

		// Stay within targetTier unless it has no voices for this language
		let pool = targetTier
			? voicesForLang.filter(v => v.tier === targetTier)
			: voicesForLang;
		if (!pool.length) {
			pool = voicesForLang;
		}
		let isAvailable = (id: string | undefined) => id && pool.some(v => v.id === id);

		// Skip persisted voice when user explicitly selected a different region
		let regionChanged = this._region && persistedRegion && this._region !== persistedRegion;

		// 1. Tier-specific voice for this language
		if (!regionChanged && isAvailable(persistedTierVoices?.[targetTier as string])) {
			return persistedTierVoices![targetTier as string];
		}
		// 2. Last-used voice for this language
		if (!regionChanged && isAvailable(persistedVoice)) {
			return persistedVoice!;
		}
		// 3. First voice matching the selected, persisted, or preferred region
		let region = this._region || persistedRegion || getPreferredRegion(this._lang ?? '');
		if (region) {
			let regionMatch = pool.find(v => getVoiceRegion(v) === region);
			if (regionMatch) {
				return regionMatch.id;
			}
		}
		return null;
	}

	/**
	 * Apply the current _voiceID: find the voice object, update segment granularity,
	 * and recreate the controller if segments exist.
	 */
	private _applyVoice(): void {
		let voice = this._allVoices.find(v => v.id === this._voiceID);
		if (!voice || !this.voicesForLanguage.some(v => v.id === this._voiceID)) {
			this._voice = null;
			this._destroyController();
			return;
		}

		// Always update the voice fields so activate() can use them
		let granularityChanged = voice.segmentGranularity !== this._segmentGranularity;
		this._voice = voice;
		this._segmentGranularity = voice.segmentGranularity;
		this._selectedTier = voice.tier;

		// Only request segments / create controller when active.
		// When not active, the caller (activate/play) will do this
		// after setting _active.
		if (!this._active) {
			return;
		}

		if (!this._segments || granularityChanged) {
			// Request (re)computation of segments from the view
			this._segments = null;
			this._options.onRequestSegments();
		}
		else {
			// Same granularity, segments exist: recreate controller with new voice
			this._createController();
		}
	}

	clearSegments(): void {
		this._segments = null;
		this._backwardStopIndex = null;
		this._forwardStopIndex = null;
		this._activeSegment = null;
		this._destroyController();
	}

	setSegments(
		segments: ReadAloudSegment[],
		backwardStopIndex: number | null,
		forwardStopIndex: number | null,
	): void {
		this._segments = segments;
		this._backwardStopIndex = backwardStopIndex;
		this._forwardStopIndex = forwardStopIndex;
		this._createController();
		this._stateChanged();
	}

	activate(): void {
		if (!this._voice) return;
		this._active = true;
		this._paused = false;
		this._segmentGranularity = this._voice.segmentGranularity;
		this._options.onRequestSegments();
		this._stateChanged();
	}

	play(): void {
		if (!this._active) {
			this.activate();
			return;
		}
		this._paused = false;
		if (this._controller) {
			this._controller.paused = false;
		}
		this._stateChanged();
	}

	pause(): void {
		this._paused = true;
		if (this._controller) {
			this._controller.paused = true;
		}
		this._stateChanged();
	}

	togglePaused(): void {
		if (this._paused) {
			this.play();
		}
		else {
			this.pause();
		}
	}

	skipBack(granularity: 'sentence' | 'paragraph' = 'paragraph', accelerate = false): void {
		this._controller?.skipBack(granularity, accelerate);
	}

	skipAhead(granularity: 'sentence' | 'paragraph' = 'paragraph', accelerate = false): void {
		this._controller?.skipAhead(granularity, accelerate);
	}

	getSegmentToAnnotate(): ReadAloudSegment | null {
		return this._controller?.getSegmentToAnnotate() ?? null;
	}

	retry(): void {
		if (this._controller?.retry) {
			this._paused = false;
			this._controller.retry();
			this._stateChanged();
		}
	}

	/**
	 * Jump to a position within existing segments.
	 * No-op if not active or segments haven't been computed yet.
	 */
	jumpTo(position: Position): void {
		if (!this._segments || !this._active) {
			return;
		}
		let index = this._options.onComputeRepositionIndex(position);
		if (index !== null) {
			this.repositionTo(index);
		}
	}

	/**
	 * Reposition the controller to a new segment index without full
	 * segment recomputation.
	 */
	repositionTo(backwardStopIndex: number): void {
		this._backwardStopIndex = backwardStopIndex;
		this._forwardStopIndex = null;
		this._paused = false;
		this._activeSegment = null;
		this._createController();
		this._stateChanged();
	}

	async refreshCreditsRemaining(): Promise<void> {
		if (this._controller) {
			await this._controller.refreshCreditsRemaining();
			this._stateChanged();
		}
	}

	async resetCredits(): Promise<void> {
		if (this._controller) {
			await this._controller.resetCredits();
			this._stateChanged();
		}
	}

	private _startCreditRefresh(): void {
		this._stopCreditRefresh();
		this._creditRefreshInterval = setInterval(() => {
			this.refreshCreditsRemaining();
		}, 60_000);
	}

	private _stopCreditRefresh(): void {
		if (this._creditRefreshInterval !== null) {
			clearInterval(this._creditRefreshInterval);
			this._creditRefreshInterval = null;
		}
	}

	private _createController(): void {
		this._destroyController();

		if (!this._voice || !this._segments) {
			return;
		}

		// If the active segment is still in the segment list, start from it
		let backwardStopIndex = this._backwardStopIndex;
		if (this._segments && this._activeSegment && this._segments.includes(this._activeSegment)) {
			backwardStopIndex = this._segments.indexOf(this._activeSegment);
		}

		let controller = this._voice.getController(
			this._segments,
			backwardStopIndex,
			this._forwardStopIndex,
		);

		this._controller = controller;
		this._error = null;

		// Sync speed
		if (controller.speed !== this._speed) {
			controller.speed = this._speed;
		}

		// Wire up event listeners
		controller.addEventListener('BufferingChange', () => {
			this._buffering = controller.buffering;
			this._stateChanged();
		});
		controller.addEventListener('ActiveSegmentChanging', (event: Event) => {
			this._activeSegment = (event as ReadAloudEvent).segment;
			this._lastSkipGranularity = controller.lastSkipGranularity;
			this._stateChanged();
		});
		controller.addEventListener('ActiveSegmentChange', (event: Event) => {
			this._activeSegment = (event as ReadAloudEvent).segment;
			this._lastSkipGranularity = controller.lastSkipGranularity;
			this._stateChanged();
		});
		controller.addEventListener('Complete', () => {
			this._paused = true;
			this._activeSegment = null;
			this._stateChanged();
		});
		controller.addEventListener('Error', () => {
			this._paused = true;
			this._error = controller.error;
			this._stateChanged();
		});
		controller.addEventListener('ErrorCleared', () => {
			this._error = null;
			this._stateChanged();
		});

		// Start credit polling
		this._startCreditRefresh();

		// Sync paused state
		controller.paused = this._paused;
	}

	private _destroyController(): void {
		if (this._controller) {
			this._controller.destroy();
			this._controller = null;
			this._buffering = false;
		}
		this._stopCreditRefresh();
	}

	deactivate(): void {
		this._active = false;
		this._paused = true;
		this._segments = null;
		this._backwardStopIndex = null;
		this._forwardStopIndex = null;
		this._activeSegment = null;
		this._lastSkipGranularity = null;
		this._error = null;
		this._destroyController();
		this._stateChanged();
	}

	private _stateChangePending = false;

	private _stateChanged(): void {
		if (!this._stateChangePending) {
			this._stateChangePending = true;
			queueMicrotask(() => {
				this._stateChangePending = false;
				this._options.onStateChange();
			});
		}
	}

	destroy(): void {
		this._destroyController();
	}
}
