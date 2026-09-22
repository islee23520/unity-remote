import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { createApp } from "../src/server/app.js";
import { ConnectorHub } from "../src/server/connector.js";
import { createDemoStore } from "../src/server/store.js";
import { runCli } from "../src/cli/index.js";
import { gameViewFrameSchema } from "../src/contracts/protocol.js";
import type { GameViewFrame, ProjectSnapshot } from "../src/contracts/protocol.js";

const AUTH_TOKEN = "game-view-token";
const GAME_VIEW_MESSAGE = "Game View requires a connected Unity Editor.";

const headers = {
  host: "127.0.0.1:4173",
  authorization: `Bearer ${AUTH_TOKEN}`,
  "content-type": "application/json"
};

const fixture = gameViewFrameSchema.parse(
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../contracts/fixtures/game-view-frame.json"), "utf8")
  )
) satisfies GameViewFrame;

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

describe("Game View over the broker", () => {
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

  it("refuses demo Game View reads with a structured DISCONNECTED error instead of a generic 500", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({ method: "GET", url: "/api/game-view", headers });

    expect(response.body.length).toBeGreaterThan(0);
    expect(response.statusCode).toBe(503);
    expect(response.statusCode).not.toBe(404);
    expect(response.json().error.code).toBe("DISCONNECTED");
    expect(response.json().error.code).not.toBe("INTERNAL_ERROR");
    expect(response.json().error.message).toBe(GAME_VIEW_MESSAGE);
    expect(response.json().error.message).not.toBe("Play Mode requires a connected Unity Editor.");
  });

  it("returns a connected Unity gameViewFrame from GET /api/game-view", async () => {
    const hub = new ConnectorHub();
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, hub });
    const port = await listen(app);
    const unity = await connect(port, "/connector", "unity");
    sockets.push(unity);
    const methods: string[] = [];
    unity.on("message", (data) => {
      const message = JSON.parse(String(data)) as ConnectorMessage;
      if (message.type === "request" && message.method === "getGameViewFrame") {
        methods.push(message.method);
        expect(message.payload).toEqual({});
        unity.send(
          JSON.stringify({
            type: "response",
            id: message.id,
            ok: true,
            payload: fixture
          })
        );
      }
    });

    const response = await app.inject({ method: "GET", url: "/api/game-view", headers });
    expect(response.statusCode).toBe(200);
    expect(gameViewFrameSchema.parse(response.json())).toEqual(fixture);
    expect(methods).toEqual(["getGameViewFrame"]);
  });

  it("refuses Game View from the frozen store after Unity disconnects", async () => {
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

    const response = await app.inject({ method: "GET", url: "/api/game-view", headers });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("DISCONNECTED");
    expect(response.json().error.message).toBe(GAME_VIEW_MESSAGE);
    expect(response.json().error.message).not.toBe("Play Mode requires a connected Unity Editor.");
  });
});

describe("CLI game-view command", () => {
  let app: FastifyInstance | undefined;
  let broker = "";

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("surfaces the structured DISCONNECTED error with empty stdout", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    broker = `http://127.0.0.1:${port}`;

    const io = capture();
    const code = await runCli(
      ["node", "unity-remote", "--broker", broker, "--token", AUTH_TOKEN, "game-view"],
      io
    );
    expect(code).not.toBe(0);
    expect(io.stdout.text()).toBe("");
    expect(io.stderr.text().length).toBeGreaterThan(0);
    expect(JSON.parse(io.stderr.text()).error.code).toBe("DISCONNECTED");
    expect(JSON.parse(io.stderr.text()).error.message).toBe(GAME_VIEW_MESSAGE);
  });
});
