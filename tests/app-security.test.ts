import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/server/app.js";
import type { UnityStore } from "../src/server/store.js";
import { createDemoStore } from "../src/server/store.js";

const AUTH_TOKEN = "test-session-token";

function setCookieHeader(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return "";
}

describe("broker security", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("serves project state when Host, Origin, and bearer token are valid", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:5173",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({ name: "PlayerProject" })
      })
    );
  });

  it("rejects requests with a missing or invalid bearer token", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: { host: "127.0.0.1:4173" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "A valid session token is required." }
    });
  });

  it("rejects unexpected Host headers", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "evil.example:4173",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN_HOST", message: "Host is not allowed." }
    });
  });

  it("rejects unexpected Origin headers", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const response = await app.inject({
      method: "POST",
      url: "/api/context",
      headers: {
        host: "127.0.0.1:4173",
        origin: "https://evil.example",
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      payload: { objectIds: ["go-main-camera"] }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN_ORIGIN", message: "Origin is not allowed." }
    });
  });

  it("accepts private LAN Host and Origin with a valid token", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, allowedHosts: ["studio.local"] });
    const lan = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "192.168.1.20:4173",
        origin: "http://192.168.1.20:4173",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const named = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "studio.local:4173",
        origin: "http://studio.local:4173",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    expect(lan.statusCode).toBe(200);
    expect(named.statusCode).toBe(200);
    expect(lan.json().project.name).toBe("PlayerProject");
  });

  it("still rejects public Host and Origin values even with a valid token", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, allowedHosts: [] });
    const publicHost = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "8.8.8.8:4173",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const publicOrigin = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "192.168.1.20:4173",
        origin: "https://evil.example",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    expect(publicHost.statusCode).toBe(403);
    expect(publicHost.json().error.code).toBe("FORBIDDEN_HOST");
    expect(publicOrigin.statusCode).toBe(403);
    expect(publicOrigin.json().error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("serves authenticated project state when bound to all interfaces", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, allowedHosts: [] });
    await app.listen({ host: "0.0.0.0", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/project`, {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({ name: "PlayerProject" })
      })
    );
  });

  it("rejects oversized or malformed context objectIds at the HTTP boundary", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    const oversized = await app.inject({
      method: "POST",
      url: "/api/context",
      headers: {
        host: "127.0.0.1:4173",
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      payload: { objectIds: Array.from({ length: 101 }, (_, index) => `go-${index}`) }
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/api/context",
      headers: {
        host: "127.0.0.1:4173",
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      payload: { objectIds: [1, 2] }
    });

    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe("INVALID_REQUEST");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("INVALID_REQUEST");
  });

  it("omits Secure on the session cookie when the request is HTTP", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, sessionSecret: "test-browser-session" });
    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
      payload: { token: AUTH_TOKEN }
    });

    expect(response.statusCode).toBe(200);
    expect(setCookieHeader(response.headers["set-cookie"])).toBe(
      "unity_remote_session=test-browser-session; Path=/; HttpOnly; SameSite=Strict"
    );
  });

  it("emits Secure on the session cookie when request.protocol is https", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, sessionSecret: "test-browser-session" });
    app.addHook("onRequest", async (request) => {
      Object.defineProperty(request.raw.socket, "encrypted", { value: true, configurable: true });
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { host: "127.0.0.1:4173", "content-type": "application/json" },
      payload: { token: AUTH_TOKEN }
    });

    expect(response.statusCode).toBe(200);
    expect(setCookieHeader(response.headers["set-cookie"])).toBe(
      "unity_remote_session=test-browser-session; Path=/; HttpOnly; SameSite=Strict; Secure"
    );
  });

  it("emits Secure on the session cookie when x-forwarded-proto is https", async () => {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN, sessionSecret: "test-browser-session" });
    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: {
        host: "127.0.0.1:4173",
        "content-type": "application/json",
        "x-forwarded-proto": "https"
      },
      payload: { token: AUTH_TOKEN }
    });

    expect(response.statusCode).toBe(200);
    expect(setCookieHeader(response.headers["set-cookie"])).toBe(
      "unity_remote_session=test-browser-session; Path=/; HttpOnly; SameSite=Strict; Secure"
    );
  });

  it("returns a fixed INTERNAL_ERROR payload without leaking exception details", async () => {
    const store = {
      getProjectSnapshot() {
        throw new Error("secret path /Users/alice/hidden");
      },
      inspectObject() {
        throw new Error("unused");
      },
      previewEdit() {
        throw new Error("unused");
      },
      applyEdit() {
        throw new Error("unused");
      },
      saveScene() {
        throw new Error("unused");
      },
      createContext() {
        throw new Error("unused");
      }
    } as unknown as UnityStore;
    app = createApp(store, { authToken: AUTH_TOKEN });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await app.inject({
      method: "GET",
      url: "/api/project",
      headers: {
        host: "127.0.0.1:4173",
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }
    });
    expect(response.body).not.toContain("secret path");
    expect(logged).toHaveBeenCalled();
  });
});
