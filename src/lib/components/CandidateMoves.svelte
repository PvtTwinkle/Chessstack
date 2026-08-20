<!--
	CandidateMoves — sidebar panel for Build Mode and Review Mode.

	Shows suggested moves at the current board position, drawn from five
	independent sources — each with its own loading state so results appear
	as soon as they're available:

	  • Book — shared opening book moves (instant, local DB)
	  • Masters — Chessmont master game statistics & W/D/L stats (instant, local DB)
	  • Stars — moves from specific famous players like Magnus, Fischer, etc. (instant, local DB)
	  • Players — Lichess player game statistics by rating bracket (instant, local DB)
	  • Engine — Stockfish top-N analysis (~2-10s)

	Five tabs switch between the sources. Book tab is shown first; if there
	are no book moves the Masters tab is activated automatically, then Stars,
	then Players, then Engine.

	When the user clicks a candidate, onSelectMove is called with the SAN of
	that move. When the user hovers over a candidate, onHoverMove is called
	with the SAN (or null on mouse leave) so the parent can draw arrows.

	The evaluation score (Engine tab) is always shown from white's perspective:
	  +0.45 = white is 0.45 pawns better
	  -1.20 = black is 1.20 pawns better
	  #3    = white mates in 3
	  -#3   = black mates in 3
-->

