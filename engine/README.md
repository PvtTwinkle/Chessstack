# In-browser Stockfish

The four `stockfish-19-lite*` files are the "lite" builds of
[Stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.0 (the `stockfish` npm package, files
copied unchanged from its `bin/` folder). Stockfish and Stockfish.js are licensed under the GNU
General Public License v3 (`COPYING.txt`); their source code is at
https://github.com/official-stockfish/Stockfish and
https://github.com/nmrugg/stockfish.js/tree/v19.0.0.

- `stockfish-19-lite.js` / `.wasm`: multi-threaded, used when the page is cross-origin isolated.
- `stockfish-19-lite-single.js` / `.wasm`: single-threaded fallback for other browsers.

They are served by `src/routes/engine/[file]/+server.ts` and driven by `src/lib/engine/`.

To update: `npm pack stockfish@<version>`, copy the four lite files from `package/bin/`, rename
the file names in the route and in `src/lib/engine/engine.ts`, and update this README and
THIRD-PARTY-NOTICES.md.
