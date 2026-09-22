# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-03 | **Commit:** 781cad3 | **Branch:** main

## OVERVIEW

Unity Remote is a Unity 6 Editor bridge with a Fastify broker, JSON CLI, and React workspace for authenticated scene inspection, constrained edits, Play Mode control, Game View frames, and remote input. The Unity Editor is authoritative; TypeScript and C# communicate through a versioned JSON/WebSocket contract.

## STRUCTURE

```text
unity-remote/
├── src/contracts/          # Zod wire schemas and TypeScript contract types
├── src/server/             # Fastify HTTP/WebSocket broker and Unity connector hub
├── src/cli/                # JSON-first unity-remote / unityctx command line
├── src/web/                # React workspace and broker API client
├── contracts/              # Canonical JSON Schema plus one fixture per envelope
├── unity-package/          # Installable Unity 6 Editor package and EditMode tests
├── Assets/                 # Host Unity project used for live QA
└── tests/                  # Node/Vitest contract, broker, CLI, and connector tests
```

## WHERE TO LOOK

- **Change the wire protocol or contract fixtures** → `src/contracts/protocol.ts`, `contracts/unity-remote.schema.json`, `unity-package/Editor/Protocol.cs`, `contracts/fixtures/`, `tests/protocol.test.ts` — keep all representations aligned; fixture names must exactly match the test mapping.
- **Add or change an HTTP route** → `src/server/app.ts` — auth, Host, Origin, session cookie, and error boundaries live here.
- **Change Unity RPC behavior** → `src/server/connector.ts`, `unity-package/Editor/ConnectorDispatch.cs` — broker validates both outbound requests and inbound responses.
- **Change demo/disconnected behavior** → `src/server/store.ts` — demo store is writable; frozen post-disconnect store is read-only.
- **Change CLI commands** → `src/cli/index.ts`, `src/cli/client.ts` — output is structured JSON; `unityctx` is an alias.
- **Change the web workspace** → `src/web/main.tsx`, `src/web/api.ts`, `src/web/styles.css` — editor chrome (menubar, toolbar, panels, viewport, console, status bar) with activity log and session bootstrap.
- **Change Unity scene editing** → `unity-package/Editor/UnityRemoteBridge.cs` — GlobalObjectId, SerializedProperty, revision checks, Undo, explicit save.
- **Run live Unity verification** → `Assets/`, `scripts/run-unity-editmode.mjs` — visual checks require the actual Editor in Play Mode.

## CODE MAP

- `createApp` (function, `src/server/app.ts`, 3 refs) — builds authenticated HTTP and WebSocket surfaces.
- `ConnectorHub` (class, `src/server/connector.ts`, 8 refs) — owns Unity socket, RPC lifecycle, cached disconnected state, and events.
- `createDemoStore` / `UnityStore` (function/interface, `src/server/store.ts`, 5 refs / central) — fixture-backed broker behavior without a Unity connection; shared abstraction for demo, live Unity, and frozen state.
- `runCli` (function, `src/cli/index.ts`, 2 refs) — executes the JSON command surface and maps typed failures to exit codes.
- `PROTOCOL_VERSION` (constant, `src/contracts/protocol.ts`, 5 refs) — version sentinel shared by sessions and connector handshakes.
- `UnityRemoteBridge` (static class, `unity-package/Editor/UnityRemoteBridge.cs`, central) — captures authoritative Unity state and applies serialized edits.
- `ConnectorDispatch.Invoke` (method, `unity-package/Editor/ConnectorDispatch.cs`, central) — maps broker RPC names to Unity Editor operations.

## CONVENTIONS

- Parse external JSON with Zod at HTTP/WebSocket boundaries; never pass unchecked envelopes into stores. Keep NodeNext `.js` import suffixes in server, CLI, and tests; the web build uses Bundler resolution and extensionless imports.
- Mutations require `projectId`, stable object/component IDs, a serialized property path, and `expectedRevision`; identity is `GlobalObjectId` and editable fields are `SerializedProperty.propertyPath` values; preview and apply are separate calls, and scene mutation and scene save are separate operations.
- The broker writes a per-launch token to `.unity-remote-token`; browser bootstrap converts it to an HttpOnly `SameSite=Strict` session cookie. A missing Unity connector uses the writable demo fixture; a connector that disconnects after live use leaves a frozen read-only snapshot.

## ANTI-PATTERNS (THIS PROJECT)

- Do not edit Unity YAML directly or add arbitrary C# execution, shell, menu, package, or build RPCs.
- Do not weaken Host/Origin checks or expose the bearer token in HTML, browser query strings, or `GET /api/session`.
- Do not silently merge stale edits — preserve drafts and surface `REVISION_CONFLICT`; do not make Play Mode, Game View, or input appear available in demo/frozen stores.
- Do not edit generated `*.csproj`, `*.sln*`, `dist/`, `Library/`, `Temp/`, or `Logs/` artifacts, and do not change only one protocol representation: TypeScript, JSON Schema, C#, fixtures, and tests form one contract.

## UNIQUE STYLES

- The CLI is JSON-first for AI consumers and uses status-derived exit codes: success `0`, request/domain failure `2`, internal/server failure `1`.
- The web client shows command previews, authoritative rereads, revision conflicts, Undo group names, dirty scene state, and a capped activity feed; real Unity writes are constrained scalar `SerializedProperty` edits with one named Undo group and an authoritative reread.
- LAN and Tailscale access are allowed only for trusted address ranges, local hostnames, or explicit `UNITY_REMOTE_ALLOWED_HOSTS`; the Unity connector remains loopback-oriented.

## COMMANDS

```bash
npm install
npm run dev
npx vite --host 0.0.0.0 --port 5173
npm run typecheck
npm test
npm run build
npm run test:unity
```

## NOTES

- `src/web/main.tsx`, `tests/connector.test.ts`, and `unity-package/Editor/UnityRemoteBridge.cs` are current size hotspots — make focused edits and avoid unrelated expansion. `npm run test:unity` discovers Unity under `/Applications/Unity/Hub/Editor` or uses `UNITY_EDITOR`; results and logs go under ignored `.omo/evidence/`.
- Live Game View and input verification is not equivalent to demo-store tests: use a connected Unity Editor with a camera and Play Mode. Existing uncommitted product-code changes may be present; do not reset or overwrite them while working on guidance or verification.

