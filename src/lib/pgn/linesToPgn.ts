// Turns a list of SAN lines from the start position into one PGN movetext
// with variations, so lines from outside a PGN file (the opening guides'
// starter sets) can go through the same parse → conflicts → execute import.
//
//   linesToPgn([['e4', 'c5', 'Nf3'], ['e4', 'e5']]) === '1. e4 c5 (1... e5) 2. Nf3'

interface Node {
	san: string;
	children: Node[];
}

function moveNumber(ply: number, force: boolean): string {
	const n = Math.floor(ply / 2) + 1;
	if (ply % 2 === 0) return `${n}. `;
	return force ? `${n}... ` : '';
}

function movetext(children: Node[], ply: number, forceNumber: boolean): string {
	if (children.length === 0) return '';
	const [main, ...alternatives] = children;
	const parts = [moveNumber(ply, forceNumber) + main.san];
	for (const alt of alternatives) {
		const rest = movetext(alt.children, ply + 1, true);
		parts.push(`(${moveNumber(ply, true)}${alt.san}${rest ? ' ' + rest : ''})`);
	}
	// After a variation the next Black move needs its number again.
	const rest = movetext(main.children, ply + 1, alternatives.length > 0);
	if (rest) parts.push(rest);
	return parts.join(' ');
}

export function linesToPgn(lines: string[][]): string {
	const root: Node = { san: '', children: [] };
	for (const line of lines) {
		let node = root;
		for (const san of line) {
			let next = node.children.find((c) => c.san === san);
			if (!next) {
				next = { san, children: [] };
				node.children.push(next);
			}
			node = next;
		}
	}
	return movetext(root.children, 0, false);
}
