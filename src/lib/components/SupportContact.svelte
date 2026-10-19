<!--
	Who to contact for help with an account. chessstack.app has a support
	inbox; a self-hosted instance is run by its administrator, who is the one
	to ask (and who doesn't want users emailing chessstack.app instead).
-->
<script lang="ts">
	import { page } from '$app/state';
</script>

{#if page.data.edition === 'cloud'}
	<a href="mailto:support@chessstack.app" class="support-link">support@chessstack.app</a>
{:else}
	your administrator
{/if}

<style>
	.support-link {
		color: var(--color-accent);
		text-decoration: none;
	}

	.support-link:hover {
		text-decoration: underline;
	}
</style>
