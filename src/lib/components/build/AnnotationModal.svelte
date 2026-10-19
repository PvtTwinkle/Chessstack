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
	import Modal from '$lib/components/Modal.svelte';
	import { NOTES_MAX_LENGTH } from '$lib/validation-limits';
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

{#snippet title()}
	Annotation — <strong>{move.san}</strong>
{/snippet}

<Modal open={true} {title} width="360px" dismissible={!saving} onclose={onClose}>
	<textarea
		class="annotation-textarea"
		bind:value={draft}
		aria-label="Note on {move.san}"
		placeholder="Add a note about this move…"
		maxlength={NOTES_MAX_LENGTH}
		rows="4"
		disabled={saving}></textarea>
	<div class="annotation-char-count">{draft.length}/{NOTES_MAX_LENGTH}</div>
	{#if error}
		<p class="modal-error" role="alert">{error}</p>
	{/if}
	<div class="modal-actions">
		<button class="modal-btn modal-btn--cancel" onclick={onClose} disabled={saving}>
			Cancel
		</button>
		<button class="modal-btn modal-btn--primary" onclick={onSave} disabled={saving}>
			{saving ? 'Saving…' : 'Save'}
		</button>
	</div>
</Modal>

<style>
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
</style>
