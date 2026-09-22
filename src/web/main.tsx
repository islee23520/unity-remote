import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  EditRequest,
  GameInput,
  GameViewFrame,
  HierarchyNode,
  ObjectSnapshot,
  PlayState,
  ProjectSnapshot,
  ScalarValue
} from "../contracts/protocol";
import { createApi, createSession, openEventSocket, readSession } from "./api";
import { createToggleQueue } from "./toggleQueue";
import "./styles.css";

type Activity = { title: string; detail: string; tone: "info" | "success" | "error" };
type Api = ReturnType<typeof createApi>;
type Drafts = Record<string, string>;

type VisibleRow = { node: HierarchyNode; depth: number };

function flatten(nodes: HierarchyNode[], expanded: Set<string>, depth = 0): VisibleRow[] {
  const rows: VisibleRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (expanded.has(node.id) && node.children.length > 0) {
      rows.push(...flatten(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

function filterTree(nodes: HierarchyNode[], query: string): HierarchyNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return nodes;
  }
  const keep = (node: HierarchyNode): HierarchyNode | undefined => {
    const children = node.children.map(keep).filter((item): item is HierarchyNode => item !== undefined);
    if (node.name.toLowerCase().includes(needle) || children.length > 0) {
      return { ...node, children };
    }
    return undefined;
  };
  return nodes.map(keep).filter((item): item is HierarchyNode => item !== undefined);
}

function collectIds(nodes: HierarchyNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    into.push(node.id);
    collectIds(node.children, into);
  }
  return into;
}

function errorDetail(error: unknown): string {
  if (typeof error === "object" && error && "error" in error) {
    const envelope = error as { error: { code?: string; message?: string } };
    return `${envelope.error.code ?? "ERROR"}: ${envelope.error.message ?? JSON.stringify(error)}`;
  }
  return error instanceof Error ? error.message : JSON.stringify(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error && "error" in error) {
    return (error as { error: { code?: string } }).error.code;
  }
  return undefined;
}

function countNodes(nodes: HierarchyNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

function findHierarchyNode(nodes: HierarchyNode[], objectId: string): HierarchyNode | undefined {
  for (const node of nodes) {
    if (node.id === objectId) {
      return node;
    }
    const child = findHierarchyNode(node.children, objectId);
    if (child) {
      return child;
    }
  }
  return undefined;
}

function updateHierarchyNode(
  nodes: HierarchyNode[],
  objectId: string,
  update: (node: HierarchyNode) => HierarchyNode
): HierarchyNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === objectId) {
      changed = true;
      return update(node);
    }
    const children = updateHierarchyNode(node.children, objectId, update);
    if (children !== node.children) {
      changed = true;
      return { ...node, children };
    }
    return node;
  });
  return changed ? next : nodes;
}

