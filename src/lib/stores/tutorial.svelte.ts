// The current tutorial step, shared by the overlay and the pages that move
// the tutorial on (Build, Drill, onboarding, Settings).
//
// The root layout seeds it from data.settings.tutorialStep. Advancing updates
// it at once and saves in the background, so a page can move the tutorial on
// without reloading its data (which would, for example, reset a drill).
//
// null  = tutorial completed or skipped (no overlay shown)
// 0–N   = index into TUTORIAL_STEPS

import { patchSettings } from '$lib/settings-client';
import { stepIndex, type TutorialStepId } from '$lib/components/tutorial/tutorialSteps';

let step = $state<number | null>(null);
// Saves still in flight. Page data loaded meanwhile may predate the save, so
// sync() leaves the local step alone until they finish.
let saving = 0;

export const tutorial = {
	get step() {
		return step;
	},

	/** Whether the tutorial is on the given step. */
	isAt(id: TutorialStepId): boolean {
		return step === stepIndex(id);
	},

	/** Takes the step from freshly loaded page data. */
	sync(serverStep: number | null | undefined) {
		if (saving === 0) step = serverStep ?? null;
	},

	/**
	 * Moves to a step (or ends the tutorial with null) and saves it. Resolves
	 * to false when the save failed; the step still changes on screen, and the
	 * next full page load picks up whatever the server kept.
	 */
	async goTo(next: TutorialStepId | number | null): Promise<boolean> {
		step = typeof next === 'string' ? stepIndex(next) : next;
		saving++;
		try {
			return await patchSettings({ tutorialStep: step });
		} finally {
			saving--;
		}
	}
};