<script lang="ts">
	import { RATING_BRACKETS, DEFAULT_BRACKET_ID } from '$lib/ratings';

	interface Candidate {
		san: string;
		uci: string;
		evalCp: number | null;
		evalMate: number | null;
		isBook: boolean;
		annotation: string | null;
		openingName: string | null;
	}

	type TabId = 'book' | 'masters' | 'stars' | 'players' | 'engine';

	interface MastersMove {
		san: string;
		white: number;
		draws: number;
		black: number;
		totalGames: number;
		// Only populated for Players-tab rows (see moveEvalBgClass below).
		evalCp?: number | null;
		evalMate?: number | null;
	}

	interface Props {
		currentFen: string;
		onSelectMove: (san: string) => void;
		onHoverMove?: (san: string | null) => void;
		disabled?: boolean;
		playerColor?: 'WHITE' | 'BLACK';
		/** Index of the keyboard-highlighted candidate (parent-controlled). */
		highlightedIndex?: number | null;
		/** Fires whenever the active tab's candidate SAN list changes. */
		onCandidatesChanged?: (sans: string[]) => void;
		/** Parent requests a tab switch (set to null after applying). */
		requestedTab?: TabId | null;
		/** Fires whenever the active tab changes. */
		onTabChanged?: (tab: TabId) => void;
		/** Fires whenever the top-line engine eval changes. */
		onEvalChanged?: (evalCp: number | null, evalMate: number | null, loading: boolean) => void;
		/** Fires whenever engine candidates update (at each depth). */
		onEngineCandidatesChanged?: (
			candidates: { san: string; evalCp: number | null; evalMate: number | null }[]
		) => void;
		/** Rating bracket ID (0–7) for the Players tab. */
		playersRatingBracket?: number;
		/** Fires when the user changes the Players rating bracket. */
		onPlayersSettingsChanged?: (bracket: number) => void;
		/** Player slug for the Stars tab (null = first available). */
		starsPlayerSlug?: string | null;
		/** Fires when the user changes the Stars player selection. */
		onStarsSettingsChanged?: (slug: string) => void;
	}

	let {
		currentFen,
		onSelectMove,
		onHoverMove,
		disabled = false,
		playerColor = 'WHITE',
		highlightedIndex = null,
		onCandidatesChanged,
		requestedTab = null,
		onTabChanged,
		onEvalChanged,
		onEngineCandidatesChanged,
		playersRatingBracket = DEFAULT_BRACKET_ID,
		onPlayersSettingsChanged,
		starsPlayerSlug = null,
		onStarsSettingsChanged
	}: Props = $props();

	// ── Book state ────────────────────────────────────────────────────────────
	let bookCandidates = $state<Candidate[]>([]);
	let bookLoading = $state(false);
	let bookError = $state(false);

	// ── Engine state ──────────────────────────────────────────────────────────
	let engineCandidates = $state<Candidate[]>([]);
	let engineLoading = $state(false);
	let engineError = $state(false);
	let engineAvailable = $state(true);
	let engineDepth = $state(0);
	let engineMaxDepth = $state(0);

	// ── Masters state ─────────────────────────────────────────────────────────
	let mastersMoves = $state<MastersMove[]>([]);
	let mastersLoading = $state(false);
	let mastersError = $state(false);

	// ── Players state ─────────────────────────────────────────────────────────
	let playersMoves = $state<MastersMove[]>([]);
	let playersLoading = $state(false);
	let playersError = $state(false);
	// Local override: null means "use the prop". Set when the user picks a bracket
	// in the dropdown; cleared when the prop catches up (after settings PATCH).
	let ratingOverride = $state<number | null>(null);
	let selectedRating = $derived(ratingOverride ?? playersRatingBracket);

	// Clear the override once the prop reflects the same value.
	$effect(() => {
		if (ratingOverride !== null && playersRatingBracket === ratingOverride) {
			ratingOverride = null;
		}
	});

	// ── Stars state ───────────────────────────────────────────────────────────
	let starsMoves = $state<MastersMove[]>([]);
	let starsLoading = $state(false);
	let starsError = $state(false);
	let starsPlayers = $state<{ slug: string; displayName: string; category: string | null }[]>([]);
	// Local override: null means "use the prop". Set when the user picks a player
	// in the dropdown; cleared when the prop catches up (after settings PATCH).
	let starsPlayerOverride = $state<string | null>(null);
	let selectedPlayer = $derived(
		starsPlayerOverride ?? starsPlayerSlug ?? starsPlayers[0]?.slug ?? ''
	);

	// Group players by category for the dropdown <optgroup> elements.
	const CATEGORY_ORDER = [
		{ key: 'legend', label: 'Chess Legends' },
		{ key: 'gm', label: 'Modern Super-GMs' },
		{ key: 'streamer', label: 'Streamers & YouTubers' },
		{ key: 'meme', label: 'Meme' }
	];
	let playerGroups = $derived.by(() => {
		const groups: { label: string; players: typeof starsPlayers }[] = [];
		for (const { key, label } of CATEGORY_ORDER) {
			const matched = starsPlayers.filter((p) => p.category === key);
			if (matched.length > 0) groups.push({ label, players: matched });
		}
		const uncategorized = starsPlayers.filter(
			(p) => !p.category || !CATEGORY_ORDER.some((c) => c.key === p.category)
		);
		if (uncategorized.length > 0) groups.push({ label: 'Other', players: uncategorized });
		return groups;
	});

	// Clear the override once the prop reflects the same value.
	$effect(() => {
		if (starsPlayerOverride !== null && starsPlayerSlug === starsPlayerOverride) {
			starsPlayerOverride = null;
		}
	});

	// Fetch available star players once on mount.
	$effect(() => {
		fetch('/api/stars/players')
			.then((res) => (res.ok ? res.json() : { players: [] }))
			.then((data) => {
				starsPlayers = data.players ?? [];
			})
			.catch(() => {
				starsPlayers = [];
			});
	});

	// ── Tab state ─────────────────────────────────────────────────────────────
	let activeTab = $state<TabId>('book');
	// Prevents auto-switch from overriding a deliberate user tab click.
	let userClickedTab = $state(false);

	function selectTab(tab: TabId) {
		activeTab = tab;
		userClickedTab = true;
	}

	// ── Active tab's SAN list (shared by candidates-changed + keyboard effects) ──
	let activeSans = $derived(
		activeTab === 'book'
			? bookCandidates.map((c) => c.san)
			: activeTab === 'masters'
				? mastersMoves.map((m) => m.san)
				: activeTab === 'stars'
					? starsMoves.map((m) => m.san)
					: activeTab === 'players'
						? playersMoves.map((m) => m.san)
						: engineCandidates.map((c) => c.san)
	);

	// ── Notify parent when the visible candidate list changes ────────────────
	$effect(() => {
		onCandidatesChanged?.(activeSans);
	});

	// ── Notify parent when activeTab changes ──────────────────────────────────
	$effect(() => {
		onTabChanged?.(activeTab);
	});

	// ── Apply parent-requested tab switch ─────────────────────────────────────
	$effect(() => {
		if (requestedTab && requestedTab !== activeTab) {
			activeTab = requestedTab;
			userClickedTab = true;
		}
	});

	// ── Notify parent of top-line engine eval ─────────────────────────────────
	$effect(() => {
		const top = engineCandidates[0];
		onEvalChanged?.(top?.evalCp ?? null, top?.evalMate ?? null, engineLoading);
	});

	// ── Notify parent of all engine candidates (for live eval tracking) ──────
	$effect(() => {
		onEngineCandidatesChanged?.(
			engineCandidates.map((c) => ({ san: c.san, evalCp: c.evalCp, evalMate: c.evalMate }))
		);
	});

	// ── Keyboard highlight triggers hover arrow ───────────────────────────────
	$effect(() => {
		if (highlightedIndex === null || highlightedIndex === undefined) {
			return;
		}
		const san = activeSans[highlightedIndex] ?? null;
		onHoverMove?.(san);
	});

	// ── Book fetch — near-instant (local DB query) ────────────────────────────
	$effect(() => {
		const fen = currentFen;
		const controller = new AbortController();

		bookLoading = true;
		bookError = false;
		bookCandidates = [];
		// Reset user-click flag so auto-cascade can fire if the current tab is empty.
		userClickedTab = false;

		fetch('/api/stockfish', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fen, mode: 'book' }),
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Book fetch failed');
				return res.json();
			})
			.then((data) => {
				bookCandidates = (data.candidates as Candidate[]).filter((c) => c.isBook);
				// Auto-switch to masters if no book moves and user hasn't clicked a tab.
				// Masters is now instant (local DB), so cascade: book → masters → engine.
				if (bookCandidates.length === 0 && activeTab === 'book' && !userClickedTab) {
					activeTab = 'masters';
				}
			})
			.catch((err) => {
				if (err.name !== 'AbortError') bookError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) bookLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Engine stream — progressive Stockfish analysis via SSE ────────────────
	// Opens a Server-Sent Events connection that yields eval updates at each
	// search depth. The eval bar and candidate list update live as the engine
	// searches deeper — no more waiting for the full analysis to finish.
	$effect(() => {
		const fen = currentFen;
		const params = new URLSearchParams({ fen });
		const es = new EventSource(`/api/stockfish/stream?${params}`);

		engineLoading = true;
		engineError = false;
		engineCandidates = [];
		engineDepth = 0;
		engineMaxDepth = 0;

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as {
					depth: number;
					maxDepth: number;
					candidates: Array<{
						san: string;
						uci: string;
						evalCp: number | null;
						evalMate: number | null;
					}>;
					done: boolean;
				};

				// Map streaming candidates to the full Candidate shape used by the UI.
				engineCandidates = data.candidates.map((c) => ({
					...c,
					isBook: false,
					annotation: null,
					openingName: null
				}));
				engineDepth = data.depth;
				engineMaxDepth = data.maxDepth;
				engineAvailable = data.candidates.length > 0;

				if (data.done) {
					engineLoading = false;
					es.close();
				}
			} catch {
				// Malformed event — ignore and wait for the next one.
			}
		};

		es.onerror = () => {
			engineError = true;
			engineLoading = false;
			es.close();
		};

		return () => {
			es.close();
		};
	});

	// ── Masters fetch — local Chessmont DB, instant response ─────────────────
	// Fetches move statistics from the local chessmont_moves table when the
	// Masters tab is active. No debounce or rate limiting needed — the query
	// hits the local PostgreSQL database directly.
	$effect(() => {
		const fen = currentFen;
		const tab = activeTab;

		// Not viewing Masters tab — reset state and do nothing.
		if (tab !== 'masters') {
			mastersMoves = [];
			mastersLoading = false;
			mastersError = false;
			return;
		}

		const controller = new AbortController();

		mastersLoading = true;
		mastersError = false;
		mastersMoves = [];

		fetch(`/api/masters?fen=${encodeURIComponent(fen)}`, {
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Masters fetch failed');
				return res.json();
			})
			.then((data) => {
				mastersMoves = data.moves ?? [];
				// Auto-cascade to stars if masters also empty and user hasn't clicked.
				if (mastersMoves.length === 0 && !userClickedTab) {
					activeTab = 'stars';
				}
			})
			.catch((err) => {
				if (err.name !== 'AbortError') mastersError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) mastersLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Players fetch — local Lichess DB, instant response ───────────────────
	// Fetches move statistics from the local lichess_moves table when the
	// Players tab is active. Re-fetches when the rating bracket changes.
	$effect(() => {
		const fen = currentFen;
		const tab = activeTab;
		const rating = selectedRating;

		// Not viewing Players tab — reset state and do nothing.
		if (tab !== 'players') {
			playersMoves = [];
			playersLoading = false;
			playersError = false;
			return;
		}

		const controller = new AbortController();

		playersLoading = true;
		playersError = false;
		playersMoves = [];

		fetch(`/api/players?fen=${encodeURIComponent(fen)}&rating=${rating}`, {
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Players fetch failed');
				return res.json();
			})
			.then((data) => {
				playersMoves = data.moves ?? [];
				// Auto-cascade to engine if players also empty and user hasn't clicked.
				if (playersMoves.length === 0 && !userClickedTab) {
					activeTab = 'engine';
				}
			})
			.catch((err) => {
				if (err.name !== 'AbortError') playersError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) playersLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Stars fetch — local celebrity DB, instant response ───────────────────
	// Fetches move statistics for a specific famous player when the Stars tab
	// is active. Re-fetches when the selected player changes.
	$effect(() => {
		const fen = currentFen;
		const tab = activeTab;
		const player = selectedPlayer;

		// Not viewing Stars tab — reset state and do nothing.
		if (tab !== 'stars') {
			starsMoves = [];
			starsLoading = false;
			starsError = false;
			return;
		}

		// No player selected (empty database) — show empty state.
		if (!player) {
			starsMoves = [];
			starsLoading = false;
			starsError = false;
			return;
		}

		const controller = new AbortController();

		starsLoading = true;
		starsError = false;
		starsMoves = [];

		fetch(`/api/stars?fen=${encodeURIComponent(fen)}&player=${encodeURIComponent(player)}`, {
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Stars fetch failed');
				return res.json();
			})
			.then((data) => {
				starsMoves = data.moves ?? [];
				// Auto-cascade to players if stars also empty and user hasn't clicked.
				if (starsMoves.length === 0 && !userClickedTab) {
					activeTab = 'players';
				}
			})
			.catch((err) => {
				if (err.name !== 'AbortError') starsError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) starsLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Eval formatting (Engine tab only) ─────────────────────────────────────
	// cp and mate arrive from the server as White's perspective; we flip the
	// sign for Black players so that positive always means "good for me".
	function formatEval(cp: number | null, mate: number | null): string {
		if (mate !== null) {
			const playerMate = playerColor === 'BLACK' ? -mate : mate;
			return playerMate > 0 ? `#${playerMate}` : `-#${Math.abs(playerMate)}`;
		}
		if (cp === null) return '';
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		const pawns = playerCp / 100;
		return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
	}

	function evalColorClass(cp: number | null, mate: number | null): string {
		if (mate !== null) {
			const playerMate = playerColor === 'BLACK' ? -mate : mate;
			return playerMate > 0 ? 'eval-white' : 'eval-black';
		}
		if (cp === null) return '';
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		if (playerCp > 60) return 'eval-white';
		if (playerCp < -60) return 'eval-black';
		return 'eval-equal';
	}

	// ── Players tab — background coloring by eval delta vs the best move ─────
	// Converts a (cp, mate) pair into one comparable number, from the current
	// player's perspective (higher = better for them), so mate scores and cp
	// scores can be ranked against each other. Mates are pushed far outside
	// the cp range so "mate for me" always outranks any cp score and "mate
	// against me" always underranks any cp score.
	function playerScore(cp: number | null, mate: number | null): number | null {
		if (mate !== null) {
			const playerMate = playerColor === 'BLACK' ? -mate : mate;
			return playerMate > 0 ? 100_000 - playerMate : -100_000 - playerMate;
		}
		if (cp === null) return null;
		return playerColor === 'BLACK' ? -cp : cp;
	}

	// Best score among the currently loaded Players-tab moves. null if none
	// of them have an eval yet (still loading, or the engine is unavailable).
	let playersBestScore = $derived.by(() => {
		const scores = playersMoves
			.map((m) => playerScore(m.evalCp ?? null, m.evalMate ?? null))
			.filter((s): s is number => s !== null);
		return scores.length > 0 ? Math.max(...scores) : null;
	});

	// Background tint for a Players-tab move, by how far its eval trails the
	// best evaluated move: <20cp good, 20-50cp neutral, >50cp bad. Returns ''
	// for Masters/Stars rows (evalCp is undefined there — not computed) so
	// this only ever affects the Players tab.
	function moveEvalBgClass(m: MastersMove): string {
		if (m.evalCp === undefined || playersBestScore === null) return '';
		const score = playerScore(m.evalCp ?? null, m.evalMate ?? null);
		if (score === null) return '';
		const delta = playersBestScore - score;
		if (delta < 20) return 'move-eval-good';
		if (delta < 50) return 'move-eval-neutral';
		return 'move-eval-bad';
	}

	// ── Scroll-into-view for keyboard navigation ─────────────────────────
	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (highlightedIndex == null || !listEl) return;
		const row = listEl.children[highlightedIndex] as HTMLElement | undefined;
		row?.scrollIntoView({ block: 'nearest' });
	});

	// The subtitle shown below a book move — opening name takes priority.
	function bookSubtitle(c: Candidate): string | null {
		return c.openingName ?? c.annotation ?? null;
	}

	// Format game count with locale separators (e.g. 1,234).
	function formatCount(n: number): string {
		return n.toLocaleString();
	}
</script>

<div class="section">
	<!-- Tab bar -->
	<div class="tab-bar">
		<button
			class="tab"
			class:active={activeTab === 'book'}
			onclick={() => selectTab('book')}
			type="button"
		>
			Book{#if activeTab === 'book' && !bookLoading && bookCandidates.length > 0}&nbsp;({bookCandidates.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'masters'}
			onclick={() => selectTab('masters')}
			type="button"
		>
			Masters{#if activeTab === 'masters' && !mastersLoading && mastersMoves.length > 0}&nbsp;({mastersMoves.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'stars'}
			onclick={() => selectTab('stars')}
			type="button"
		>
			Stars{#if activeTab === 'stars' && !starsLoading && starsMoves.length > 0}&nbsp;({starsMoves.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'players'}
			onclick={() => selectTab('players')}
			type="button"
		>
			Players{#if activeTab === 'players' && !playersLoading && playersMoves.length > 0}&nbsp;({playersMoves.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'engine'}
			onclick={() => selectTab('engine')}
			disabled={!engineAvailable && !engineLoading}
			type="button"
			title={!engineAvailable && !engineLoading ? 'Stockfish engine is not available' : undefined}
		>
			Engine{#if activeTab === 'engine' && !engineLoading && engineCandidates.length > 0}&nbsp;({engineCandidates.length}){/if}
		</button>
	</div>

	<!-- Shared WDL move row used by Masters, Stars, and Players tabs -->
	{#snippet wdlRow(m: MastersMove, idx: number)}
		{@const winPct = m.totalGames > 0 ? (m.white / m.totalGames) * 100 : 0}
		{@const drawPct = m.totalGames > 0 ? (m.draws / m.totalGames) * 100 : 0}
		{@const lossPct = m.totalGames > 0 ? (m.black / m.totalGames) * 100 : 0}
		<button
			class="candidate-row"
			class:candidate-highlighted={highlightedIndex === idx}
			class:move-eval-good={moveEvalBgClass(m) === 'move-eval-good'}
			class:move-eval-neutral={moveEvalBgClass(m) === 'move-eval-neutral'}
			class:move-eval-bad={moveEvalBgClass(m) === 'move-eval-bad'}
			onclick={() => onSelectMove(m.san)}
			onmouseenter={() => onHoverMove?.(m.san)}
			onmouseleave={() => onHoverMove?.(null)}
			{disabled}
		>
			<div class="candidate-main">
				<span class="candidate-san">{m.san}</span>
				<span
					class="wdl-bar-inline"
					title="{winPct.toFixed(1)}% W / {drawPct.toFixed(1)}% D / {lossPct.toFixed(1)}% L"
				>
					<span class="wdl-white" style="width: {winPct}%"></span>
					<span class="wdl-draw" style="width: {drawPct}%"></span>
					<span class="wdl-black" style="width: {lossPct}%"></span>
				</span>
				<span class="masters-games">{formatCount(m.totalGames)}</span>
			</div>
			<div class="wdl-labels">
				<span class="wdl-label-white">{winPct.toFixed(0)}%</span>
				<span class="wdl-label-draw">{drawPct.toFixed(0)}%</span>
				<span class="wdl-label-black">{lossPct.toFixed(0)}%</span>
			</div>
		</button>
	{/snippet}

	<!-- ── Book tab content ─────────────────────────────────────────────────── -->
	{#if activeTab === 'book'}
		{#if bookLoading}
			<div class="loading">Loading book…</div>
		{:else if bookError}
			<p class="empty-hint">Could not load book moves.</p>
		{:else if bookCandidates.length === 0}
			<p class="empty-hint">No book moves at this position.</p>
		{:else}
			<div class="candidate-list" bind:this={listEl}>
				{#each bookCandidates as c, idx (c.uci)}
					<button
						class="candidate-row"
						class:candidate-highlighted={highlightedIndex === idx}
						onclick={() => onSelectMove(c.san)}
						onmouseenter={() => onHoverMove?.(c.san)}
						onmouseleave={() => onHoverMove?.(null)}
						{disabled}
					>
						<div class="candidate-main">
							<span class="candidate-san">{c.san}</span>
							{#if bookSubtitle(c)}
								<span class="opening-name" title={bookSubtitle(c)}>{bookSubtitle(c)}</span>
							{:else}
								<span class="spacer"></span>
							{/if}
							{#if c.evalMate !== null || c.evalCp !== null}
								<span class="eval {evalColorClass(c.evalCp, c.evalMate)}">
									{formatEval(c.evalCp, c.evalMate)}
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}

		<!-- ── Masters tab content ───────────────────────────────────────────── -->
	{:else if activeTab === 'masters'}
		{#if mastersLoading}
			<div class="loading">Loading masters…</div>
		{:else if mastersError}
			<p class="empty-hint">Masters database unavailable.</p>
		{:else if mastersMoves.length === 0}
			<p class="empty-hint">No master games from this position.</p>
		{:else}
			<div class="candidate-list" bind:this={listEl}>
				{#each mastersMoves as m, idx (m.san)}
					{@render wdlRow(m, idx)}
				{/each}
			</div>
		{/if}

		<!-- ── Stars tab content ─────────────────────────────────────────────── -->
	{:else if activeTab === 'stars'}
		{#if starsPlayers.length > 0}
			<div class="rating-selector">
				<select
					value={selectedPlayer}
					onchange={(e) => {
						const val = e.currentTarget.value;
						starsPlayerOverride = val;
						onStarsSettingsChanged?.(val);
					}}
				>
					{#each playerGroups as group (group.label)}
						<optgroup label={group.label}>
							{#each group.players as p (p.slug)}
								<option value={p.slug}>{p.displayName}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>
		{/if}
		{#if starsLoading}
			<div class="loading">Loading stars…</div>
		{:else if starsError}
			<p class="empty-hint">Stars database unavailable.</p>
		{:else if starsPlayers.length === 0}
			<p class="empty-hint">No player data imported yet.</p>
		{:else if starsMoves.length === 0}
			<p class="empty-hint">No games from this player at this position.</p>
		{:else}
			<div class="candidate-list" bind:this={listEl}>
				{#each starsMoves as m, idx (m.san)}
					{@render wdlRow(m, idx)}
				{/each}
			</div>
		{/if}

		<!-- ── Players tab content ───────────────────────────────────────────── -->
	{:else if activeTab === 'players'}
		<div class="rating-selector">
			<select
				value={selectedRating}
				onchange={(e) => {
					const val = parseInt(e.currentTarget.value, 10);
					ratingOverride = val;
					onPlayersSettingsChanged?.(val);
				}}
			>
				{#each RATING_BRACKETS as bracket (bracket.id)}
					<option value={bracket.id}>{bracket.label}</option>
				{/each}
			</select>
		</div>
		{#if playersLoading}
			<div class="loading">Loading players…</div>
		{:else if playersError}
			<p class="empty-hint">Players database unavailable.</p>
		{:else if playersMoves.length === 0}
			<p class="empty-hint">No player games from this position.</p>
		{:else}
			<div class="candidate-list" bind:this={listEl}>
				{#each playersMoves as m, idx (m.san)}
					{@render wdlRow(m, idx)}
				{/each}
			</div>
		{/if}

		<!-- ── Engine tab content ────────────────────────────────────────────── -->
	{:else if engineError}
		<p class="empty-hint">Could not load engine suggestions.</p>
	{:else if engineLoading && engineCandidates.length === 0}
		<div class="loading">Analysing…</div>
	{:else if !engineLoading && engineCandidates.length === 0}
		<p class="empty-hint">
			{engineAvailable ? 'No engine suggestions available.' : 'Stockfish engine is not available.'}
		</p>
	{:else}
		<div class="candidate-list" bind:this={listEl}>
			{#each engineCandidates as c, idx (c.uci)}
				<button
					class="candidate-row"
					class:candidate-highlighted={highlightedIndex === idx}
					onclick={() => onSelectMove(c.san)}
					onmouseenter={() => onHoverMove?.(c.san)}
					onmouseleave={() => onHoverMove?.(null)}
					{disabled}
				>
					<div class="candidate-main">
						<span class="candidate-san">{c.san}</span>
						<span class="spacer"></span>
						{#if c.evalMate !== null || c.evalCp !== null}
							<span class="eval {evalColorClass(c.evalCp, c.evalMate)}">
								{formatEval(c.evalCp, c.evalMate)}
							</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
		{#if engineLoading && engineDepth > 0}
			<div class="depth-indicator">depth {engineDepth} / {engineMaxDepth}</div>
		{/if}
	{/if}
</div>

<style>
	/* ── Section wrapper ─────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* ── Tab bar ─────────────────────────────────────────────────────────────── */

	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		flex: 1;
		min-width: 0;
		padding: var(--space-2);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition:
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
		margin-bottom: -1px;
	}

	.tab:hover:not(:disabled) {
		color: var(--color-text-secondary);
	}

	.tab.active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
	}

	.tab:disabled {
		color: rgba(82, 82, 106, 0.4);
		cursor: default;
	}

	/* ── Loading / empty states ──────────────────────────────────────────────── */

	.loading {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	/* ── Candidate list ──────────────────────────────────────────────────────── */

	.candidate-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 180px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.candidate-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.candidate-row:hover:not(:disabled),
	.candidate-row.candidate-highlighted:not(:disabled) {
		border-color: var(--color-accent-dim);
		background: rgba(30, 30, 53, 0.8);
		box-shadow: var(--glow-accent);
	}

	.candidate-row:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── Players tab — background tint by eval delta vs best move ──────────── */
	/* Subtle tint + left border so the WDL bar underneath stays legible. */

	.move-eval-good {
		background: rgba(63, 176, 110, 0.12);
		border-left: 3px solid var(--color-eval-good);
	}

	.move-eval-neutral {
		background: rgba(212, 168, 67, 0.1);
		border-left: 3px solid var(--color-eval-inaccuracy);
	}

	.move-eval-bad {
		background: rgba(224, 84, 84, 0.12);
		border-left: 3px solid var(--color-eval-blunder);
	}

	.candidate-main {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
	}

	.candidate-san {
		font-weight: 600;
		color: var(--color-text-primary);
		min-width: 2.5rem;
	}

	.spacer {
		flex: 1;
	}

	.eval {
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.eval-white {
		color: var(--color-success);
	}

	.eval-black {
		color: var(--color-danger);
	}

	.eval-equal {
		color: var(--color-text-muted);
	}

	.opening-name {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		color: var(--color-text-muted);
		font-style: italic;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Rating bracket selector (Players tab) ──────────────────────────────── */

	.rating-selector {
		display: flex;
		align-items: center;
	}

	.rating-selector select {
		width: 100%;
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
	}

	/* ── Masters / Players tab — stats and W/D/L bar ─────────────────────────── */

	.masters-games {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.wdl-bar-inline {
		flex: 1;
		display: flex;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		min-width: 0;
	}

	.wdl-white {
		background: var(--color-success);
	}

	.wdl-draw {
		background: var(--color-text-muted);
	}

	.wdl-black {
		background: var(--color-danger);
	}

	.wdl-labels {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.wdl-label-white {
		color: var(--color-success);
	}

	.wdl-label-draw {
		color: var(--color-text-muted);
	}

	.wdl-label-black {
		color: var(--color-danger);
	}

	/* ── Depth indicator (shown during progressive engine analysis) ────────── */

	.depth-indicator {
		font-size: 10px;
		color: var(--color-text-muted);
		text-align: right;
		font-variant-numeric: tabular-nums;
		padding-right: var(--space-2);
	}

	/* ── Mobile compact mode ── --bp-md */
	@media (max-width: 767px) {
		.tab {
			min-height: 44px;
			padding: var(--space-3);
			font-size: 13px;
		}

		.candidate-row {
			min-height: 44px;
			padding: var(--space-3);
		}

		.candidate-list {
			display: grid;
			grid-template-columns: 1fr 1fr;
			max-height: 180px;
		}

		.opening-name {
			display: none;
		}
	}

	/* ── Small phones (< 480px) ── --bp-sm */
	@media (max-width: 479px) {
		.tab-bar {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
		}

		.tab {
			font-size: 11px;
			padding: var(--space-2) var(--space-1);
			white-space: nowrap;
		}
	}
</style>