function draftKey(componentId: string, property: string): string {
  return `${componentId}::${property}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizePointer(event: React.PointerEvent<HTMLElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
  const y = rect.height <= 0 ? 0 : (event.clientY - rect.top) / rect.height;
  return { x: clamp01(x), y: clamp01(y) };
}

function App(): React.ReactElement {
  const [api, setApi] = useState<Api>();
  const [sessionState, setSessionState] = useState<"checking" | "needed" | "ready">("checking");
  const [tokenDraft, setTokenDraft] = useState("");
  const [loginError, setLoginError] = useState<string>();
  const [project, setProject] = useState<ProjectSnapshot>();
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selected, setSelected] = useState<ObjectSnapshot>();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState(false);
  const [playState, setPlayState] = useState<PlayState>();
  const [playIssue, setPlayIssue] = useState<string>();
  const [playPending, setPlayPending] = useState(false);
  const [gameViewFrame, setGameViewFrame] = useState<GameViewFrame>();
  const [gameViewIssue, setGameViewIssue] = useState<string>();
  const [activities, setActivities] = useState<Activity[]>([
    { title: "Workspace ready", detail: "Waiting for Unity scene commands.", tone: "info" }
  ]);
  const [openMenu, setOpenMenu] = useState<string>();
  const [rightTopTab, setRightTopTab] = useState<"hierarchy" | "context">("hierarchy");
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [collapsedComponents, setCollapsedComponents] = useState<ReadonlySet<string>>(new Set());
  const projectRef = useRef<ProjectSnapshot | undefined>(undefined);
  const pendingActiveRef = useRef(new Map<string, boolean>());
  const projectLoadRef = useRef(0);

  const [uiStateLoaded, setUiStateLoaded] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(260);
  const [consoleHeight, setConsoleHeight] = useState(160);
  const [resizing, setResizing] = useState<"left" | "right" | "console" | null>(null);
  const capturedResizerRef = useRef<{ element: HTMLElement; pointerId: number } | undefined>(undefined);

  const endResize = useCallback(() => {
    const captured = capturedResizerRef.current;
    if (captured?.element.hasPointerCapture(captured.pointerId)) {
      captured.element.releasePointerCapture(captured.pointerId);
    }
    capturedResizerRef.current = undefined;
    setResizing(null);
  }, []);

  const beginResize = useCallback((event: React.PointerEvent<HTMLDivElement>, target: "left" | "right" | "console") => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    capturedResizerRef.current = { element: event.currentTarget, pointerId: event.pointerId };
    setResizing(target);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      if (resizing === "left") {
        setLeftWidth(clamp(e.clientX, 200, 360));
      } else if (resizing === "right") {
        setRightWidth(clamp(window.innerWidth - e.clientX, 240, 400));
      } else if (resizing === "console") {
        setConsoleHeight(clamp(window.innerHeight - e.clientY, 100, 320));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
    };
  }, [endResize, resizing]);

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("unity-remote.ui-state");
      if (saved) {
        const state = JSON.parse(saved) as Record<string, unknown>;
        if (typeof state.leftWidth === "number") setLeftWidth(clamp(state.leftWidth, 200, 360));
        if (typeof state.rightWidth === "number") setRightWidth(clamp(state.rightWidth, 240, 400));
        if (typeof state.consoleHeight === "number") setConsoleHeight(clamp(state.consoleHeight, 100, 320));
        if (typeof state.consoleOpen === "boolean") setConsoleOpen(state.consoleOpen);
        if (typeof state.maximized === "boolean") setMaximized(state.maximized);
        if (state.rightTopTab === "hierarchy" || state.rightTopTab === "context") {
          setRightTopTab(state.rightTopTab);
        }
      }
    } catch {}
    setUiStateLoaded(true);
  }, []);

  useEffect(() => {
    if (uiStateLoaded) {
      localStorage.setItem(
        "unity-remote.ui-state",
        JSON.stringify({
          leftWidth,
          rightWidth,
          consoleHeight,
          consoleOpen,
          maximized,
          rightTopTab
        })
      );
    }
  }, [leftWidth, rightWidth, consoleHeight, consoleOpen, maximized, rightTopTab, uiStateLoaded]);

  const apiRef = useRef(api);
  const selectedIdRef = useRef(selectedId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const draftsRef = useRef(drafts);
  const conflictRef = useRef(conflict);
  apiRef.current = api;
  selectedIdRef.current = selectedId;
  selectedProjectIdRef.current = selectedProjectId;
  draftsRef.current = drafts;
  conflictRef.current = conflict;

  const pushActivity = useCallback((activity: Activity) => {
    setActivities((current) => [activity, ...current].slice(0, 40));
    // Request animation frame to let React render first
    requestAnimationFrame(() => {
      if (consoleRef.current) {
        consoleRef.current.scrollTop = 0;
      }
    });
  }, []);

  const loadProject = useCallback(async (client: Api) => {
    const loadId = ++projectLoadRef.current;
    const snapshot = await client.project();
    let hierarchy = snapshot.hierarchy;
    for (const [objectId, active] of pendingActiveRef.current) {
      hierarchy = updateHierarchyNode(hierarchy, objectId, (node) => ({ ...node, active }));
    }
    const current = hierarchy === snapshot.hierarchy ? snapshot : { ...snapshot, hierarchy };
    if (loadId !== projectLoadRef.current) {
      return current;
    }
    projectRef.current = current;
    setProject(current);
    setSelectedProjectId((selectedProject) => selectedProject ?? snapshot.project.id);
    setSelectedSceneId((selectedScene) => selectedScene ?? snapshot.scenes[0]?.id);
    setExpanded((expandedNodes) => {
      if (expandedNodes.size > 0) {
        return expandedNodes;
      }
      return new Set(snapshot.hierarchy.map((node) => node.id));
    });
    return current;
  }, []);

  const loadProjectRef = useRef(loadProject);
  loadProjectRef.current = loadProject;

  // Play state is polled on demand rather than pushed, so an unreachable Editor would otherwise
  // repeat the same DISCONNECTED entry on every refresh. Report each distinct failure once.
  const lastPlayFailureRef = useRef<string | undefined>(undefined);

  const refreshPlayState = useCallback(async (client: Api) => {
    try {
      const state = await client.playState();
      setPlayState(state);
      setPlayIssue(undefined);
      lastPlayFailureRef.current = undefined;
    } catch (error: unknown) {
      const detail = errorDetail(error);
      setPlayState(undefined);
      setPlayIssue(errorCode(error) ?? "ERROR");
      if (lastPlayFailureRef.current !== detail) {
        lastPlayFailureRef.current = detail;
        pushActivity({ title: "Play state unavailable", detail, tone: "error" });
      }
    }
  }, [pushActivity]);

  const refreshPlayStateRef = useRef(refreshPlayState);
  refreshPlayStateRef.current = refreshPlayState;

  const lastGameViewFailureRef = useRef<string | undefined>(undefined);
  const lastInputFailureRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!api || sessionState !== "ready") {
      return;
    }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const frame = await api.gameView();
        if (cancelled) {
          return;
        }
        setGameViewFrame(frame);
        setGameViewIssue(undefined);
        lastGameViewFailureRef.current = undefined;
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        const detail = errorDetail(error);
        setGameViewIssue(detail);
        if (lastGameViewFailureRef.current !== detail) {
          lastGameViewFailureRef.current = detail;
          pushActivity({ title: "Game View unavailable", detail, tone: "error" });
        }
      }
    };
    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [api, pushActivity, sessionState]);

  const sendGameInput = useCallback(async (payload: GameInput): Promise<void> => {
    if (!api) {
      return;
    }
    try {
      await api.sendInput(payload);
      lastInputFailureRef.current = undefined;
    } catch (error: unknown) {
      const detail = errorDetail(error);
      if (lastInputFailureRef.current !== detail) {
        lastInputFailureRef.current = detail;
        pushActivity({ title: "Input rejected", detail, tone: "error" });
      }
    }
  }, [api, pushActivity]);

  const startWorkspace = useCallback(async (client: Api) => {
    setApi(client);
    setSessionState("ready");
    try {
      await loadProject(client);
    } catch (error: unknown) {
      pushActivity({ title: "Broker unavailable", detail: errorDetail(error), tone: "error" });
    }
    await refreshPlayState(client);
  }, [loadProject, pushActivity, refreshPlayState]);

  useEffect(() => {
    void (async () => {
      try {
        await readSession();
        await startWorkspace(createApi());
      } catch {
        setSessionState("needed");
      }
    })();
  }, [startWorkspace]);

  const submitSession = async (event: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await createSession(tokenDraft);
      setTokenDraft("");
      setLoginError(undefined);
      await startWorkspace(createApi());
    } catch (error: unknown) {
      setLoginError(errorDetail(error));
    }
  };

  useEffect(() => {
    if (!api) {
      return;
    }
    const socket = openEventSocket({
      onEvent: (event) => {
        const client = apiRef.current;
        if (!client) {
          return;
        }
        if (event.type === "connection" || event.type === "hierarchyChanged" || event.type === "sceneSaved") {
          void loadProjectRef.current(client);
        }
        if (event.type === "playModeChanged" || event.type === "connection") {
          void refreshPlayStateRef.current(client);
        }
        if (
          event.type === "propertyChanged" &&
          event.objectId &&
          event.objectId === selectedIdRef.current &&
          !conflictRef.current &&
          Object.keys(draftsRef.current).length === 0
        ) {
          void client.object(event.objectId, selectedProjectIdRef.current ?? "").then((object) => {
            setSelected(object);
            setDrafts({});
          });
        }
      },
      onStatus: (status, detail) => {
        if (status === "error") {
          pushActivity({ title: "Event socket error", detail: detail ?? "Event connection failed.", tone: "error" });
        }
      }
    });
    return () => socket.close();
  }, [api, pushActivity]);

  useEffect(() => {
    if (!api || !selectedId || !selectedProjectId) {
      return;
    }
    if (selectedId.startsWith("scene:")) {
      setSelected(undefined);
      setDrafts({});
      return;
    }
    void api
      .object(selectedId, selectedProjectId)
      .then((object) => {
        setSelected(object);
        setDrafts({});
        setConflict(false);
      })
      .catch((error: unknown) => {
        pushActivity({ title: "Inspect failed", detail: errorDetail(error), tone: "error" });
      });
  }, [api, pushActivity, selectedId, selectedProjectId]);

  const scene = project?.scenes.find((item) => item.id === selectedSceneId);
  const connected = project?.project.connected ?? false;
  const readOnly = !connected;
  const selectedProjectMatches = selectedProjectId === project?.project.id;

  const playLabel = playPending
    ? "WORKING"
    : playIssue
      ? playIssue
      : playState
        ? `${playState.playing ? "PLAYING" : "STOPPED"}${playState.transitioning ? " · TRANSITIONING" : ""}`
        : "UNAVAILABLE";
  const playTone = playPending || playState?.transitioning ? "warn" : playIssue ? "fault" : playState?.playing ? "live" : "";

  const visibleHierarchy = useMemo(() => {
    const filtered = filterTree(project?.hierarchy ?? [], search);
    return flatten(filtered, search.trim() ? new Set(collectIds(filtered)) : expanded);
  }, [expanded, project?.hierarchy, search]);

  const toggleQueueRef = useRef(createToggleQueue());

  const toggleActive = useCallback(
    (objectId: string) =>
      toggleQueueRef.current.enqueue(objectId, async () => {
        const client = apiRef.current;
        const projectId = selectedProjectIdRef.current;
        const current = projectRef.current ? findHierarchyNode(projectRef.current.hierarchy, objectId) : undefined;
        if (!client || !projectId || !current) return;

        const targetActive = !current.active;
        pendingActiveRef.current.set(objectId, targetActive);
        setProject((previous) => {
          if (!previous) return previous;
          const next = {
            ...previous,
            hierarchy: updateHierarchyNode(previous.hierarchy, objectId, (node) => ({ ...node, active: targetActive }))
          };
          projectRef.current = next;
          return next;
        });

        try {
          const fresh = await client.object(objectId, projectId);
          await client.setActive({
            projectId,
            objectId,
            active: targetActive,
            expectedRevision: fresh.revision
          });
          await loadProjectRef.current(client);
          pendingActiveRef.current.delete(objectId);
          pushActivity({
            title: "Set active",
            detail: `${fresh.name} is now ${targetActive ? "active" : "inactive"}.`,
            tone: "success"
          });
        } catch (error) {
          pendingActiveRef.current.delete(objectId);
          if (errorCode(error) === "REVISION_CONFLICT") {
            pushActivity({
              title: "Revision Conflict",
              detail: "The object was modified concurrently. Reverting.",
              tone: "error"
            });
          } else {
            pushActivity({
              title: "Set active failed",
              detail: errorDetail(error),
              tone: "error"
            });
          }
          await loadProjectRef.current(client);
        }
      }),
    [pushActivity]
  );

  const applyProperty = async (componentId: string, property: string): Promise<void> => {
    if (!api || !selected || !selectedProjectId) {
      return;
    }
    const component = selected.components.find((item) => item.id === componentId);
    const current = component?.properties[property];
    const raw = drafts[draftKey(componentId, property)];
    let value: ScalarValue = current ?? null;
    if (raw !== undefined) {
      if (typeof current === "number") {
        value = Number(raw);
      } else if (typeof current === "boolean") {
        value = raw === "true";
      } else if (raw === "null") {
        value = null;
      } else {
        value = raw;
      }
    }
    const payload: EditRequest = {
      projectId: selectedProjectId,
      objectId: selected.id,
      componentId,
      property,
      value,
      expectedRevision: selected.revision
    };
    try {
      const preview = await api.preview(payload);
      const result = await api.edit(payload);
      setSelected(result.object);
      setDrafts({});
      setConflict(false);
      setProject((currentProject) =>
        currentProject
          ? {
              ...currentProject,
              scenes: currentProject.scenes.map((item) =>
                item.id === result.object.sceneId ? { ...item, dirty: result.sceneDirty } : item
              )
            }
          : currentProject
      );
      pushActivity({
        title: "Edit applied",
        detail: `${result.undoGroup} · ${String(preview.before)} → ${String(result.after)} · revision ${result.object.revision}`,
        tone: "success"
      });
    } catch (error) {
      if (errorCode(error) === "REVISION_CONFLICT") {
        setConflict(true);
        pushActivity({ title: "Revision conflict", detail: errorDetail(error), tone: "error" });
        return;
      }
      pushActivity({ title: "Edit rejected", detail: errorDetail(error), tone: "error" });
    }
  };

  const refreshSelected = async (): Promise<void> => {
    if (!api || !selectedId || !selectedProjectId) {
      return;
    }
    const object = await api.object(selectedId, selectedProjectId);
    setSelected(object);
    setConflict(false);
  };

  const searchInputRef = useRef<HTMLInputElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const sceneDirtyRef = useRef(scene?.dirty);
  sceneDirtyRef.current = scene?.dirty;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skipped while a menubar dropdown is open
      if (openMenu) return;

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (sceneDirtyRef.current) {
          void saveSceneRef.current();
        }
      } else if (cmdOrCtrl && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    // Use capture phase
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [openMenu]);

  const saveScene = async (): Promise<void> => {
    if (!api || !selectedProjectId || !selectedSceneId) {
      return;
    }
    try {
      const result = await api.save(selectedProjectId, selectedSceneId);
      setProject((current) =>
        current
          ? { ...current, scenes: current.scenes.map((item) => (item.id === result.sceneId ? { ...item, dirty: false } : item)) }
          : current
      );
      pushActivity({ title: "Scene saved", detail: `${result.path} · revision ${result.revision}`, tone: "success" });
    } catch (error) {
      pushActivity({ title: "Save rejected", detail: errorDetail(error), tone: "error" });
    }
  };

  const saveSceneRef = useRef(saveScene);
  saveSceneRef.current = saveScene;

  const requestPlayMode = async (playing: boolean): Promise<void> => {
    if (!api || playPending) {
      return;
    }
    setPlayPending(true);
    try {
      const state = await api.setPlayMode(playing);
      setPlayState(state);
      setPlayIssue(undefined);
      lastPlayFailureRef.current = undefined;
      pushActivity({
        title: playing ? "Play Mode entered" : "Play Mode exited",
        detail: `playing ${String(state.playing)} · transitioning ${String(state.transitioning)}`,
        tone: "success"
      });
    } catch (error: unknown) {
      setPlayIssue(errorCode(error) ?? "ERROR");
      pushActivity({
        title: playing ? "Play rejected" : "Stop rejected",
        detail: errorDetail(error),
        tone: "error"
      });
    } finally {
      setPlayPending(false);
    }
  };

  const copyContext = async (): Promise<void> => {
    if (!api || !selectedProjectId) {
      return;
    }
    const context = await api.context(selectedProjectId, selectedId && !selectedId.startsWith("scene:") ? [selectedId] : []);
    await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
    pushActivity({ title: "AI context copied", detail: selectedId ?? selectedProjectId, tone: "success" });
  };

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const client = apiRef.current;
    if (!client) {
      return;
    }
    try {
      await loadProjectRef.current(client);
      pushActivity({ title: "Snapshot refreshed", detail: "Authoritative project state reread.", tone: "success" });
    } catch (error: unknown) {
      pushActivity({ title: "Refresh failed", detail: errorDetail(error), tone: "error" });
    }
  }, [pushActivity]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const close = (event: PointerEvent): void => {
      if ((event.target as HTMLElement | null)?.closest?.(".menubar")) {
        return;
      }
      setOpenMenu(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openMenu]);

  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maximized]);

  if (sessionState !== "ready") {
    return (
      <main className="session-screen">
        <div className="session-window">
          <header className="session-title">Unity Remote — Session</header>
          <form className="session-body" onSubmit={(event) => void submitSession(event)}>
            <p>
              {sessionState === "checking"
                ? "Checking the existing browser session."
                : "Paste the token from `.unity-remote-token` on the Unity machine, or open a local or LAN bootstrap URL printed when the broker starts."}
            </p>
            <label>
              Session token
              <input
                type="password"
                autoComplete="off"
                aria-label="Session token"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                disabled={sessionState === "checking"}
              />
            </label>
            {loginError && <p className="session-error">{loginError}</p>}
            <button className="primary" type="submit" disabled={sessionState === "checking" || tokenDraft.trim().length === 0}>
              Open Workspace
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`app${maximized ? " maximized" : ""}`}
      style={
        {
          "--se-left-w": `${leftWidth}px`,
          "--se-right-w": `${rightWidth}px`,
          "--se-console-h": `${consoleHeight}px`
        } as React.CSSProperties
      }
    >
      <ul className="menubar">
        <li className={`menu${openMenu === "file" ? " open" : ""}`}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "file"}
            onClick={() => setOpenMenu(openMenu === "file" ? undefined : "file")}
          >
            File
          </button>
          {openMenu === "file" && (
            <ul className="dropdown" role="menu">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(undefined);
                    void refreshSnapshot();
                  }}
                >
                  Refresh Snapshot
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={readOnly || !scene?.dirty}
                  onClick={() => {
                    setOpenMenu(undefined);
                    void saveScene();
                  }}
                >
                  Save Scene
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!project}
                  onClick={() => {
                    setOpenMenu(undefined);
                    void copyContext();
                  }}
                >
                  Copy AI Context
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className={`menu${openMenu === "play" ? " open" : ""}`}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "play"}
            onClick={() => setOpenMenu(openMenu === "play" ? undefined : "play")}
          >
            Play
          </button>
          {openMenu === "play" && (
            <ul className="dropdown" role="menu">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={playPending || playState?.playing === true}
                  onClick={() => {
                    setOpenMenu(undefined);
                    void requestPlayMode(true);
                  }}
                >
                  Enter Play Mode
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={playPending || playState?.playing === false}
                  onClick={() => {
                    setOpenMenu(undefined);
                    void requestPlayMode(false);
                  }}
                >
                  Exit Play Mode
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className={`menu${openMenu === "view" ? " open" : ""}`}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "view"}
            onClick={() => setOpenMenu(openMenu === "view" ? undefined : "view")}
          >
            View
          </button>
          {openMenu === "view" && (
            <ul className="dropdown" role="menu">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(undefined);
                    setConsoleOpen((open) => !open);
                  }}
                >
                  {consoleOpen ? "Hide Console" : "Show Console"}
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className={`menu${openMenu === "help" ? " open" : ""}`}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "help"}
            onClick={() => setOpenMenu(openMenu === "help" ? undefined : "help")}
          >
            Help
          </button>
          {openMenu === "help" && (
            <ul className="dropdown" role="menu">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(undefined);
                    setAboutOpen(true);
                  }}
                >
                  About Unity Remote
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className="fill" />
        <li className="menubar-right">
          <span>{project?.project.name ?? "Unity Remote"}</span>
          <span>protocol v{project?.project.protocolVersion ?? 1}</span>
        </li>
      </ul>

      <div className="toolbar">
        <div className="tool-cluster left">
          <span className={`connection${connected ? "" : " offline"}`}>
            <span className="dot" /> {project?.project.source === "unity" ? "Unity Editor" : "Demo fixture"} · {project?.project.unityVersion ?? "..."}
          </span>
        </div>
        <div className="tool-cluster center">
          <button
            className="tool play"
            aria-label="Enter Play Mode"
            title="Enter Play Mode"
            onClick={() => void requestPlayMode(true)}
            disabled={playPending || playState?.playing === true}
          >
            ▶
          </button>
          <button
            className="tool stop"
            aria-label="Exit Play Mode"
            title="Exit Play Mode"
            onClick={() => void requestPlayMode(false)}
            disabled={playPending || playState?.playing === false}
          >
            ■
          </button>
          <button
            className={`tool max${maximized ? " selected" : ""}`}
            aria-label={maximized ? "Restore Game View" : "Maximize Game View"}
            title={maximized ? "Restore Game View" : "Maximize Game View"}
            onClick={() => setMaximized(!maximized)}
          >
            ⛶
          </button>
          <span className={`play-state ${playTone}`} role="status" aria-label="Play Mode state">
            {playLabel}
          </span>
        </div>
        <div className="tool-cluster right">
          <span className="revision">REV {selected?.revision ?? "-"}</span>
        </div>
      </div>

      <div className="notices">
        {readOnly && (
          <div className="notice" role="status">
            The Unity Editor is not connected. The workspace is read-only. Start this project in the Editor so the outbound connector can authenticate with `.unity-remote-token`.
          </div>
        )}
        {conflict && (
          <div className="notice warn" role="status">
            The object revision changed. Your form values were kept. Refresh to reread the authoritative Editor state.
            <button onClick={() => void refreshSelected()}>Refresh</button>
          </div>
        )}
      </div>

      <section className="main">
        <div
          className="resizer-v left"
          onPointerDown={(event) => beginResize(event, "left")}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          onDoubleClick={() => setLeftWidth(240)}
        />
        <div
          className="resizer-v right"
          onPointerDown={(event) => beginResize(event, "right")}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          onDoubleClick={() => setRightWidth(260)}
        />
        <aside className="column left">
          <section className="acc">
            <header className="acc-header">
              <span>Project</span>
              <span className="acc-count">{project?.scenes.length ?? 0} SCENES</span>
            </header>
            <div className="acc-body">
              <button
                className={`project-card${selectedProjectMatches ? " selected" : ""}`}
                onClick={() => setSelectedProjectId(project?.project.id)}
              >
                <strong>{project?.project.name ?? "Loading..."}</strong>
                <small>{project?.project.id}</small>
              </button>
              {project?.scenes.map((item) => (
                <button
                  className={`scene-row${selectedSceneId === item.id ? " active" : ""}`}
                  key={item.id}
                  onClick={() => setSelectedSceneId(item.id)}
                >
                  <span className="scene-dot" />
                  <span className="scene-text">
                    <strong>{item.name}</strong>
                    <small>{item.path}</small>
                  </span>
                  {item.dirty && <b className="dirty">DIRTY</b>}
                </button>
              ))}
            </div>
          </section>
          <section className="acc">
            <header className="acc-header">
              <span>Asset Roots</span>
            </header>
            <div className="acc-body">
              {project?.project.assetRoots.map((root) => (
                <div className="asset-root" key={root.path}>
                  <strong>{root.name}</strong>
                  <small>{root.path}</small>
                </div>
              ))}
              {(project?.project.assetRoots.length ?? 0) === 0 && <p className="prop-empty">No asset roots.</p>}
            </div>
          </section>
        </aside>

        <section
          className="viewport"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.repeat) {
              return;
            }
            event.preventDefault();
            void sendGameInput({ type: "keyDown", key: event.key });
          }}
          onKeyUp={(event) => {
            event.preventDefault();
            void sendGameInput({ type: "keyUp", key: event.key });
          }}
          onPointerDown={(event) => {
            const point = normalizePointer(event);
            const button = event.button >= 0 && event.button <= 2 ? event.button : 0;
            void sendGameInput({ type: "mouseDown", button, x: point.x, y: point.y });
          }}
          onPointerUp={(event) => {
            const point = normalizePointer(event);
            const button = event.button >= 0 && event.button <= 2 ? event.button : 0;
            void sendGameInput({ type: "mouseUp", button, x: point.x, y: point.y });
          }}
          onPointerMove={(event) => {
            const point = normalizePointer(event);
            void sendGameInput({ type: "mouseMove", x: point.x, y: point.y });
          }}
        >
          <span className="viewport-chip">
            {gameViewFrame ? `${gameViewFrame.width}×${gameViewFrame.height} JPEG` : "GAME VIEW"}
          </span>
          {gameViewFrame && (
            <img alt="Game View" src={`data:image/jpeg;base64,${gameViewFrame.data}`} />
          )}
          {gameViewIssue && <p className="viewport-error">{gameViewIssue}</p>}
        </section>

        <aside className="column right">
          <div className="pane pane-top">
            <div className="tabs" role="tablist" aria-label="Scene navigation">
              <button
                type="button"
                role="tab"
                aria-selected={rightTopTab === "hierarchy"}
                className={`tab${rightTopTab === "hierarchy" ? " selected" : ""}`}
                onClick={() => setRightTopTab("hierarchy")}
              >
                Hierarchy
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTopTab === "context"}
                className={`tab${rightTopTab === "context" ? " selected" : ""}`}
                onClick={() => setRightTopTab("context")}
              >
                Context
              </button>
            </div>
            {rightTopTab === "hierarchy" ? (
              <div className="tabbody hier">
                <input
                  ref={searchInputRef}
                  className="search"
                  placeholder="Search GameObjects"
                  aria-label="Search GameObjects"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="tree" role="tree">
                  {visibleHierarchy.map(({ node, depth }) => {
                    const expandable = node.children.length > 0;
                    const isExpanded = search.trim() ? true : expanded.has(node.id);
                    const selectRow = () => {
                      setSelectedId(node.id);
                      if (expandable) {
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(node.id)) next.delete(node.id);
                          else next.add(node.id);
                          return next;
                        });
                      }
                    };
                    return (
                      <div
                        className={`tree-row${selectedId === node.id ? " selected" : ""}`}
                        key={node.id}
                        role="treeitem"
                        tabIndex={0}
                        aria-selected={selectedId === node.id}
                        aria-expanded={expandable ? isExpanded : undefined}
                        title={node.active ? "Active" : "Inactive"}
                        style={{ paddingLeft: 8 + depth * 16 }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectRow();
                          }
                        }}
                      >
                        <span className="caret">{expandable ? (isExpanded ? "▾" : "▸") : ""}</span>
                        <input
                          type="checkbox"
                          className="visibility-toggle"
                          checked={node.active}
                          disabled={readOnly}
                          aria-label={`Set ${node.name} active`}
                          onChange={(event) => {
                            event.stopPropagation();
                            void toggleActive(node.id);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          title={node.active ? "Active" : "Inactive"}
                        />
                        <span className="tree-row-name" onClick={selectRow}>{node.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="tabbody context">
                <div className="context-body">
                  <p>Export AI-ready JSON context for the selected object, or for the whole project when nothing is selected.</p>
                  <p className="context-target">
                    TARGET {selectedId && !selectedId.startsWith("scene:") ? selectedId : (selectedProjectId ?? "-")}
                  </p>
                  <button className="primary" onClick={() => void copyContext()} disabled={!project}>
                    Copy AI Context
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pane pane-bottom">
            <div className="tabs">
              <span className="tab selected">Property</span>
            </div>
            <div className="tabbody props">
              <div className="prop-header">
                <div>
                  <h2>{selected?.name ?? "Select an object"}</h2>
                  <code>{selected?.id ?? "—"}</code>
                </div>
                <span className="revision">REV {selected?.revision ?? "-"}</span>
              </div>
              {selected?.components.map((component) => {
                const collapsed = collapsedComponents.has(component.id);
                return (
                  <div className="component" key={component.id}>
                    <button
                      type="button"
                      className="component-header"
                      aria-expanded={!collapsed}
                      onClick={() => {
                        setCollapsedComponents((current) => {
                          const next = new Set(current);
                          if (next.has(component.id)) next.delete(component.id);
                          else next.add(component.id);
                          return next;
                        });
                      }}
                    >
                      <span className="fold">{collapsed ? "▸" : "▾"}</span>
                      <strong>{component.type.split(".").at(-1)}</strong>
                      <code>{component.id}</code>
                    </button>
                    {!collapsed && (
                      <div className="component-body">
                        {Object.entries(component.properties).map(([path, value]) => {
                          const editable = component.editableProperties.includes(path) && !readOnly;
                          const key = draftKey(component.id, path);
                          const draft = drafts[key];
                          const display = draft ?? String(value);
                          const label = component.propertyDisplayNames[path] ?? path;
                          return (
                            <div key={path}>
                              <div className="prop-row">
                                <label title={path}>{label}</label>
                                {editable ? (
                                  <input
                                    aria-label={label}
                                    title={path}
                                    type={typeof value === "number" ? "number" : "text"}
                                    value={display}
                                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                                  />
                                ) : (
                                  <b>{String(value)}</b>
                                )}
                              </div>
                              {editable && (
                                <div className="prop-actions">
                                  <span className="diff">{String(value)} → {display}</span>
                                  <button className="apply" disabled={readOnly} onClick={() => void applyProperty(component.id, path)}>
                                    Apply with Undo
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {Object.keys(component.properties).length === 0 && (
                          <p className="prop-empty">No serialized properties.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {!selected && <p className="prop-empty">Select an object in the hierarchy to inspect it.</p>}
            </div>
          </div>
        </aside>
      </section>

      <section className={`console${consoleOpen ? "" : " collapsed"}`}>
        <div
          className="resizer-h"
          onPointerDown={(event) => beginResize(event, "console")}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          onDoubleClick={() => setConsoleHeight(160)}
        />
        <div className="console-bar">
          <span className="tab selected">Console</span>
          <span className="console-count">{activities.length} EVENTS</span>
          <span className="fill" />
          <button className="mini-btn danger" onClick={() => setActivities([])}>Clear</button>
          <button
            className="mini-btn"
            aria-label={consoleOpen ? "Collapse console" : "Expand console"}
            onClick={() => setConsoleOpen((open) => !open)}
          >
            {consoleOpen ? "▾" : "▸"}
          </button>
        </div>
        {consoleOpen && (
          <div className="console-body" ref={consoleRef}>
            {activities.map((activity, index) => (
              <div className={`activity ${activity.tone}`} key={`${activity.title}-${index}`}>
                <span className="status-dot" />
                <strong>{activity.title}</strong>
                <p>{activity.detail}</p>
              </div>
            ))}
            {activities.length === 0 && <p className="console-empty">No events.</p>}
          </div>
        )}
      </section>

      <footer className="statusbar">
        <span>Objects {countNodes(project?.hierarchy ?? [])}</span>
        <span>Scenes {project?.scenes.length ?? 0}</span>
        <span>{connected ? "Connected" : "Disconnected"}</span>
        {readOnly && <span className="ro">READ-ONLY</span>}
        <span className="fill" />
        <span>Protocol v{project?.project.protocolVersion ?? 1}</span>
      </footer>

      {aboutOpen && (
        <div className="about" onClick={() => setAboutOpen(false)}>
          <div className="session-window" role="dialog" aria-label="About Unity Remote" onClick={(event) => event.stopPropagation()}>
            <header className="session-title">About Unity Remote</header>
            <div className="session-body">
              <p>
                Web workspace for a running Unity Editor: inspect the hierarchy, edit supported serialized
                properties with preview and Undo, control Play Mode, and stream the Game View.
              </p>
              <p className="context-target">Chrome adapted from Shadow Editor (MIT) · protocol v{project?.project.protocolVersion ?? 1}</p>
              <button className="primary" onClick={() => setAboutOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
