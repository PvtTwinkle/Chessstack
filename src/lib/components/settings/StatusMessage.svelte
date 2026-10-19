<!--
	The "Saved" / "Error saving" line under a setting. Errors show in the
	danger colour, so a failed save never looks like a success.
-->
<script lang="ts">
	import type { Status } from './settingsState.svelte';

	let { status }: { status: Status | null } = $props();
</script>

<!-- Always in the page, empty when idle: a live region has to exist before its
     text changes for screen readers to announce it. -->
<span class="status-msg" class:error={status !== null && !status.ok} role="status"
	>{status?.text ?? ''}</span
>
