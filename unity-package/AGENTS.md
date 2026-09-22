# UNITY PACKAGE KNOWLEDGE BASE

## OVERVIEW

Unity 6 Editor-only UPM package implementing the authoritative side of the protocol and its EditMode tests; score 15, separate runtime/toolchain domain from the Node broker.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Capture hierarchy/components | `Editor/UnityRemoteBridge.cs` | GlobalObjectId identity, revision fingerprints, serialized scalar exposure |
| Dispatch broker methods | `Editor/ConnectorDispatch.cs` | Exact switch over protocol RPC method names |
| Connect to the broker | `Editor/UnityRemoteConnector.cs` | Loopback WebSocket, token resolution, main-thread queue, event coalescing |
| Serialize protocol data | `Editor/Protocol.cs`, `Editor/ProtocolJson.cs` | C# mirror of JSON Schema/Zod contract |
| Control Play Mode | `Editor/UnityRemotePlayMode.cs` | Query and transition through Editor APIs |
| Capture Game View | `Editor/UnityRemoteGameView.cs` | JPEG frame from `Camera.main` or fallback camera |
| Inject remote input | `Editor/UnityRemoteInput.cs` | Validated key and pointer events in Play Mode |
| Change package settings | `Editor/UnityRemoteSettings.cs`, `package.json` | EditorPrefs keys and Unity/Newtonsoft dependency |
| Extend EditMode coverage | `Tests/Editor/` | NUnit tests run by the host project's Unity Editor |

## CONVENTIONS

- Keep all code under the Editor assembly; this package is not a player-runtime dependency.
- Execute Unity API work on the Editor main thread via the connector queue.
- Use `GlobalObjectId` for both GameObjects and components; do not identify duplicate components by type or array position.
- Advertise and write only supported scalar `SerializedProperty` kinds; vector fields are exposed as axis property paths.
- Apply an edit as one named Undo group, mark the scene dirty, bump revisions, then reread the authoritative property value.
- Resolve connector URL/token from environment first, then EditorPrefs, then the project-root `.unity-remote-token` fallback.
- Coalesce Editor change notifications before sending protocol events; connection/RPC loops remain asynchronous.

## ANTI-PATTERNS

- Never touch Unity objects from the connector background task; enqueue work through `RunOnMainThread`.
- Never edit scene or prefab YAML directly; use Editor and serialization APIs.
- Never save a scene as a side effect of an edit; `SaveScene` is an explicit separate RPC.
- Never accept a missing, wrong-project, stale-revision, unknown-component, or non-editable-property mutation.
- Never return raw exception details for unexpected connector failures; send `ErrorBody.Internal()`.
- Never hand-edit generated root `*.csproj` or solution files; Unity regenerates them.
- Never treat static test success as visual proof; Game View and input require live Editor Play Mode verification.

## NOTES

- `Editor/UnityRemoteBridge.cs` is the main hotspot and owns capture, validation, write, revision, and event semantics; keep edits surgical.
- `Editor/Protocol.cs` must remain wire-compatible with `src/contracts/protocol.ts` and `contracts/unity-remote.schema.json`.
- EditMode tests create temporary scenes under `Assets/Scenes` and remove them in `finally`; preserve cleanup on failure paths.
- Run `npm run test:unity` from the repository root; it targets `Islee.UnityRemote.Editor.Tests` and writes XML/log evidence under `.omo/evidence/`.
- After any package edit, import/compile in the actual Unity Editor before claiming runtime success.

