/**
 * buildExport.svelte.ts — PGN export for Build Mode's overflow menu.
 *
 * "Export PGN" fetches the repertoire as PGN and reveals two follow-up
 * actions: download it as a .pgn file or copy it to the clipboard.
 */

import { downloadTextFile, copyToClipboard } from '$lib/download';

// How long the "Copied!" confirmation stays visible.
const COPY_MSG_MS = 2000;

export function createPgnExport(getRepertoireId: () => number) {
	let exporting = $state(false);
	// True once a PGN has been fetched, which shows the download/copy buttons.
	let ready = $state(false);
	let pgn = $state('');
	let filename = $state('');
	let message = $state('');

	let copyMsgTimeout: ReturnType<typeof setTimeout> | undefined;

	async function exportPgn(): Promise<void> {
		if (exporting) return;
		exporting = true;
		message = '';
		try {
			const res = await fetch(`/api/repertoires/${getRepertoireId()}/export`);
			if (!res.ok) throw new Error('Export failed');
			const result = await res.json();
			pgn = result.pgn;
			filename = result.filename;
			ready = true;
		} catch {
			message = 'Export failed';
		} finally {
			exporting = false;
		}
	}

	function download(): void {
		downloadTextFile(pgn, filename);
		ready = false;
	}

	async function copy(): Promise<void> {
		const ok = await copyToClipboard(pgn);
		ready = false;
		message = ok ? 'Copied!' : 'Copy failed';
		if (ok) {
			clearTimeout(copyMsgTimeout);
			copyMsgTimeout = setTimeout(() => (message = ''), COPY_MSG_MS);
		}
	}

	// Cancel the pending message timer; call when the page unmounts.
	function destroy(): void {
		clearTimeout(copyMsgTimeout);
	}

	return {
		get exporting() {
			return exporting;
		},
		get ready() {
			return ready;
		},
		get message() {
			return message;
		},
		exportPgn,
		download,
		copy,
		destroy
	};
}

export type PgnExport = ReturnType<typeof createPgnExport>;
