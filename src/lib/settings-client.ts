/**
 * settings-client.ts — the one way browser code saves user settings.
 *
 * Every page that changes a setting (a slider, the board size, the tutorial
 * step, the puzzle goal) goes through patchSettings(), so each save checks the
 * response and none of them can leave an unhandled rejection behind. It never
 * throws: callers that show an error read the boolean, and fire-and-forget
 * callers (board resizing) can ignore it.
 */

import type { z } from 'zod';
// Type-only: erased at build time, so no server code reaches the browser.
import type { updateSettingsSchema } from '$lib/server/schemas/settings';

/** The fields PATCH /api/settings accepts; send only the ones that changed. */
export type SettingsPatch = z.input<typeof updateSettingsSchema>;

/** Saves the given settings. Resolves to true on success, false on any failure. */
export async function patchSettings(patch: SettingsPatch): Promise<boolean> {
	try {
		const res = await fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Saves the board size after the user drags the resize handle. The board
 * already shows the new size, so a failed save only means it is forgotten on
 * the next visit; nothing on screen needs to change.
 */
export function saveBoardSize(size: number): void {
	void patchSettings({ boardSize: size });
}
