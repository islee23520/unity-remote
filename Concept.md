# Unity Remote

Unity Remote is a tool for inspecting a Unity project's structure, editing supported scene properties from a web client on the same machine or LAN, and exporting the same structured context for AI tools through a CLI.

## Product goals

- Treat the running Unity Editor as the authority for scene and prefab state.
- Expose project assets, loaded scenes, GameObject hierarchy, components, and editable serialized properties through one canonical data contract.
- Give humans a responsive web hierarchy and inspector with explicit previews, revisions, undo groups, and save controls.
- Give AI agents a stable JSON CLI for inspection, context export, validated edits, and audit history.
- Keep Unity Editor authority and mutations on the Editor machine, while allowing an authenticated web client on the same LAN or over a Tailscale-style tunnel (MagicDNS or hosts listed in `UNITY_REMOTE_ALLOWED_HOSTS`).
- Require explicit project selection and revision preconditions.

## Stack

- Unity Editor package in C# using Editor scripting APIs.
- TypeScript broker and CLI running on Node.js, reachable from loopback and the LAN.
- React and TypeScript web client.
- HTTP for commands and snapshots, WebSocket for hierarchy/property change events.
- Shared JSON Schema contracts between the broker, web client, and CLI.

## Safety boundaries

- No raw Unity YAML editing.
- No arbitrary C# execution, shell commands, menu invocation, package installation, or build commands.
- Every mutation includes a target identity, expected revision, before/after preview, named Undo group, and authoritative reread.
- Scene mutation and scene save are separate operations.
- Destructive and prefab-affecting actions require explicit confirmation.

## Initial release

The first module provides a demo-compatible broker, hierarchy/inspector web client, AI context CLI, and a Unity Editor package contract for connecting a real project. It supports reading project and scene structure, editing a constrained set of serialized properties, exporting JSON context, and reporting structured errors. The broker is reachable from the LAN or a Tailscale-style tunnel with token authentication. Play Mode control is part of the current module: the web client and CLI can enter, exit, and query the Editor's play state. Game View streaming is part of the current module: the web client polls JPEG frames from the Editor camera and displays them in a dedicated pane. Remote keyboard and mouse input is part of the current module: focused Game View key and pointer events are forwarded into Play Mode.
