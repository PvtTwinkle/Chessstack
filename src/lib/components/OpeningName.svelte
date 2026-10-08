<!--
	OpeningName.svelte
	──────────────────
	Displays the ECO code and opening name for the current board position.
	Example: "B90 · Sicilian Defence, Najdorf Variation"

	How it works:
	  1. Receives the current FEN and the move history FENs (newest → oldest).
	  2. POSTs to /api/eco with the full list whenever the position changes.
	  3. The server walks the list and returns the most specific recognised name.
	  4. If no match, renders nothing (the component takes up no space).

	Usage:
	  <OpeningName {currentFen} {fenHistory} />

	Where fenHistory is the FENs from navHistory in reverse order (most recent
	position first, starting position last), NOT including currentFen itself.
-->

<script lang="ts">
	interface Props {
		currentFen: string;
		// FENs from the move history, ordered newest-to-oldest.
		// The current FEN should NOT be included — it is passed separately.
		fenHistory: string[];
	}

	let { currentFen, fenHistory }: Props = $props();

	// The resolved ECO match, or null if the position isn't recognised.
	let ecoResult = $state<{ code: string; name: string } | null>(null);

	// Fetch the ECO name whenever the position changes.
	// We pass currentFen first so the server checks it before the history.
	// Debounced to avoid burning rate limits during rapid navigation.
	// AbortController prevents stale responses from overwriting newer data.
	$effect(() => {
		const fens = [currentFen, ...fenHistory];
		const controller = new AbortController();

		const timer = setTimeout(() => {
			fetch('/api/eco', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fens }),
				signal: controller.signal
			})
				.then((r) => {
					if (r.status === 429) return null;
					return r.json();
				})
				.then((data: { code: string; name: string } | null) => {
					ecoResult = data;
				})
				.catch(() => {
					// Silently swallow errors — a missing ECO name is not fatal.
					// This also catches AbortError when the effect re-runs.
				});
		}, 150);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
</script>

{#if ecoResult}
	<div class="opening-name">
		<span class="eco-code">{ecoResult.code}</span>
		<span class="eco-sep">·</span>
		<span class="eco-name">{ecoResult.name}</span>
	</div>
{/if}

<style>
	.opening-name {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: 12px;
		line-height: 1.3;
		overflow: hidden;
	}

	.eco-code {
		font-weight: 700;
		color: var(--color-accent);
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}

	.eco-sep {
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.eco-name {
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
