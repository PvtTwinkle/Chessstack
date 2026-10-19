/**
 * sounds.ts — centralised audio playback for the chess trainer.
 *
 * All four sound effects (move, capture, correct, incorrect) are decoded into
 * Web Audio API AudioBuffers. This gives near-zero latency playback, which
 * matters for move sounds that should sync with piece animation.
 *
 * Usage:
 *   import { initSounds, setSoundEnabled, playMove, playCapture, playCorrect, playIncorrect } from '$lib/sounds';
 *
 *   // Call when a board page mounts; repeat calls cost nothing.
 *   initSounds();
 *
 *   // Reflect the user's saved preference.
 *   setSoundEnabled(data.settings?.soundEnabled ?? true);
 *
 *   // Then call play* wherever appropriate.
 *   playMove();
 *   playCapture();
 */

// ── Module-level state ─────────────────────────────────────────────────────

const SOUND_FILES = {
	move: '/sounds/move.mp3',
	capture: '/sounds/capture.mp3',
	correct: '/sounds/correct.mp3',
	incorrect: '/sounds/incorrect.mp3'
} as const;

type SoundName = keyof typeof SOUND_FILES;

// Single AudioContext shared across all sounds. Browsers limit how many
// AudioContexts can be created, so we reuse one for the lifetime of the page.
// It is only created on the user's first click or key press: a context made
// before any gesture starts suspended and Chrome logs an autoplay warning.
let ctx: AudioContext | null = null;

// Decoded audio buffers keyed by sound name. Empty until decoding finishes.
const buffers = new Map<SoundName, AudioBuffer>();

// Whether sounds should play at all. Controlled by setSoundEnabled().
let enabled = true;

// Set once a board page asked for sounds; loading waits until sound is on.
let wanted = false;

// The files' bytes, fetched once per page load however many board pages
// mount, and decoded once the AudioContext exists.
let fetched: Promise<Map<SoundName, ArrayBuffer>> | null = null;
let decoded: Promise<void> | null = null;

// ── Internal helpers ───────────────────────────────────────────────────────

function fetchAll(): Promise<Map<SoundName, ArrayBuffer>> {
	fetched ??= (async () => {
		const bytes = new Map<SoundName, ArrayBuffer>();
		await Promise.all(
			(Object.keys(SOUND_FILES) as SoundName[]).map(async (name) => {
				try {
					const response = await fetch(SOUND_FILES[name]);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					bytes.set(name, await response.arrayBuffer());
				} catch (err) {
					// Fail silently — the app works fine without sounds.
					console.warn(`[sounds] Failed to load "${name}":`, err);
				}
			})
		);
		return bytes;
	})();
	return fetched;
}

function decodeAll(ac: AudioContext): Promise<void> {
	decoded ??= (async () => {
		const bytes = await fetchAll();
		await Promise.all(
			[...bytes].map(async ([name, data]) => {
				try {
					buffers.set(name, await ac.decodeAudioData(data));
				} catch (err) {
					console.warn(`[sounds] Failed to decode "${name}":`, err);
				}
			})
		);
	})();
	return decoded;
}

// Creates the context inside the first gesture, then decodes the sounds.
function unlockOnGesture(): void {
	const unlock = () => {
		window.removeEventListener('pointerdown', unlock, true);
		window.removeEventListener('keydown', unlock, true);
		ctx ??= new AudioContext();
		void decodeAll(ctx);
	};
	window.addEventListener('pointerdown', unlock, true);
	window.addEventListener('keydown', unlock, true);
}

let unlockListening = false;

function startLoading(): void {
	if (!wanted || !enabled || typeof window === 'undefined') return;
	void fetchAll();
	if (ctx) void decodeAll(ctx);
	else if (!unlockListening) {
		unlockListening = true;
		unlockOnGesture();
	}
}

function playBuffer(name: SoundName, volume = 1): void {
	if (!enabled || !ctx) return;
	const buffer = buffers.get(name);
	if (!buffer) return;
	// Resume if the browser suspended the context (common on iOS/Safari).
	if (ctx.state === 'suspended') void ctx.resume();

	const source = ctx.createBufferSource();
	const gain = ctx.createGain();
	source.buffer = buffer;
	source.connect(gain);
	gain.connect(ctx.destination);
	gain.gain.value = volume;
	source.start();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Asks for the sounds. Call it when a board page mounts. Files are fetched
 * once per page load, and not at all while sound is switched off. It is safe
 * to call play* before they are ready — they simply no-op.
 */
export function initSounds(): void {
	wanted = true;
	// Pages call setSoundEnabled() right after this, so wait for the setting
	// before fetching anything.
	queueMicrotask(startLoading);
}

/** Enable or disable all sound effects (mirrors the user's saved setting). */
export function setSoundEnabled(value: boolean): void {
	enabled = value;
	if (enabled) startLoading();
}

/** Play the piece-moves sound (no capture). */
export function playMove(): void {
	playBuffer('move', 0.8);
}

/** Play the piece-capture sound. */
export function playCapture(): void {
	playBuffer('capture', 0.8);
}

/** Play the "correct answer" notification sound. */
export function playCorrect(): void {
	playBuffer('correct', 0.7);
}

/** Play the "wrong answer" error sound. */
export function playIncorrect(): void {
	playBuffer('incorrect', 0.7);
}
