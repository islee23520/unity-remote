import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { HierarchyNode, ProjectSnapshot, ProtocolEvent } from "../src/contracts/protocol.js";
import { createApp } from "../src/server/app.js";
import {
  ConnectorHub,
  SET_ACTIVE_SETTLE_WINDOW_MS,
  setConnectorClockForTests
} from "../src/server/connector.js";
import { createDemoStore } from "../src/server/store.js";

const AUTH_TOKEN = "unity-token";

const unitySnapshot: ProjectSnapshot = {
  project: {
    id: "unity-live",
    name: "LiveUnity",
    unityVersion: "6000.7.0a5",
    connected: true,
    source: "unity",
    protocolVersion: 1,
    assetRoots: [{ name: "Assets", path: "Assets" }]
  },
  scenes: [
    {
      id: "Assets/Scenes/Main.unity",
      name: "Main",
      path: "Assets/Scenes/Main.unity",
      loaded: true,
      dirty: false,
      revision: 3
    }
  ],
  hierarchy: [
    {
      id: "scene:Assets/Scenes/Main.unity",
      name: "Main",
      active: true,
      children: [{ id: "object-main-camera", name: "Main Camera", active: true, children: [] }]
    }
  ]
};

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

function connect(port: number, path: "/connector" | "/events", role: "unity" | "events"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, role, token: AUTH_TOKEN }))
    );
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string };
      if (message.type === "hello-ok") {
        resolve(socket);
      }
    });
    socket.on("error", reject);
  });
}

function findNode(nodes: HierarchyNode[], objectId: string): HierarchyNode | undefined {
  for (const node of nodes) {
    if (node.id === objectId) {
      return node;
    }
    const child = findNode(node.children, objectId);
    if (child) {
      return child;
    }
  }
  return undefined;
}

