<!--
	AnnotationModal — modal dialog for adding/editing move annotations.

	Shows a textarea with character count, save/cancel buttons, and error display.
	The backdrop click and Escape key both close the modal.

	Props:
	  move — the RepertoireMove being annotated (san is shown in the header)
	  draft — the current textarea value (bound two-way)
	  saving — true while a PATCH request is in-flight
	  error — error message to display, or null

	Events:
	  onSave() — called when the user clicks Save
	  onClose() — called when the user cancels or clicks outside
-->

<script lang="ts">
	import type { RepertoireMove } from './buildState.svelte';

	interface Props {
		move: RepertoireMove;
		draft: string;
		saving: boolean;
		error: string | null;
		onSave: () => void;
		onClose: () => void;
	}

	let { move, draft = $bindable(), saving, error, onSave, onClose }: Props = $props();
</script>

<div
	class="modal-backdrop"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div
		class="modal"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="modal-header">
			<span class="modal-title">Annotation — <strong>{move.san}</strong></span>
			<button class="modal-close" onclick={onClose} aria-label="Close">✕</button>
		</div>
		<textarea
			class="annotation-textarea"
			bind:value={draft}
			placeholder="Add a note about this move…"
			maxlength="500"
			rows="4"
			disabled={saving}></textarea>
		<div class="annotation-char-count">{draft.length}/500</div>
		{#if error}
			<p class="annotation-error">{error}</p>
		{/if}
		<div class="modal-actions">
			<button class="modal-btn modal-btn--cancel" onclick={onClose} disabled={saving}>
				Cancel
			</button>
			<button class="modal-btn modal-btn--save" onclick={onSave} disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-6);
		width: 360px;
		max-width: calc(100vw - 2rem);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-title {
		font-size: 13px;
		color: var(--color-text-secondary);
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

	.modal-close:hover {
		color: var(--color-text-primary);
	}

	.annotation-textarea {
		width: 100%;
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		line-height: 1.6;
		padding: var(--space-3);
		resize: vertical;
		box-sizing: border-box;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.annotation-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.annotation-textarea:disabled {
		opacity: 0.5;
	}

	.annotation-char-count {
		font-size: 11px;
		color: var(--color-text-muted);
		text-align: right;
		margin-top: calc(-1 * var(--space-2));
	}

	.annotation-error {
		font-size: 12px;
		color: var(--color-danger);
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.modal-btn {
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

	.modal-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.modal-btn--cancel {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.modal-btn--cancel:hover:not(:disabled) {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.modal-btn--save {
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		color: var(--color-base);
		font-weight: 600;
	}

	.modal-btn--save:hover:not(:disabled) {
		opacity: 0.88;
		box-shadow: var(--glow-accent);
	}

	.modal-btn--save:active:not(:disabled) {
		transform: scale(0.97);
	}

	/* ── Mobile touch targets ── --bp-md */
	@media (max-width: 767px) {
		.modal-btn {
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

	/* ── Full-screen modal on narrow phones ── --bp-sm */
	@media (max-width: 479px) {
		.modal {
			position: fixed;
			inset: 0;
			width: 100%;
			max-width: 100%;
			border-radius: 0;
			padding-top: var(--space-8);
		}

		/* Drag handle affordance */
		.modal::before {
			content: '';
			position: absolute;
			top: var(--space-2);
			left: 50%;
			transform: translateX(-50%);
			width: 36px;
			height: 4px;
			border-radius: 2px;
			background: var(--color-border);
		}
	}
</style>
