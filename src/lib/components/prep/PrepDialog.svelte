<!--
	PrepDialog — the modal used by the prep pages.

	A native <dialog> opened with showModal(), so the browser handles what a
	hand-made overlay got wrong: it is announced as a dialog, focus moves into
	it and can't leave it, the page behind is inert (the board's arrow keys
	included), and Escape closes it. Focus goes back to whatever opened it.
	Clicking the backdrop closes it too.
-->

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The dialog's heading, which is also its accessible name. */
		title: string;
		/** Called when the dialog asks to close (Escape, backdrop, a Cancel button). */
		onClose: () => void;
		/** Wider layout for longer content. */
		wide?: boolean;
		/** Ignores Escape and backdrop clicks while something is in progress. */
		busy?: boolean;
		children: Snippet;
	}

	let { title, onClose, wide = false, busy = false, children }: Props = $props();

	const id = $props.id();
	let dialog: HTMLDialogElement;

	$effect(() => {
		const opener = document.activeElement as HTMLElement | null;
		dialog.showModal();
		return () => {
			dialog.close();
			opener?.focus();
		};
	});

	function handleCancel(e: Event) {
		// Escape: let the parent decide, so its state stays the source of truth.
		e.preventDefault();
		if (!busy) onClose();
	}

	function handleClick(e: MouseEvent) {
		// A click on the dialog element itself (not its content) is the backdrop.
		if (e.target === dialog && !busy) onClose();
	}
</script>

<dialog
	bind:this={dialog}
	class="prep-dialog"
	class:wide
	aria-labelledby="{id}-title"
	oncancel={handleCancel}
	onclick={handleClick}
>
	<div class="dialog-body">
		<h3 id="{id}-title">{title}</h3>
		{@render children()}
	</div>
</dialog>

<style>
	.prep-dialog {
		padding: 0;
		background: var(--color-surface);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		width: 400px;
		max-width: calc(100vw - 2rem);
	}

	.prep-dialog.wide {
		width: 560px;
	}

	.prep-dialog::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}

	.dialog-body {
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
</style>