describe("setActive demo store", () => {
  it("rejects a mismatched project", async () => {
    const store = createDemoStore();

    await expect(
      store.setActive({
        projectId: "project-other",
        objectId: "go-main-camera",
        active: false,
        expectedRevision: 1
      })
    ).rejects.toMatchObject({ code: "PROJECT_MISMATCH", statusCode: 409 });
  });

  it("rejects a missing object", async () => {
    const store = createDemoStore();

    await expect(
      store.setActive({
        projectId: "project-player",
        objectId: "go-missing",
        active: false,
        expectedRevision: 1
      })
    ).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND", statusCode: 404 });
  });

  it("rejects a stale object revision", async () => {
    const store = createDemoStore();

    await expect(
      store.setActive({
        projectId: "project-player",
        objectId: "go-main-camera",
        active: false,
        expectedRevision: 0
      })
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", statusCode: 409 });
  });

  it("toggles active state, increments revisions, dirties the scene, and emits hierarchyChanged", async () => {
    const events: ProtocolEvent[] = [];
    const store = createDemoStore({ onEvent: (event) => events.push(event) });

    await expect(
      store.setActive({
        projectId: "project-player",
        objectId: "go-main-camera",
        active: false,
        expectedRevision: 1
      })
    ).resolves.toEqual({ objectId: "go-main-camera", active: false, revision: 2, sceneDirty: true });

    expect(await store.inspectObject("go-main-camera", "project-player")).toMatchObject({ active: false, revision: 2 });
    expect((await store.getProjectSnapshot()).scenes[0]).toMatchObject({ dirty: true, revision: 2 });
    expect(events).toEqual([
      {
        type: "hierarchyChanged",
        projectId: "project-player",
        sceneId: "scene-main",
        objectId: "go-main-camera",
        revision: 2
      }
    ]);
  });

  it("returns the toggled active state in a fresh hierarchy snapshot", async () => {
    const store = createDemoStore();
    await store.setActive({
      projectId: "project-player",
      objectId: "go-player",
      active: false,
      expectedRevision: 1
    });

    const snapshot = await store.getProjectSnapshot();
    expect(findNode(snapshot.hierarchy, "go-player")?.active).toBe(false);
  });
});

describe("POST /api/set-active", () => {
  const headers = {
    host: "127.0.0.1:4173",
    authorization: `Bearer ${AUTH_TOKEN}`,
    "content-type": "application/json"
  };

  it("returns the set-active result and broadcasts exactly one hierarchyChanged event", async () => {
    const hub = new ConnectorHub();
    const broadcast = vi.spyOn(hub, "broadcast");
    const app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });

    const response = await app.inject({
      method: "POST",
      url: "/api/set-active",
      headers,
      payload: {
        projectId: "project-player",
        objectId: "go-main-camera",
        active: false,
        expectedRevision: 1
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ objectId: "go-main-camera", active: false, revision: 2, sceneDirty: true });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: "hierarchyChanged",
      projectId: "project-player",
      sceneId: "scene-main",
      objectId: "go-main-camera",
      revision: 2
    });
    await app.close();
  });

  it("rejects malformed input with INVALID_REQUEST", async () => {
    const app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({
      method: "POST",
      url: "/api/set-active",
      headers,
      payload: { projectId: "project-player", objectId: "go-main-camera", active: "no", expectedRevision: 1 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    await app.close();
  });

  it("requires authentication", async () => {
    const app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({
      method: "POST",
      url: "/api/set-active",
      headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
      payload: {
        projectId: "project-player",
        objectId: "go-main-camera",
        active: false,
        expectedRevision: 1
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    await app.close();
  });
});

describe("setActive connector store", () => {
  let app: FastifyInstance | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    setConnectorClockForTests(undefined);
    vi.useRealTimers();
    for (const socket of sockets) {
      socket.close();
    }
    sockets.length = 0;
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("broadcasts exactly one hierarchyChanged when Unity emits the authoritative setActive event", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    const events = await connect(port, "/events", "events");
    sockets.push(unity, events);
    unity.on("message", (data) => {
      const request = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (request.type !== "request") {
        return;
      }
      if (request.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: request.id, ok: true, payload: unitySnapshot }));
      }
      if (request.method === "setActive") {
        unity.send(
          JSON.stringify({
            type: "event",
            event: {
              type: "hierarchyChanged",
              projectId: "unity-live",
              sceneId: "Assets/Scenes/Main.unity",
              objectId: "object-main-camera",
              revision: 4
            }
          })
        );
        unity.send(
          JSON.stringify({
            type: "response",
            id: request.id,
            ok: true,
            payload: { objectId: "object-main-camera", active: false, revision: 4, sceneDirty: true }
          })
        );
      }
    });

    const received: ProtocolEvent[] = [];
    const sentinel = new Promise<void>((resolve) => {
      events.on("message", (data) => {
        const value = JSON.parse(String(data)) as ProtocolEvent;
        received.push(value);
        if (value.type === "playModeChanged") {
          resolve();
        }
      });
    });
    const store = hub.activeStore(createDemoStore());
    await store.getProjectSnapshot();

    await expect(
      store.setActive({ projectId: "unity-live", objectId: "object-main-camera", active: false, expectedRevision: 3 })
    ).resolves.toEqual({ objectId: "object-main-camera", active: false, revision: 4, sceneDirty: true });
    hub.broadcast({ type: "playModeChanged", projectId: "unity-live" });
    await sentinel;

    expect(received.filter((event) => event.type === "hierarchyChanged")).toEqual([
      {
        type: "hierarchyChanged",
        projectId: "unity-live",
        sceneId: "Assets/Scenes/Main.unity",
        objectId: "object-main-camera",
        revision: 4
      }
    ]);
  });

  it("holds a generic hierarchyChanged during the setActive settle window and flushes it only when not superseded", async () => {
    const hub = new ConnectorHub();
    const broadcast = vi.spyOn(hub, "broadcast");
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    const events = await connect(port, "/events", "events");
    sockets.push(unity, events);
    unity.on("message", (data) => {
      const request = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (request.type === "request" && request.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: request.id, ok: true, payload: unitySnapshot }));
      }
      if (request.type === "request" && request.method === "setActive") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: request.id,
            ok: true,
            payload: { objectId: "object-main-camera", active: false, revision: 4, sceneDirty: true }
          })
        );
      }
    });

    const store = hub.activeStore(createDemoStore());
    await store.getProjectSnapshot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T00:00:00.000Z"));
    setConnectorClockForTests({
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer)
    });
    await store.setActive({
      projectId: "unity-live",
      objectId: "object-main-camera",
      active: false,
      expectedRevision: 3
    });
    broadcast.mockClear();

    const processed = new Promise<void>((resolve) => {
      events.on("message", (data) => {
        const event = JSON.parse(String(data)) as ProtocolEvent;
        if (event.type === "playModeChanged") {
          resolve();
        }
      });
    });
    unity.send(
      JSON.stringify({
        type: "event",
        event: {
          type: "hierarchyChanged",
          projectId: "unity-live"
        }
      })
    );
    unity.send(
      JSON.stringify({
        type: "event",
        event: { type: "playModeChanged", projectId: "unity-live" }
      })
    );
    await processed;

    const hierarchyBroadcasts = (): ProtocolEvent[] =>
      broadcast.mock.calls.map(([event]) => event).filter((event) => event.type === "hierarchyChanged");
    expect(hierarchyBroadcasts()).toEqual([]);

    await vi.advanceTimersByTimeAsync(SET_ACTIVE_SETTLE_WINDOW_MS);
    expect(hierarchyBroadcasts()).toEqual([{ type: "hierarchyChanged", projectId: "unity-live" }]);
  });

  it("a specific hierarchyChanged during the window supersedes the held generic", async () => {
    const hub = new ConnectorHub();
    const broadcast = vi.spyOn(hub, "broadcast");
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    const events = await connect(port, "/events", "events");
    sockets.push(unity, events);
    unity.on("message", (data) => {
      const request = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (request.type === "request" && request.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: request.id, ok: true, payload: unitySnapshot }));
      }
      if (request.type === "request" && request.method === "setActive") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: request.id,
            ok: true,
            payload: { objectId: "object-main-camera", active: false, revision: 4, sceneDirty: true }
          })
        );
      }
    });

    const store = hub.activeStore(createDemoStore());
    await store.getProjectSnapshot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T00:00:00.000Z"));
    setConnectorClockForTests({
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer)
    });
    await store.setActive({
      projectId: "unity-live",
      objectId: "object-main-camera",
      active: false,
      expectedRevision: 3
    });
    broadcast.mockClear();

    const processed = new Promise<void>((resolve) => {
      events.on("message", (data) => {
        const event = JSON.parse(String(data)) as ProtocolEvent;
        if (event.type === "playModeChanged") {
          resolve();
        }
      });
    });
    unity.send(
      JSON.stringify({
        type: "event",
        event: { type: "hierarchyChanged", projectId: "unity-live" }
      })
    );
    unity.send(
      JSON.stringify({
        type: "event",
        event: {
          type: "hierarchyChanged",
          projectId: "unity-live",
          sceneId: "Assets/Scenes/Main.unity",
          objectId: "object-main-camera",
          revision: 4
        }
      })
    );
    unity.send(
      JSON.stringify({
        type: "event",
        event: { type: "playModeChanged", projectId: "unity-live" }
      })
    );
    await processed;

    const hierarchyBroadcasts = (): ProtocolEvent[] =>
      broadcast.mock.calls.map(([event]) => event).filter((event) => event.type === "hierarchyChanged");
    expect(hierarchyBroadcasts()).toEqual([
      {
        type: "hierarchyChanged",
        projectId: "unity-live",
        sceneId: "Assets/Scenes/Main.unity",
        objectId: "object-main-camera",
        revision: 4
      }
    ]);

    await vi.advanceTimersByTimeAsync(SET_ACTIVE_SETTLE_WINDOW_MS);
    expect(hierarchyBroadcasts()).toHaveLength(1);
  });

  it(
    "rejects a malformed Unity setActive response without waiting for the RPC timeout",
    async () => {
      const hub = new ConnectorHub();
      app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
      const port = await listen(app);
      const unity = await connect(port, "/connector", "unity");
      sockets.push(unity);
      unity.on("message", (data) => {
        const request = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
        if (request.type === "request" && request.method === "setActive") {
          unity.send(
            JSON.stringify({
              type: "response",
              id: request.id,
              ok: true,
              payload: { objectId: "object-main-camera", active: "no", revision: 4, sceneDirty: true }
            })
          );
        }
      });

      const store = hub.activeStore(createDemoStore());
      await expect(
        store.setActive({ projectId: "unity-live", objectId: "object-main-camera", active: false, expectedRevision: 3 })
      ).rejects.toMatchObject({ code: "INVALID_UNITY_PAYLOAD", statusCode: 502 });
    },
    1_000
  );

  it("rejects setActive after the connected Unity store becomes frozen", async () => {
    const hub = new ConnectorHub();
    const demo = createDemoStore();
    app = createApp(demo, { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    sockets.push(unity);
    unity.on("message", (data) => {
      const request = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (request.type === "request" && request.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: request.id, ok: true, payload: unitySnapshot }));
      }
    });

    await hub.activeStore(demo).getProjectSnapshot();
    const closed = new Promise<void>((resolve) => unity.once("close", () => resolve()));
    unity.close();
    await closed;

    await expect(
      hub
        .activeStore(demo)
        .setActive({ projectId: "unity-live", objectId: "object-main-camera", active: false, expectedRevision: 3 })
    ).rejects.toMatchObject({ code: "DISCONNECTED", statusCode: 503 });
  });
});
