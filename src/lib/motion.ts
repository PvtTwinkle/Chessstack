// The global reduced-motion rule in +layout.svelte only shortens CSS
// animations and transitions. Motion started from script (Chessground's piece
// animation, smooth scrolling) has to ask for itself.

/** Whether the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

/** The scroll behaviour to pass to scrollIntoView/scrollTo. */
export function scrollBehavior(): ScrollBehavior {
	return prefersReducedMotion() ? 'auto' : 'smooth';
}
