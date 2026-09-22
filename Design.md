# Unity Remote Web Client Design

## Visual contract: Shadow Editor chrome (2026-09-07)

The workspace chrome is a faithful adaptation of the open-source **Shadow Editor** web editor
(https://github.com/tengge1/ShadowEditor, MIT), extracted at runtime from the live demo
(https://www.hylab.cn/demo/shadoweditor/, r107) with `getComputedStyle`, plus its featured README
screenshot. three.js editor (https://threejs.org/editor/) is the secondary structural reference.
All values below are measured, not invented.

### Tokens (measured from the live editor)

| Token | Value | Source |
|---|---|---|
| accent blue | `#3399FF` | selected tab text + 1px underline, active tool |
| panel header slate | `#2C3E50`, white 12px text, 24px tall | `AccordionPanel .header` |
| danger red | `#E74C3C` white text, 20px button | status-bar Screenshot/Record buttons |
| success green | `#2ECC71` | toolbar play control |
| panel body | `#FAFAFA` | `AccordionPanel` body |
| chrome surface | `#FFFFFF` | menubar, tab bars, status bar |
| border | `#D9D9D9` 1px | inputs, toolbar separation |
| hover | `#EEEEEE` | list/menu hover rows |
| selection tint | `#E6F2FF` | selected rows |
| primary text | `#000000` menubar 13px; `#555555` rows 12px; `#737373` inactive tabs 12px | sweeps |
| warn strip | `#FCF8E3` bg / `#E7C66F` border / `#8A6D3B` text | period-correct light-UI notice |
| viewport letterbox | `#DADADA` | scene background |
| font stack | `-apple-system, "Segoe UI", "Apple SD Gothic Neo", "Microsoft YaHei", sans-serif` | runtime stacks |
| type scale | 13px menubar · 12px UI/rows/labels · 16px object title · 10px mono ids | sweeps |

### Layout geometry (measured)

- Menubar 25px (items 24px, padding 0 16px) · toolbar 36px · tab bar 32px (selected = blue text + 1px blue underline) · status bar 25px.
- Left column 240px, right column 260px (240 in the source; +20 for editable property rows with apply controls), center viewport fluid.
- Bottom console strip 160px (source timeline height) with a 25px toolbar row.
- Tree rows 24px; inputs 23px tall, 1px `#D9D9D9` border, radius 0; buttons radius 0.
- Scroll ownership: only panel bodies and the console scroll (`min-height: 0` bounded shell, `100dvh` app height). Menubar, toolbar, tab bars, and status bar stay fixed.

### Component anatomy

- **Menubar**: real menus only — File (Refresh Snapshot, Save Scene, Copy AI Context), Play (Enter/Exit Play Mode), View (Toggle Console), Help (About). Open on click, dropdown white with `#D9D9D9` border.
- **Toolbar**: connection chip (dot + source + Unity version) left; Play/Stop transport center (green/red, disabled state gray); play-state badge + revision right.
- **Left panel**: dark-slate accordion headers (Project, Asset Roots); scene rows with dirty badge; project summary card.
- **Center**: Game View JPEG letterboxed on `#DADADA`, cyan-black stats chip (source FPS-chip styling) showing frame size; keyboard/pointer input forwarding unchanged.
- **Right top**: tab bar (Hierarchy | Context) over the search field + tree; expand caret, per-row visibility checkbox (disabled when read-only), selected row blue text on selection tint.
- **Right bottom**: object header + component accordions (light `#F5F5F5` headers with foldout, per source property groups); property rows label/value; editable rows expose BEFORE/AFTER diff and an Apply control; revision conflict keeps drafts and shows the refresh notice.
- **Console strip**: activity feed with tone dots; Clear action styled like the source status-bar buttons.
- **Status bar**: object/scene counts, connection source, protocol revision, read-only chip.
- **Session window**: centered 300px window with slate title bar, light body, blue primary button.

### Motion and accessibility

- 120ms background-color transition on hoverable rows/menus only; `prefers-reduced-motion` disables it. No decorative animation.
- No emojis; tree rows pair the caret with a real visibility checkbox (the previous read-only eye indicator is gone).
- Tree keeps `role="tree"/"treeitem"`; inputs keep labels; status regions keep `role="status"`; focus outlines stay visible (default outline preserved on interactive elements).

### Documented adaptations from the source

1. Right column 260px instead of 240px (editable property rows need an input + apply column).
2. The source animation timeline is replaced by the real Console strip — a fake timeline would be non-functional.
3. [Superseded] Source tree checkboxes now control actual GameObject visibility, sending a `setActive` RPC with an inspect-then-mutate revision check.
4. Banners use period-correct light notice strips (the source has none because it has no disconnected mode).
5. Dark-slate accordion headers are used for left-panel sections; component groups keep the source's light headers.
6. The left column, right column, and console strip are user-resizable with clamps (left 200-360px, right 240-400px, console 100-320px) and persisted in localStorage.
7. A toolbar Maximize Game View toggle hides the columns and console, expanding the viewport.
8. Keyboard shortcuts Cmd/Ctrl+S (Save Scene) and Cmd/Ctrl+F (Focus Search) map to existing UI flows.

## Original workspace design (superseded for chrome; interactions still authoritative)

The application uses an editor layout with these functional panes:

1. **Project and scene navigator** — connected project, loaded scenes, asset roots, connection and revision state.
2. **Hierarchy** — lazily expandable GameObject tree with search and active-state markers.
3. **Game View** — polled JPEG of the Editor camera (Camera.main, otherwise the first camera).
4. **Inspector** — selected object identity, Transform, supported serialized component properties, revision, and edit controls.

A bottom activity panel shows command previews, authoritative results, Undo group names, save state, and audit entries.

## Core interactions

### Inspect

- Select a connected project and loaded scene.
- Expand hierarchy nodes on demand.
- Select a GameObject to fetch its component/property schema and values.
- Copy the selected object or scene as AI-ready JSON context.

### Edit

- Change an editable field in the inspector.
- Review the exact before/after value and target revision.
- Apply the edit as one named Unity Undo group.
- Display the authoritative reread value and new revision.
- Keep the scene dirty until the user explicitly saves it.

### Conflicts and errors

- A stale revision keeps the form values and presents a refresh action; it never silently merges.
- Missing scenes or objects use structured error codes and preserve navigation state.
- Disconnected Editor state makes the workspace read-only and explains how to reconnect.

## Visual direction

- Superseded by the Shadow Editor chrome contract above for all visual values; the interaction rules below still hold.
- Dense professional editor UI rather than a marketing dashboard.
- Monospace IDs and revisions; human-readable names remain primary.
- Keyboard-accessible tree navigation and clearly visible focus states.
- Responsive down to a laptop viewport; small screens stack hierarchy above the property panel and the console stays collapsible.

## First-module QA flow

Run the local broker and web client, open the real page in Aside Browser, select `Main Camera`, change its Transform position X value, apply the preview, and pass only when the inspector and activity panel show the authoritative changed value and new revision.

## Remote access QA flow

Start the broker, copy a LAN or Tailscale bootstrap URL from the startup log, and open it from another device on the same network or tailnet. Pass only when the workspace loads the connected project without using `127.0.0.1` in the browser address bar. The workspace shows the navigator, hierarchy, Game View, and inspector panes.

## Play Mode QA flow

Run the broker with a connected Unity Editor, then press Play in the web client or run `unity-remote play --enter` from the CLI. Pass only when the Editor's play state matches the requested state and the web client's play-state indicator updates to match. Repeat with Stop or `unity-remote play --exit` to confirm exit.

## Game View QA flow

Run the broker with a connected Unity Editor that has a camera (`Camera.main` or any camera). Open the web workspace. Pass only when the Game View pane shows a non-blank JPEG of the Editor camera, not an empty or black placeholder. The demo fixture reports Game View as unavailable (`DISCONNECTED`).

## Input QA flow

With the Editor in Play Mode and the Game View pane focused, press a key or click in the pane. Pass only when that keyboard or mouse event reaches Play Mode (the running game reacts). The demo fixture reports input as unavailable (`DISCONNECTED`). Remote input requires Play Mode.
