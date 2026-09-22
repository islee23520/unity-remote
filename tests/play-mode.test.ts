import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { createApp } from "../src/server/app.js";
import { ConnectorHub } from "../src/server/connector.js";
import { createDemoStore } from "../src/server/store.js";
import { runCli } from "../src/cli/index.js";
import { playStateSchema } from "../src/contracts/protocol.js";
import type { ProjectSnapshot, ProtocolEvent } from "../src/contracts/protocol.js";

const AUTH_TOKEN = "play-mode-token";

const headers = {
  host: "127.0.0.1:4173",
  authorization: `Bearer ${AUTH_TOKEN}`,
  "content-type": "application/json"
};

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
  hierarchy: [{ id: "scene:Assets/Scenes/Main.unity", name: "Main", active: true, children: [] }]
};

type ConnectorMessage = { type?: string; id?: string; method?: string; payload?: unknown };

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

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout: { write(chunk: string) { stdout.push(chunk); }, text: () => stdout.join("") },
    stderr: { write(chunk: string) { stderr.push(chunk); }, text: () => stderr.join("") }
  };
}

describe("Play Mode over the broker", () => {
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

  it("refuses demo Play Mode reads with a structured DISCONNECTED error instead of a generic 500", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({ method: "GET", url: "/api/play", headers });

    expect(response.body.length).toBeGreaterThan(0);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("DISCONNECTED");
    expect(response.json().error.message).toBe("Play Mode requires a connected Unity Editor.");
  });

  it("refuses demo Play Mode writes with a structured DISCONNECTED error", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const entered = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });
    const exited = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: false } });

    for (const response of [entered, exited]) {
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("DISCONNECTED");
      expect(response.json().error.code).not.toBe("INTERNAL_ERROR");
      expect(response.json().error.message).toBe("Play Mode requires a connected Unity Editor.");
    }
  });

  it("rejects a Play Mode request body without a boolean playing flag", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const missing = await app.inject({ method: "POST", url: "/api/play", headers, payload: {} });
    const wrongType = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: "yes" } });

    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("INVALID_REQUEST");
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error.code).toBe("INVALID_REQUEST");
  });

  it("reads the connected Unity play state over the connector", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as ConnectorMessage;
      if (message.type === "request" && message.method === "getPlayState") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: true,
            payload: { playing: true, transitioning: false }
          })
        );
      }
    });

    const response = await app.inject({ method: "GET", url: "/api/play", headers });
    expect(response.statusCode).toBe(200);
    expect(playStateSchema.parse(response.json())).toEqual({ playing: true, transitioning: false });
  });

  it("forwards the requested playing flag through setPlayMode and returns the Unity play state", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    sockets.push(unity);
    let playing = false;
    const observed: unknown[] = [];
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as ConnectorMessage;
      if (message.type !== "request") {
        return;
      }
      if (message.method === "setPlayMode") {
        observed.push(message.payload);
        playing = (message.payload as { playing?: boolean }).playing === true;
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: true,
            payload: { playing, transitioning: true }
          })
        );
        return;
      }
      if (message.method === "getPlayState") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: true,
            payload: { playing, transitioning: false }
          })
        );
      }
    });

    const entered = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });
    expect(entered.statusCode).toBe(200);
    expect(entered.json()).toEqual({ playing: true, transitioning: true });
    expect(observed).toEqual([{ playing: true }]);

    const afterEnter = await app.inject({ method: "GET", url: "/api/play", headers });
    expect(afterEnter.json().playing).toBe(true);

    const exited = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: false } });
    expect(exited.statusCode).toBe(200);
    expect(exited.json().playing).toBe(false);
    expect(observed).toEqual([{ playing: true }, { playing: false }]);
  });

  it("broadcasts playModeChanged after a successful setPlayMode", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as ConnectorMessage;
      if (message.type !== "request") {
        return;
      }
      if (message.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: message.id, ok: true, payload: unitySnapshot }));
        return;
      }
      if (message.method === "setPlayMode") {
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: true,
            payload: { playing: true, transitioning: true }
          })
        );
      }
    });

    await app.inject({ method: "GET", url: "/api/project", headers });
    const events = await connect(port, "/events", "events");
    sockets.push(events);
    const received = new Promise<ProtocolEvent>((resolve) => {
      events.on("message", (data) => {
        const event = JSON.parse(String(data)) as ProtocolEvent;
        if (event.type === "playModeChanged") {
          resolve(event);
        }
      });
    });

    const entered = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });
    expect(entered.statusCode).toBe(200);
    const event = await received;
    expect(event.type).toBe("playModeChanged");
    expect(event.projectId).toBe("unity-live");
  });

  it("refuses Play Mode from the frozen store after Unity disconnects", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    sockets.push(unity);
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as ConnectorMessage;
      if (message.type === "request" && message.method === "getProjectSnapshot") {
        unity.send(JSON.stringify({ type: "response", id: message.id, ok: true, payload: unitySnapshot }));
      }
    });

    await app.inject({ method: "GET", url: "/api/project", headers });
    await new Promise<void>((resolve) => {
      unity.on("close", () => resolve());
      unity.close();
    });

    const read = await app.inject({ method: "GET", url: "/api/play", headers });
    const write = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });

    for (const response of [read, write]) {
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("DISCONNECTED");
      expect(response.json().error.message).toBe("Play Mode requires a connected Unity Editor.");
    }
  });
});

describe("CLI play command", () => {
  let app: FastifyInstance | undefined;
  let broker = "";

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  async function startDemoBroker(): Promise<void> {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    broker = `http://127.0.0.1:${port}`;
  }

  it("surfaces the structured DISCONNECTED error for play, --enter, and --exit", async () => {
    await startDemoBroker();
    for (const args of [[], ["--enter"], ["--exit"]]) {
      const io = capture();
      const code = await runCli(
        ["node", "unity-remote", "--broker", broker, "--token", AUTH_TOKEN, "play", ...args],
        io
      );
      expect(code).not.toBe(0);
      expect(io.stderr.text().length).toBeGreaterThan(0);
      expect(JSON.parse(io.stderr.text()).error.code).toBe("DISCONNECTED");
    }
  });

  it("rejects passing both --enter and --exit with INVALID_REQUEST and exit code 2", async () => {
    const io = capture();
    const code = await runCli(
      ["node", "unity-remote", "--token", AUTH_TOKEN, "play", "--enter", "--exit"],
      io
    );

    expect(code).toBe(2);
    expect(JSON.parse(io.stderr.text()).error.code).toBe("INVALID_REQUEST");
  });
});
