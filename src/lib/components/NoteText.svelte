<script lang="ts">
	// Renders user-authored move/position notes with minimal structure:
	// blank-line-separated paragraphs, and "* "/"- " bullet lists (nested by
	// leading whitespace, 2 spaces per level). Deliberately not full markdown
	// and never uses {@html} — notes are user-editable, exported, and
	// importable into other accounts, so raw HTML injection isn't worth the
	// risk for what's needed here. No inline bold/italic for the same reason;
	// ask if that's actually wanted, it would need a real markdown library
	// plus sanitization, not an extension of this.

	interface ListItem {
		text: string;
		children: ListItem[];
	}
	type Block = { type: 'p'; text: string } | { type: 'list'; items: ListItem[] };

	let { text }: { text: string } = $props();

	function isBullet(line: string): boolean {
		return /^\s*[*-]\s+/.test(line);
	}

	function bulletIndent(line: string): number {
		return (line.match(/^\s*/)?.[0].length ?? 0);
	}

	function bulletText(line: string): string {
		return line.replace(/^\s*[*-]\s+/, '');
	}

	// Parses a contiguous run of bullet lines into a nested list, 2 spaces
	// per indent level. Returns the list and how many lines were consumed.
	function parseList(lines: string[], start: number, indent: number): [ListItem[], number] {
		const items: ListItem[] = [];
		let i = start;
		while (i < lines.length && isBullet(lines[i]) && bulletIndent(lines[i]) >= indent) {
			const lineIndent = bulletIndent(lines[i]);
			if (lineIndent > indent) break; // belongs to the parent call's deeper recursion
			const item: ListItem = { text: bulletText(lines[i]), children: [] };
			i++;
			if (i < lines.length && isBullet(lines[i]) && bulletIndent(lines[i]) > indent) {
				const [children, consumed] = parseList(lines, i, bulletIndent(lines[i]));
				item.children = children;
				i = consumed;
			}
			items.push(item);
		}
		return [items, i];
	}

	const blocks = $derived.by((): Block[] => {
		const result: Block[] = [];
		const paragraphs = text.split(/\n\s*\n/); // blank-line-separated
		for (const para of paragraphs) {
			const lines = para.split('\n').filter((l) => l.trim() !== '');
			if (lines.length === 0) continue;
			if (isBullet(lines[0])) {
				const [items] = parseList(lines, 0, bulletIndent(lines[0]));
				result.push({ type: 'list', items });
			} else {
				result.push({ type: 'p', text: lines.join(' ') });
			}
		}
		return result;
	});
</script>

{#snippet listItems(items: ListItem[])}
	<ul>
		{#each items as item}
			<li>
				{item.text}
				{#if item.children.length > 0}
					{@render listItems(item.children)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="note-text-content">
	{#each blocks as block}
		{#if block.type === 'p'}
			<p>{block.text}</p>
		{:else}
			{@render listItems(block.items)}
		{/if}
	{/each}
</div>

<style>
	.note-text-content p {
		margin: 0 0 0.5em;
	}
	.note-text-content p:last-child {
		margin-bottom: 0;
	}
	.note-text-content ul {
		margin: 0 0 0.5em;
		padding-left: 1.2em;
	}
	.note-text-content ul:last-child {
		margin-bottom: 0;
	}
	.note-text-content li {
		margin: 0.15em 0;
	}
</style>
