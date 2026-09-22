# SERVER KNOWLEDGE BASE

## OVERVIEW

Fastify broker domain for authenticated HTTP/WebSocket access, demo/live/frozen store selection, LAN admission, and typed Unity RPC; score 11, distinct security and authority boundary.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Register routes and auth hooks | `app.ts` | `/api/*`, `/connector`, `/events`, browser session, static web fallback |
| Change Unity RPC lifecycle | `connector.ts` | Authentication, pending calls, 10 s timeout, response parsing, reconnect state |
| Change state semantics | `store.ts` | `UnityStore`, writable demo fixture, revision behavior, unavailable feature errors |
| Change LAN trust rules | `hosts.ts` | Loopback/private/Tailscale ranges, local hostnames, explicit allowlist |
| Change structured errors | `errors.ts` | Stable codes, status mapping, JSON envelopes |
| Change process startup | `index.ts` | Token/nonce generation, `.unity-remote-token`, bind host, shutdown |

## CONVENTIONS

- `createApp` accepts explicit secrets, hub, allowlist, and optional `webRoot` so tests can use `app.inject` without starting the process entry point.
- Resolve the active store per request: live Unity wins; a previously connected Editor becomes frozen after disconnect; otherwise use the demo store.
- Validate request bodies before calling stores and validate every Unity RPC response before resolving a pending call.
- Broadcast only parsed `ProtocolEvent` values; mutation/store methods emit the corresponding project/object/scene event.
- Authentication uses timing-safe byte comparison for equal-length secrets.
- Keep browser cookie auth and bearer auth as separate supported paths; connector/events handshakes use the connector hello envelope.

## ANTI-PATTERNS

- Never bypass `isAllowedHostHeader` or `isAllowedOrigin` for authenticated routes; valid credentials do not make public hosts trusted.
- Never leak arbitrary exception messages from the top-level error handler; unexpected failures return fixed `INTERNAL_ERROR` details.
- Never leave a pending connector RPC until timeout after malformed Unity JSON or an incompatible response; fail and reject immediately.
- Never route writes to cached frozen state after Unity disconnects.
- Never add raw payload casts where a protocol schema can parse the boundary.
- Never reuse the demo implementation to claim live-only Play Mode, Game View, or input support.

## NOTES

- `app.ts`, `connector.ts`, and `store.ts` are tightly coupled through `UnityStore`; changing a method requires protocol, live, demo/frozen, route, client, and test coverage.
- `hosts.ts` intentionally trusts RFC1918, loopback, link-local, ULA, and CGNAT/Tailscale ranges; public IPs require no implicit exception.
- `index.ts` serves `dist/web` only when it exists and otherwise prints the Vite command in the startup banner.
- Related checks are `tests/app-security.test.ts`, `tests/http-routes.test.ts`, `tests/connector.test.ts`, `tests/hosts.test.ts`, `tests/play-mode.test.ts`, `tests/game-view.test.ts`, and `tests/input.test.ts`.

