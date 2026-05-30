# Ingenious

A digital implementation of **Ingenious**, the Reiner Knizia tile-laying classic, for **1–4 players** — playable solo, against the computer, hot-seat, or **online**.

- **Engine** — the full game (rules, scoring, legal-move generation, and the AI) is written in **C++17** and compiled to **WebAssembly** via Emscripten. The exact same `.wasm` runs both in the browser and on the server, so move validation and the CPU are identical everywhere.
- **Client** — **React + TypeScript** (Vite). A frosted, icy hex board rendered in SVG, six glossy gem symbols, per-player score tracks with sliding pegs, a tile rack, animated placements, synthesized sound (Web Audio, mutable), an **undo**, and a responsive layout with the scoreboard always visible (side panel on desktop, strip on mobile). Works on mobile.
- **Server** — a **Node + TypeScript** WebSocket server holding authoritative rooms of up to four seats, mixing humans and CPUs, broadcasting redacted state (you only ever see your own rack). Includes an **open-games browser** (join listed rooms or by code) and **undo** (revert your own last move while no one else has acted).

```
engine/   C++ engine + Embind bindings -> WASM (ingenious.hpp, bindings.cpp, build.sh)
web/      React + TS app (Vite)
server/   Node WS room server (ws) + serves the built web app
```

## Quick start

Requires **Node 18+** and **Emscripten** (`emcc`). On macOS: `brew install emscripten`.

```bash
npm run setup     # builds the WASM engine, installs web + server deps
```

### Play locally (vs CPU, hot-seat, or solitaire)

```bash
npm run dev:server   # terminal 1 — http://localhost:8787
npm run dev:web      # terminal 2 — http://localhost:5173  (proxies /ws to the server)
```

Open http://localhost:5173 and pick **Play on this device**. Everything (including the CPU) runs in your browser via WASM — the server isn't even needed for local games.

### Play online

```bash
npm run build        # build engine + web bundle
npm start            # serves the app AND the WS server on http://localhost:8787
```

Open http://localhost:8787, choose **Play online**, **Create a room**, and share the 4-letter code. Friends join from the same URL with the code. The host picks how many seats are human vs CPU. Expose the port (or deploy the `server/` process) to play across the internet.

## How it maps to the rules

- The **official board**: the 2-player play area is a hexagon six hexes a side (11 across). The same physical board is used for every player count — 2 players use the white region, 3 players add a ring, 4 players add two (the reserved rings are shown greyed). The six printed symbols sit at the corners of the white region. Board size is adjustable in setup (default = the official side-6 area).
- Official **tile distribution**: six tiles of each two-color pair + five of each double = 120.
- Tiles are dominoes of two colored gems (120-tile bag: mixed pairs ×6, doubles ×5).
- A placed tile scores each half along its five outward lines, stopping at the first gap or different color, never counting the tile itself.
- Reaching **18** on a color shouts *"Ingenious!"* and grants a bonus placement.
- First-round tiles must touch a distinct printed symbol; the swap rule (no tile of your lowest color) is supported; the **solitaire** variant uses the double-length 0–36 track with no bonus.
- Result = your lowest counter; ties broken by the next-lowest, and so on. All six maxed = instant win.

## Engine

```bash
npm run test:engine        # native C++ self-play + scoring tests
npm run build:engine       # (re)compile to web + node WASM targets
```

`engine/build.sh` emits two targets from one source: `ENVIRONMENT=web` for the browser (no Node imports) and `ENVIRONMENT=node` for the server.
