# Unity Remote

Unity scene inspection and editing through a web client on the local machine or LAN, with a structured CLI for sharing the same project context with AI tools.

See [Concept.md](Concept.md), [Design.md](Design.md), and [ToDo.md](ToDo.md) for the active product scope. The shared v1 contract lives in [contracts/unity-remote.schema.json](contracts/unity-remote.schema.json).

## Local development

```bash
npm install
npm run build
npm run dev
```

After the web client has been built, open a URL printed at startup. The broker listens on all interfaces by default so another machine on the same LAN can open `http://<lan-ip>:4173`. For Vite hot reload:

```bash
npx vite --host 0.0.0.0 --port 5173
```

The broker requires a per-launch bearer token and rejects public `Host` and `Origin` values. Loopback, RFC1918 LAN addresses, Tailscale/CGNAT `100.64.0.0/10`, this machine's hostname, and `UNITY_REMOTE_ALLOWED_HOSTS` are allowed. `npm run dev` writes the token to `.unity-remote-token` for the CLI and Unity connector. The web client never receives that token in HTML or query strings: open a one-time bootstrap URL printed at startup, or paste the token into the session form to set an HttpOnly cookie. Direct API and CLI calls still send the bearer token; `GET /api/session` never returns it.

Bind loopback only with `UNITY_REMOTE_BIND=127.0.0.1`. Add extra names such as a Tailscale MagicDNS or public hostname with `UNITY_REMOTE_ALLOWED_HOSTS=machine.tailnet.ts.net,studio.example`.

The Unity Editor package still connects outbound to `ws://127.0.0.1:4173/connector` on the same machine using the same token. The connector reads its broker URL and token from the EditorPrefs keys `Islee.UnityRemote.BrokerUrl` and `Islee.UnityRemote.Token`, defaulting to `ws://127.0.0.1:4173/connector` and the token written by `npm run dev`. While it is connected, a browser on this machine or the LAN can read and mutate Editor state. When it is absent, the broker serves a writable demo fixture.

## AI context CLI

```bash
npm run build
unity-remote --token-file .unity-remote-token project
unity-remote --token-file .unity-remote-token inspect go-main-camera --project project-player
unity-remote --token-file .unity-remote-token edit --project project-player --object go-main-camera --component-id cmp-main-camera-transform --property m_LocalPosition.x --value 4 --expect-revision 1
unity-remote --token-file .unity-remote-token edit --project project-player --object go-main-camera --component-id cmp-main-camera-transform --property m_LocalPosition.x --value 4 --expect-revision 1 --apply
unity-remote --token-file .unity-remote-token save --project project-player --scene scene-main
unity-remote --token-file .unity-remote-token context --project project-player --objects go-main-camera
```

`unityctx` remains an alias of `unity-remote`. Mutations require an explicit `--project` and print a before/after preview unless `--apply` is passed.

## Play Mode control

The web client shows a play-state indicator with Play and Stop buttons in the top bar. The same control is available from the CLI:

```bash
unity-remote --token-file .unity-remote-token play            # query current play state
unity-remote --token-file .unity-remote-token play --enter    # enter Play Mode
unity-remote --token-file .unity-remote-token play --exit     # exit Play Mode
```

`--enter` and `--exit` are mutually exclusive. Play Mode control requires a connected Unity Editor; the demo fixture reports it as unavailable.

## Game View

The web client adds a Game View pane between the hierarchy and inspector. While the session is ready it polls `GET /api/game-view` every 250ms and displays the JPEG (`<img alt="Game View">`). The same frame is available from the CLI:

```bash
unity-remote --token-file .unity-remote-token game-view
```

Game View requires a connected Unity Editor with a camera. The demo fixture reports it as `DISCONNECTED`.

Keyboard and mouse events from the focused Game View pane are forwarded with `POST /api/input` (`sendGameInput`). The CLI equivalent is:

```bash
unity-remote --token-file .unity-remote-token input --type keyDown --key w
```

Input requires a connected Unity Editor in Play Mode. The demo fixture reports it as `DISCONNECTED`.

## Unity Editor package

Add `unity-package` as a local package in a Unity 6 project. `UnityRemoteConnector` authenticates to the local broker and executes supported commands through Unity APIs. Objects are addressed with `GlobalObjectId`. Components are addressed with their own `GlobalObjectId`, and properties use `SerializedProperty.propertyPath`. Edits require the expected revision, apply as one named Undo group, reread the authoritative value, and leave saving as a separate command.
