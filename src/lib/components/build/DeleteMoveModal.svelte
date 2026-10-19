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
	import Modal from '$lib/components/Modal.svelte';
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

{#snippet title()}
	Delete <strong>{move.san}</strong>?
{/snippet}

<Modal open={true} {title} width="360px" onclose={onCancel}>
	<p class="delete-explanation">
		{#if subtreeCount === 0}
			This will permanently remove <strong>{move.san}</strong> from your repertoire. Any associated drill
			card will also be deleted.
		{:else}
			This will permanently remove <strong>{move.san}</strong> and
			<strong>{subtreeCount}</strong> follow-up {subtreeCount === 1 ? 'move' : 'moves'}
			({totalCount} total). All associated drill cards will also be deleted.
		{/if}
	</p>
	<div class="modal-actions">
		<button class="modal-btn modal-btn--cancel" onclick={() => onCancel()}>Cancel</button>
		<button class="modal-btn modal-btn--danger" onclick={() => onConfirm()}>Delete</button>
	</div>
</Modal>

<style>
	.delete-explanation {
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.6;
		margin: 0;
	}
</style>
