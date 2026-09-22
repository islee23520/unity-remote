import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { BROWSER_SESSION_COOKIE, createApp } from "../src/server/app.js";
import { createDemoStore } from "../src/server/store.js";

const AUTH_TOKEN = "test-session-token";
const SESSION_SECRET = "test-browser-session";
const BOOTSTRAP_NONCE = "test-bootstrap-nonce";
const headers = {
  host: "127.0.0.1:4173",
  authorization: `Bearer ${AUTH_TOKEN}`,
  "content-type": "application/json"
};

const cameraEdit = {
  projectId: "project-player",
  objectId: "go-main-camera",
  componentId: "cmp-main-camera-transform",
  property: "m_LocalPosition.x",
  value: 4,
  expectedRevision: 1
};

describe("HTTP routes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("applies a valid edit, keeps save separate, and reports missing scenes", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const preview = await app.inject({
      method: "POST",
      url: "/api/edits/preview",
      headers,
      payload: cameraEdit
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual(
      expect.objectContaining({ preview: true, before: 0, after: 4, componentId: "cmp-main-camera-transform" })
    );

    const edited = await app.inject({
      method: "POST",
      url: "/api/edits",
      headers,
      payload: cameraEdit
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().object.revision).toBe(2);
    expect(edited.json().sceneDirty).toBe(true);

    const project = await app.inject({ method: "GET", url: "/api/project", headers });
    expect(project.json().scenes[0].dirty).toBe(true);

    const missingScene = await app.inject({
      method: "POST",
      url: "/api/save",
      headers,
      payload: { projectId: "project-player", sceneId: "scene-missing" }
    });
    expect(missingScene.statusCode).toBe(404);
    expect(missingScene.json().error.code).toBe("SCENE_NOT_FOUND");

    const saved = await app.inject({
      method: "POST",
      url: "/api/save",
      headers,
      payload: { projectId: "project-player", sceneId: "scene-main" }
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(expect.objectContaining({ dirty: false, sceneId: "scene-main" }));
  });

  it("returns a structured DISCONNECTED body for Play Mode against the demo store", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });

    const read = await app.inject({ method: "GET", url: "/api/play", headers });
    expect(read.statusCode).toBe(503);
    expect(read.body.length).toBeGreaterThan(0);
    expect(read.json().error).toEqual(
      expect.objectContaining({ code: "DISCONNECTED", message: "Play Mode requires a connected Unity Editor." })
    );

    const write = await app.inject({ method: "POST", url: "/api/play", headers, payload: { playing: true } });
    expect(write.statusCode).toBe(503);
    expect(write.body.length).toBeGreaterThan(0);
    expect(write.json().error.code).toBe("DISCONNECTED");
  });

  it("returns a structured DISCONNECTED body for Game View against the demo store", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });

    const read = await app.inject({ method: "GET", url: "/api/game-view", headers });
    expect(read.statusCode).toBe(503);
    expect(read.statusCode).not.toBe(404);
    expect(read.body.length).toBeGreaterThan(0);
    expect(read.json().error).toEqual(
      expect.objectContaining({
        code: "DISCONNECTED",
        message: "Game View requires a connected Unity Editor."
      })
    );
  });

  it("returns a structured DISCONNECTED body for input against the demo store", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });

    const write = await app.inject({
      method: "POST",
      url: "/api/input",
      headers,
      payload: { type: "keyDown", key: "w" }
    });
    expect(write.statusCode).toBe(503);
    expect(write.body.length).toBeGreaterThan(0);
    expect(write.json().error).toEqual(
      expect.objectContaining({
        code: "DISCONNECTED",
        message: "Input requires a connected Unity Editor."
      })
    );
  });

  it("does not hand out mutation credentials in unauthenticated public responses", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "unity-remote-web-"));
    writeFileSync(join(webRoot, "index.html"), "<html><head></head><body>Unity Remote</body></html>");
    app = createApp(createDemoStore(), {
      authToken: AUTH_TOKEN,
      sessionSecret: SESSION_SECRET,
      bootstrapNonce: BOOTSTRAP_NONCE,
      webRoot
    });

    const publicResponses = [
      await app.inject({ method: "GET", url: "/", headers: { host: "127.0.0.1:4173" } }),
      await app.inject({ method: "GET", url: "/workspace", headers: { host: "127.0.0.1:4173" } }),
      await app.inject({ method: "GET", url: "/api/session", headers: { host: "127.0.0.1:4173" } }),
      await app.inject({ method: "GET", url: "/api/project", headers: { host: "127.0.0.1:4173" } }),
      await app.inject({ method: "GET", url: "/api/bootstrap", headers: { host: "127.0.0.1:4173" } }),
      await app.inject({ method: "GET", url: "/api/bootstrap?code=nope", headers: { host: "127.0.0.1:4173" } }),
      await app.inject({
        method: "POST",
        url: "/api/session",
        headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
        payload: { token: "nope" }
      }),
      await app.inject({
        method: "POST",
        url: "/api/edits",
        headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
        payload: cameraEdit
      })
    ];

    expect(publicResponses[0]?.statusCode).toBe(200);
    expect(publicResponses[0]?.body).toContain("Unity Remote");
    expect(publicResponses[1]?.statusCode).toBe(200);
    expect(publicResponses[2]?.statusCode).toBe(401);
    expect(publicResponses[7]?.statusCode).toBe(401);

    for (const response of publicResponses) {
      expect(response.body).not.toContain(AUTH_TOKEN);
      expect(response.body).not.toContain(SESSION_SECRET);
      expect(response.body).not.toContain(BOOTSTRAP_NONCE);
      expect(response.body).not.toContain("__UNITY_REMOTE_TOKEN__");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }

    const authed = await app.inject({
      method: "GET",
      url: "/api/session",
      headers
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.json()).toEqual({ protocolVersion: 1 });
    expect(authed.body).not.toContain(AUTH_TOKEN);
  });

  it("creates an HttpOnly session from a one-time bootstrap code or a user-held token", async () => {
    app = createApp(createDemoStore(), {
      authToken: AUTH_TOKEN,
      sessionSecret: SESSION_SECRET,
      bootstrapNonce: BOOTSTRAP_NONCE
    });

    const bootstrap = await app.inject({
      method: "GET",
      url: `/api/bootstrap?code=${BOOTSTRAP_NONCE}`,
      headers: { host: "127.0.0.1:4173" }
    });
    expect(bootstrap.statusCode).toBe(302);
    expect(bootstrap.headers.location).toBe("/");
    expect(bootstrap.body).not.toContain(AUTH_TOKEN);
    expect(bootstrap.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: BROWSER_SESSION_COOKIE,
          value: SESSION_SECRET,
          httpOnly: true,
          path: "/",
          sameSite: "Strict"
        })
      ])
    );

    const reused = await app.inject({
      method: "GET",
      url: `/api/bootstrap?code=${BOOTSTRAP_NONCE}`,
      headers: { host: "127.0.0.1:4173" }
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.headers["set-cookie"]).toBeUndefined();

    const cookied = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "127.0.0.1:4173",
        cookie: `${BROWSER_SESSION_COOKIE}=${SESSION_SECRET}`
      }
    });
    expect(cookied.statusCode).toBe(200);
    expect(cookied.json().project.name).toBe("PlayerProject");

    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
      payload: { token: AUTH_TOKEN }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ protocolVersion: 1 });
    expect(login.body).not.toContain(AUTH_TOKEN);
    expect(login.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: BROWSER_SESSION_COOKIE, value: SESSION_SECRET, httpOnly: true })
      ])
    );
  });
});
