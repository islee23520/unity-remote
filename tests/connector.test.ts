import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { BROWSER_SESSION_COOKIE, createApp } from "../src/server/app.js";
import { ConnectorHub } from "../src/server/connector.js";
import { createDemoStore } from "../src/server/store.js";
import type { ObjectSnapshot, ProjectSnapshot } from "../src/contracts/protocol.js";

const AUTH_TOKEN = "unity-token";

const unitySnapshot: ProjectSnapshot = {
  project: {
    id: "unity-live",
    name: "LiveUnity",
    unityVersion: "6000.7.0a5",
    connected: true,
    source: "unity",
    protocolVersion: 1,
    assetRoots: [
      { name: "Assets", path: "Assets" },
      { name: "Packages", path: "Packages" }
    ]
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
      children: [{ id: "GlobalObjectId_V1-2-aaaa-1-100000", name: "Main Camera", active: true, children: [] }]
    }
  ]
};

const cameraObject: ObjectSnapshot = {
  id: "GlobalObjectId_V1-2-aaaa-1-100000",
  sceneId: "Assets/Scenes/Main.unity",
  name: "Main Camera",
  active: true,
  revision: 3,
  components: [
    {
      id: "GlobalObjectId_V1-2-aaaa-1-200000",
      type: "UnityEngine.Transform",
      properties: { "m_LocalPosition.x": 0 },
      editableProperties: ["m_LocalPosition.x"],
      propertyDisplayNames: { "m_LocalPosition.x": "Position X" }
    }
  ]
};

const headers = {
  host: "127.0.0.1:4173",
  authorization: `Bearer ${AUTH_TOKEN}`,
  "content-type": "application/json"
};

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  return typeof address === "object" && address ? address.port : 0;
}

function connect(port: number, path: "/connector" | "/events", hello: unknown): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    socket.on("open", () => socket.send(JSON.stringify(hello)));
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string };
      if (message.type === "hello-ok") {
        resolve(socket);
      }
    });
    socket.on("error", reject);
  });
}

