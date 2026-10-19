#!/usr/bin/env node
// generate-board-themes.mjs
//
// Generates src/lib/themes/board-themes.css with class-scoped board theme
// styles for Chessground. Each theme defines a light/dark square color pair
// encoded into a base64 SVG checkerboard, plus matching coordinate label colors.
//
// Usage: node scripts/generate-board-themes.mjs
//
// The SVG uses the same 8x8 grid pattern that Chessground ships with, but with
// explicit fill colors instead of opacity-based darkening. This allows each
// theme to have fully independent light and dark square colors.

import { writeFileSync } from 'fs';
import { format, resolveConfig } from 'prettier';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/lib/themes/board-themes.css');

// Theme definitions: name, light square color, dark square color,
// and coordinate label colors for contrast against each square color.
const THEMES = [
	{
		name: 'brown',
		light: '#f0d9b5',
		dark: '#b58863',
		coordLight: 'rgba(255, 255, 255, 0.8)', // on dark squares
		coordDark: 'rgba(72, 72, 72, 0.8)' // on light squares
	},
	{
		name: 'blue',
		light: '#d0e2f0',
		dark: '#3a6d9e',
		coordLight: 'rgba(255, 255, 255, 0.8)',
		coordDark: 'rgba(72, 72, 72, 0.8)'
	},
	{
		name: 'green',
		light: '#eeeed2',
		dark: '#769656',
		coordLight: 'rgba(255, 255, 255, 0.8)',
		coordDark: 'rgba(72, 72, 72, 0.8)'
	},
	{
		name: 'purple',
		light: '#e8dff5',
		dark: '#7b61a6',
		coordLight: 'rgba(255, 255, 255, 0.85)',
		coordDark: 'rgba(80, 50, 110, 0.7)'
	},
	{
		name: 'grey',
		light: '#cccccc',
		dark: '#888888',
		coordLight: 'rgba(255, 255, 255, 0.8)',
		coordDark: 'rgba(50, 50, 50, 0.8)'
	}
];

// Build the SVG checkerboard pattern for a given dark square color.
// Light squares are fully transparent (showing through to the CSS background-color).
// Dark squares use an explicit fill color at full opacity.
function buildSvg(darkColor) {
	return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"
     viewBox="0 0 8 8" shape-rendering="crispEdges">
<g id="a">
  <g id="b">
    <g id="c">
      <g id="d">
        <rect width="1" height="1" id="e" opacity="0"/>
        <use x="1" y="1" href="#e" x:href="#e"/>
        <rect y="1" width="1" height="1" id="f" fill="${darkColor}" opacity="1"/>
        <use x="1" y="-1" href="#f" x:href="#f"/>
      </g>
      <use x="2" href="#d" x:href="#d"/>
    </g>
    <use x="4" href="#c" x:href="#c"/>
  </g>
  <use y="2" href="#b" x:href="#b"/>
</g>
<use y="4" href="#a" x:href="#a"/>
</svg>`;
}

function toBase64(str) {
	return Buffer.from(str).toString('base64');
}

// Generate the CSS for one theme, scoped under .board-theme-{name}
function generateThemeCss(theme) {
	const svg = buildSvg(theme.dark);
	const b64 = toBase64(svg);

	return `/* ${theme.name} theme — light: ${theme.light}, dark: ${theme.dark} */
.board-theme-${theme.name} cg-board {
  background-color: ${theme.light};
  background-image: url('data:image/svg+xml;base64,${b64}');
}

.board-theme-${theme.name} .orientation-white .ranks :nth-child(odd),
.board-theme-${theme.name} .orientation-white .files :nth-child(even),
.board-theme-${theme.name} .orientation-black .ranks :nth-child(even),
.board-theme-${theme.name} .orientation-black .files :nth-child(odd),
.board-theme-${theme.name} coords.squares:nth-of-type(odd) :nth-child(even),
.board-theme-${theme.name} coords.squares:nth-of-type(even) :nth-child(odd) {
  color: ${theme.coordDark};
}

.board-theme-${theme.name} .orientation-white .ranks :nth-child(even),
.board-theme-${theme.name} .orientation-white .files :nth-child(odd),
.board-theme-${theme.name} .orientation-black .ranks :nth-child(odd),
.board-theme-${theme.name} .orientation-black .files :nth-child(even),
.board-theme-${theme.name} coords.squares:nth-of-type(odd) :nth-child(odd),
.board-theme-${theme.name} coords.squares:nth-of-type(even) :nth-child(even) {
  color: ${theme.coordLight};
}`;
}

// Interactive square colors are shared across all themes — they are functional
// indicators (legal moves, check, last move) and should look the same everywhere.
const SHARED_INTERACTIVE = `/* Shared interactive square colors (theme-independent) */
cg-board square.move-dest {
  background: radial-gradient(rgba(20, 85, 30, 0.5) 22%, #208530 0, rgba(0, 0, 0, 0.3) 0, rgba(0, 0, 0, 0) 0);
}
cg-board square.premove-dest {
  background: radial-gradient(rgba(20, 30, 85, 0.5) 22%, #203085 0, rgba(0, 0, 0, 0.3) 0, rgba(0, 0, 0, 0) 0);
}
cg-board square.oc.move-dest {
  background: radial-gradient(transparent 0%, transparent 80%, rgba(20, 85, 0, 0.3) 80%);
}
cg-board square.oc.premove-dest {
  background: radial-gradient(transparent 0%, transparent 80%, rgba(20, 30, 85, 0.2) 80%);
}
cg-board square.move-dest:hover {
  background: rgba(20, 85, 30, 0.3);
}
cg-board square.premove-dest:hover {
  background: rgba(20, 30, 85, 0.2);
}
cg-board square.last-move {
  background-color: rgba(155, 199, 0, 0.41);
}
cg-board square.selected {
  background-color: rgba(20, 85, 30, 0.5);
}
cg-board square.check {
  background: radial-gradient(
    ellipse at center,
    rgba(255, 0, 0, 1) 0%,
    rgba(231, 0, 0, 1) 25%,
    rgba(169, 0, 0, 0) 89%,
    rgba(158, 0, 0, 0) 100%
  );
}
cg-board square.current-premove {
  background-color: rgba(20, 30, 85, 0.5);
}`;

// Assemble the full CSS file.
const sections = THEMES.map(generateThemeCss);
const css = `/* board-themes.css — auto-generated by scripts/generate-board-themes.mjs
 *
 * DO NOT EDIT BY HAND. Re-run the script to regenerate:
 *   node scripts/generate-board-themes.mjs
 *
 * Each theme is scoped under .board-theme-{name} so switching themes
 * only requires changing the wrapper class on the ChessBoard component.
 */

${sections.join('\n\n')}

${SHARED_INTERACTIVE}
`;

// Formatted like the rest of the repo, so re-running the script on an
// unchanged theme list leaves the committed file as it is.
const formatted = await format(css, { ...(await resolveConfig(OUTPUT)), filepath: OUTPUT });
writeFileSync(OUTPUT, formatted, 'utf-8');
console.log(`Wrote ${THEMES.length} board themes to ${OUTPUT}`);
