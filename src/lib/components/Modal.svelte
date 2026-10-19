<!--
	Modal — the one dialog shell every modal in the app is built on.

	It uses the native <dialog> opened with showModal(), which gives what the
	hand-made backdrops never had: focus moves into the dialog and is trapped
	there, the page behind is inert, Escape closes it, and it sits in the top
	layer above the fixed header. When it closes, focus goes back to whatever
	opened it.

	Props:
	  open — bindable; true shows the dialog. A modal rendered inside an {#if}
	         can simply pass open={true} and leave closing to onclose.
	  title — the heading, a string or a snippet (for markup such as a move
	          in bold); it also names the dialog for screen readers.
	  onclose — called when the user closes it (Escape, the ✕, the backdrop),
	            not when the parent sets open to false itself.
	  dismissible — false while something is in flight, so Escape and the
	                backdrop leave it open (default true).
	  danger — red heading for destructive confirmations.
	  width — the panel's width on screens wider than a phone (default 420px).

	Content goes in the children. These classes are styled here for every
	modal: .modal-actions (the button row), .modal-btn with --cancel,
	--primary or --danger, and .modal-error.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		onclose,
		dismissible = true,
		danger = false,
		width = '420px',
		children
	}: {
		open?: boolean;
		title: string | Snippet;
		onclose?: () => void;
		dismissible?: boolean;
		danger?: boolean;
		width?: string;
		children: Snippet;
	} = $props();

	const titleId = $props.id();
	let dialog = $state<HTMLDialogElement>();
	// Whatever had focus before the dialog opened, to hand focus back to.
	let opener: HTMLElement | null = null;

	function restoreFocus() {
		if (opener?.isConnected) opener.focus();
		opener = null;
	}

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			dialog.showModal();
			// The browser focuses the first focusable element, which is the ✕.
			// A form field is the more useful start; a plain confirmation keeps
			// the ✕ so Enter can't confirm by accident.
			dialog
				.querySelector<HTMLElement>(
					'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)'
				)
				?.focus();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	// A modal inside an {#if} is removed without closing; still give focus back.
	$effect(() => () => restoreFocus());

	function requestClose() {
		if (!dismissible) return;
		dialog?.close();
	}

	// Fires however the dialog closed. Only a close the parent didn't ask for
	// (open still true) is reported through onclose.
	function handleClose() {
		const closedByUser = open;
		open = false;
		restoreFocus();
		if (closedByUser) onclose?.();
	}

	function handleCancel(e: Event) {
		// Escape: the browser closes the dialog unless we refuse.
		if (!dismissible) e.preventDefault();
	}

	// The dialog element itself only receives clicks outside the panel, on the backdrop.
	function handleClick(e: MouseEvent) {
		if (e.target === dialog) requestClose();
	}
</script>

<!-- Escape is handled natively by <dialog>; the click handler only catches backdrop clicks.
     Keys stop here so page shortcuts (e.g. Build's arrow keys) don't fire behind the dialog. -->
<dialog
	bind:this={dialog}
	class="modal-dialog"
	aria-labelledby={titleId}
	onclose={handleClose}
	oncancel={handleCancel}
	onclick={handleClick}
	onkeydown={(e) => e.stopPropagation()}
	style:--modal-width={width}
>
	<div class="modal-panel">
		<div class="modal-header">
			<h2 id={titleId} class="modal-title" class:danger>
				{#if typeof title === 'string'}{title}{:else}{@render title()}{/if}
			</h2>
			<button
				type="button"
				class="modal-close"
				onclick={requestClose}
				disabled={!dismissible}
				aria-label="Close">✕</button
			>
		</div>
		<!-- Content exists only while open, so a closed modal's fields aren't in
		     the page (where they would clash with the page's own, by label or id). -->
		{#if open}
			{@render children()}
		{/if}
	</div>
</dialog>

<style>
	.modal-dialog {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		width: var(--modal-width);
		max-width: calc(100vw - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow: visible;
	}

	.modal-dialog::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}

	.modal-panel {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-6);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-family: var(--font-body);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.modal-title {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.modal-title.danger {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-danger);
	}

	.modal-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 12px;
		cursor: pointer;
		padding: 2px 4px;
		line-height: 1;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.modal-close:hover:not(:disabled) {
		color: var(--color-text-primary);
	}

	.modal-close:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* ── Shared content styles for every modal ── */

	.modal-panel :global(.modal-actions) {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.modal-panel :global(.modal-btn) {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			box-shadow var(--dur-fast) var(--ease-snap);
	}

	.modal-panel :global(.modal-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.modal-panel :global(.modal-btn--cancel) {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.modal-panel :global(.modal-btn--cancel:hover:not(:disabled)) {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.modal-panel :global(.modal-btn--primary) {
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		color: var(--color-base);
		font-weight: 600;
	}

	.modal-panel :global(.modal-btn--primary:hover:not(:disabled)) {
		box-shadow: var(--glow-accent);
	}

	.modal-panel :global(.modal-btn--danger) {
		background: var(--color-danger-fill);
		border: 1px solid var(--color-danger);
		color: #fff;
		font-weight: 600;
	}

	.modal-panel :global(.modal-btn--danger:hover:not(:disabled)) {
		box-shadow: 0 0 12px rgba(248, 113, 113, 0.4);
	}

	.modal-panel :global(.modal-btn:active:not(:disabled)) {
		transform: scale(0.97);
	}

	.modal-panel :global(.modal-error) {
		margin: 0;
		font-size: 13px;
		color: var(--color-danger);
	}

	/* ── Tablets and phones (< 768px) ── --bp-md */
	@media (max-width: 767px) {
		.modal-panel :global(.modal-btn) {
			min-height: 44px;
		}

		.modal-close {
			min-width: 44px;
			min-height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
		}
	}

	/* ── Small phones (< 480px): a full-screen sheet ── --bp-sm */
	@media (max-width: 479px) {
		.modal-dialog {
			width: 100%;
			max-width: 100%;
			height: 100%;
			max-height: 100%;
			margin: 0;
		}

		.modal-panel {
			height: 100%;
			max-height: 100%;
			border-radius: 0;
			padding-top: var(--space-8);
		}
	}
</style>