describe("Unity connector authority", () => {
  let app: FastifyInstance | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    sockets.length = 0;
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("serves connected Unity snapshots instead of the demo fixture", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type === "request" && message.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: message.id, ok: true, payload: unitySnapshot }));
      }
    });

    const demo = await app.inject({ method: "GET", url: "/api/project", headers });
    expect(demo.statusCode).toBe(200);
    expect(demo.json().project.id).toBe("unity-live");
    expect(demo.json().project.source).toBe("unity");
    expect(demo.json().project.name).not.toBe("PlayerProject");
  });

  it("rejects a connector hello with the wrong token", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const port = await listen(app);
    const closed = await new Promise<{ code: number }>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/connector`);
      sockets.push(socket);
      socket.on("open", () =>
        socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, role: "unity", token: "wrong" }))
      );
      socket.on("close", (code) => resolve({ code }));
      socket.on("error", reject);
    });
    expect(closed.code).toBe(4401);
  });

  it("fails malformed Unity responses immediately instead of waiting for timeout", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type === "request") {
        unity.send("{not-json");
      }
    });

    const started = Date.now();
    const response = await app.inject({ method: "GET", url: "/api/project", headers });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("INVALID_UNITY_PAYLOAD");
  });

  it("maps Unity structured save errors to their status codes", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type === "request" && message.method === "saveScene") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "SCENE_NOT_SAVED",
              message: "The scene has no asset path yet.",
              details: { sceneId: "Untitled" },
              statusCode: 422
            }
          })
        );
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/save",
      headers,
      payload: { projectId: "unity-live", sceneId: "Untitled" }
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SCENE_NOT_SAVED");
  });

  it("forwards apply edits and freezes after disconnect", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type !== "request") {
        return;
      }
      if (message.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: message.id, ok: true, payload: unitySnapshot }));
        return;
      }
      if (message.method === "applyEdit") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: true,
            payload: {
              transactionId: "tx-4",
              undoGroup: "Unity Remote: Main Camera m_LocalPosition.x",
              object: { ...cameraObject, revision: 4, components: [{ ...cameraObject.components[0], properties: { "m_LocalPosition.x": 4 } }] },
              before: 0,
              after: 4,
              sceneDirty: true
            }
          })
        );
      }
    });

    await app.inject({ method: "GET", url: "/api/project", headers });
    const edited = await app.inject({
      method: "POST",
      url: "/api/edits",
      headers,
      payload: {
        projectId: "unity-live",
        objectId: cameraObject.id,
        componentId: "GlobalObjectId_V1-2-aaaa-1-200000",
        property: "m_LocalPosition.x",
        value: 4,
        expectedRevision: 3
      }
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().after).toBe(4);

    await new Promise<void>((resolve) => {
      unity.on("close", () => resolve());
      unity.close();
    });

    const frozen = await app.inject({ method: "GET", url: "/api/project", headers });
    expect(frozen.statusCode).toBe(200);
    expect(frozen.json().project.connected).toBe(false);
    expect(frozen.json().project.id).toBe("unity-live");

    const write = await app.inject({
      method: "POST",
      url: "/api/edits",
      headers,
      payload: {
        projectId: "unity-live",
        objectId: cameraObject.id,
        componentId: "GlobalObjectId_V1-2-aaaa-1-200000",
        property: "m_LocalPosition.x",
        value: 5,
        expectedRevision: 4
      }
    });
    expect(write.statusCode).toBe(503);
    expect(write.json().error.code).toBe("DISCONNECTED");
  });

  it("answers Play Mode reads and writes from the connected Unity Editor", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    let playing = false;
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as {
        type?: string;
        id?: string;
        method?: string;
        payload?: { playing?: boolean };
      };
      if (message.type !== "request") {
        return;
      }
      if (message.method === "setPlayMode") {
        playing = message.payload?.playing === true;
        unity.send(
          JSON.stringify({ type: "response", id: message.id, ok: true, payload: { playing, transitioning: true } })
        );
        return;
      }
      if (message.method === "getPlayState") {
        unity.send(
          JSON.stringify({ type: "response", id: message.id, ok: true, payload: { playing, transitioning: false } })
        );
      }
    });

    const initial = await app.inject({ method: "GET", url: "/api/play", headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ playing: false, transitioning: false });

    const entered = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });
    expect(entered.statusCode).toBe(200);
    expect(entered.json().playing).toBe(true);

    const afterEnter = await app.inject({ method: "GET", url: "/api/play", headers });
    expect(afterEnter.json()).toEqual({ playing: true, transitioning: false });
  });

  it("forwards getGameViewFrame from GET /api/game-view", async () => {
    const frame = {
      mimeType: "image/jpeg",
      data: "ZmFrZQ",
      width: 8,
      height: 8
    };
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    const methods: string[] = [];
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string; payload?: unknown };
      if (message.type === "request" && message.method === "getGameViewFrame") {
        methods.push(message.method);
        expect(message.payload).toEqual({});
        unity.send(JSON.stringify({ type: "response", id: message.id, ok: true, payload: frame }));
      }
    });

    const response = await app.inject({ method: "GET", url: "/api/game-view", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(frame);
    expect(methods).toEqual(["getGameViewFrame"]);
  });

  it("forwards sendGameInput from POST /api/input", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    const observed: unknown[] = [];
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string; payload?: unknown };
      if (message.type === "request" && message.method === "sendGameInput") {
        observed.push(message.payload);
        unity.send(JSON.stringify({ type: "response", id: message.id, ok: true, payload: { accepted: true } }));
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/input",
      headers,
      payload: { type: "keyDown", key: "w" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });
    expect(observed).toEqual([{ type: "keyDown", key: "w" }]);
  });

  it("maps a Unity Play Mode rejection to its structured status instead of a generic 500", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type === "request" && message.method === "setPlayMode") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "SCENE_NOT_SAVED",
              message: "Save the scene before entering Play Mode.",
              details: {},
              statusCode: 422
            }
          })
        );
      }
    });

    const response = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SCENE_NOT_SAVED");
  });

  it("requires an authenticated hello on the event socket", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const port = await listen(app);
    const closed = await new Promise<{ code: number }>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/events`);
      sockets.push(socket);
      socket.on("open", () =>
        socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, role: "events", token: "nope" }))
      );
      socket.on("close", (code) => resolve({ code }));
      socket.on("error", reject);
    });
    expect(closed.code).toBe(4401);
  });

  it("authenticates the event socket from the HttpOnly session cookie", async () => {
    const sessionSecret = "events-session";
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, sessionSecret });
    const port = await listen(app);
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const current = new WebSocket(`ws://127.0.0.1:${port}/events`, {
        headers: { cookie: `${BROWSER_SESSION_COOKIE}=${sessionSecret}` }
      });
      sockets.push(current);
      current.on("message", (data) => {
        const message = JSON.parse(String(data)) as { type?: string };
        if (message.type === "hello-ok") {
          resolve(current);
        }
      });
      current.on("error", reject);
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("maps a generic Unity INTERNAL_ERROR with statusCode 500 to HTTP 500", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type === "request") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "An unexpected error occurred.",
              details: {},
              statusCode: 500
            }
          })
        );
      }
    });

    const response = await app.inject({ method: "GET", url: "/api/project", headers });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("INTERNAL_ERROR");
  });

  it("treats a connector error with statusCode 0 as an incompatible Unity payload", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", {
      type: "hello",
      protocolVersion: 1,
      role: "unity",
      token: AUTH_TOKEN
    });
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type?: string; id?: string; method?: string };
      if (message.type === "request") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "An unexpected error occurred.",
              details: {},
              statusCode: 0
            }
          })
        );
      }
    });

    const response = await app.inject({ method: "GET", url: "/api/project", headers });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("INVALID_UNITY_PAYLOAD");
  });
});
