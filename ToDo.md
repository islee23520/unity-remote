# ToDo

## Completed: Local scene workspace

- [x] Define shared project, hierarchy, edit, error, and AI-context contracts.
- [x] Capture failing contracts for inspection, invalid edits, and context export.
- [x] Implement the local broker with demo fixture and Unity connector boundary.
- [x] Implement the web hierarchy and inspector edit flow.
- [x] Implement the `unity-remote` JSON CLI.
- [x] Add the Unity Editor package that executes supported commands through Unity APIs.
- [x] Verify tests, types, production build, CLI behavior, web behavior, and Unity Editor behavior where available.
- [x] Commit, push, and independently review the first module.

The first module is landed on `main`.

## Current module: LAN remote access

- [x] Bind the broker beyond loopback and print local plus LAN bootstrap URLs.
- [x] Allow private LAN Host/Origin values while still rejecting public DNS-rebinding hosts.
- [x] Keep per-launch token auth, HttpOnly cookies, and the Unity connector on loopback.
- [x] Document how to open the workspace from another machine on the same network.

## Current module: Play Mode and Game View

- [x] Play Mode RPC (enter, exit, and query play state from the web client).
- [x] Game View streaming to the web client.
- [x] Remote keyboard and mouse input injection into the Game View.

## Next

- [x] Prove Game View JPEG and Play Mode input live against a connected Unity Editor (Aside non-blank screenshot).

The Play Mode and Game View module is landed on `main` and live-verified against Unity Editor 6000.7.0a5.

## Current module: Shadow Editor web chrome

- [x] Extract the Shadow Editor chrome contract (tokens, geometry, components) from the live demo into `Design.md`.
- [x] Rebuild the web workspace chrome as menubar / toolbar / left panel / viewport / right panels / console / status bar.
- [x] Keep session bootstrap, hierarchy search, edit preview/apply, revision conflicts, play controls, Game View polling, and input forwarding behavior intact.

### chrome-phase-2
- [x] Web wiring for the C4 visibility checkbox
- [x] Panel resizers + persisted ui-state
- [x] Maximize Game View toggle
- [x] Editor keyboard shortcuts and console pinning
- [x] Fix the serving bugs this exposed: rebuilt hashed assets fell through to index.html (`wildcard: false` snapshot) and the Vite `/api` prefix proxy swallowed the `/api.ts` module in dev.
- [x] Verify typecheck, tests, production build, and browser visual QA against the reference.

The web chrome module is delivered via PR `chrome-phase-2` -> `main` (pending merge): the workspace renders the Shadow Editor-style chrome in production and dev, and the demo edit path applies with preview, Undo group, and revision bump.
