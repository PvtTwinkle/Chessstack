<!--
	DeleteMoveModal — confirms deleting a saved move and everything after it.

	Says how many follow-up moves go with it, since their drill cards are
	deleted too. The backdrop click and Escape key both cancel.

	Props:
	  move — the RepertoireMove about to be deleted
	  subtreeCount — how many saved moves follow it

	Events:
	  onConfirm() — called when the user clicks Delete
	  onCancel() — called when the user cancels or clicks outside
-->

<script lang="ts">
	import type { RepertoireMove } from './buildState.svelte';

	interface Props {
		move: RepertoireMove;
		subtreeCount: number;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { move, subtreeCount, onConfirm, onCancel }: Props = $props();

	const totalCount = $derived(subtreeCount + 1);
</script>

<div
	class="modal-backdrop"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onclick={() => onCancel()}
	onkeydown={(e) => e.key === 'Escape' && onCancel()}
>
	<div
		class="modal"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="modal-header">
			<span class="modal-title">Delete <strong>{move.san}</strong>?</span>
			<button class="modal-close" onclick={() => onCancel()} aria-label="Close">✕</button>
		</div>
		<p class="delete-explanation">
			{#if subtreeCount === 0}
				This will permanently remove <strong>{move.san}</strong> from your repertoire. Any associated
				drill card will also be deleted.
			{:else}
				This will permanently remove <strong>{move.san}</strong> and
				<strong>{subtreeCount}</strong> follow-up {subtreeCount === 1 ? 'move' : 'moves'}
				({totalCount} total). All associated drill cards will also be deleted.
			{/if}
		</p>
		<div class="modal-actions">
			<button class="modal-btn modal-btn--cancel" onclick={() => onCancel()}> Cancel </button>
			<button class="modal-btn modal-btn--danger" onclick={() => onConfirm()}> Delete </button>
		</div>
	</div>
</div>

<style>
	/* ── Delete confirmation modal ──────────────────────────────────────────── */

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

	.delete-explanation {
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.6;
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

	.modal-btn--cancel {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.modal-btn--cancel:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.modal-btn--danger {
		background: var(--color-danger);
		border: 1px solid var(--color-danger);
		color: #fff;
		font-weight: 600;
	}

	.modal-btn--danger:hover {
		box-shadow: 0 0 12px rgba(248, 113, 113, 0.4);
	}

	.modal-btn--danger:active {
		transform: scale(0.97);
	}

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

	@media (max-width: 479px) {
		.modal {
			position: fixed;
			inset: 0;
			width: 100%;
			max-width: 100%;
			border-radius: 0;
			padding-top: var(--space-8);
		}

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
