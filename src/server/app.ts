import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { ZodError } from "zod";
import {
  contextRequestSchema,
  editRequestSchema,
  gameInputSchema,
  playModeRequestSchema,
  saveRequestSchema,
  setActiveRequestSchema
} from "../contracts/protocol.js";
import { ConnectorHub } from "./connector.js";
import { UnityRemoteError } from "./errors.js";
import { defaultExtraHosts, isAllowedHostHeader, isAllowedOrigin } from "./hosts.js";
import { createDemoStore, type UnityStore } from "./store.js";

export const BROWSER_SESSION_COOKIE = "unity_remote_session";

export type CreateAppOptions = {
  authToken?: string;
  sessionSecret?: string;
  bootstrapNonce?: string;
  hub?: ConnectorHub;
  webRoot?: string;
  allowedHosts?: readonly string[];
};

export function createApp(
  store: UnityStore = createDemoStore(),
  options: CreateAppOptions = {}
): FastifyInstance {
  const app = Fastify({ logger: false });
  const authToken =
    options.authToken?.trim() || process.env.UNITY_REMOTE_TOKEN?.trim() || randomBytes(32).toString("hex");
  const sessionSecret = options.sessionSecret?.trim() || randomBytes(32).toString("hex");
  let bootstrapNonce = options.bootstrapNonce?.trim() || randomBytes(32).toString("hex");
  const hub = options.hub ?? new ConnectorHub();
  const extraHosts = options.allowedHosts !== undefined ? options.allowedHosts : defaultExtraHosts();
  const demo = store;
  const wiredDemo = createEventedStore(demo, hub);

  const activeStore = (): UnityStore => hub.activeStore(wiredDemo);

  app.register(fastifyWebsocket);
  app.register(async (instance) => {
    instance.get("/connector", { websocket: true }, (socket) => {
      let authed = false;
      socket.on("message", (data) => {
        const raw = String(data);
        if (!authed) {
          if (!hub.authenticate(raw, authToken, "unity")) {
            hub.rejectSocket(socket, "unauthorized");
            return;
          }
          authed = true;
          hub.attachUnity(socket);
          socket.send(JSON.stringify({ type: "hello-ok", protocolVersion: 1 }));
        }
      });
    });

    instance.get("/events", { websocket: true }, (socket, request) => {
      if (isAuthorized(request, authToken, sessionSecret)) {
        hub.attachEvents(socket);
        socket.send(JSON.stringify({ type: "hello-ok", protocolVersion: 1 }));
        return;
      }
      let authed = false;
      socket.on("message", (data) => {
        if (authed) {
          return;
        }
        if (!hub.authenticate(String(data), authToken, "events")) {
          hub.rejectSocket(socket, "unauthorized");
          return;
        }
        authed = true;
        hub.attachEvents(socket);
        socket.send(JSON.stringify({ type: "hello-ok", protocolVersion: 1 }));
      });
    });
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!isAllowedHostHeader(request.headers.host, extraHosts)) {
      return reply.status(403).send({
        error: { code: "FORBIDDEN_HOST", message: "Host is not allowed." }
      });
    }

    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin, extraHosts)) {
      return reply.status(403).send({
        error: { code: "FORBIDDEN_ORIGIN", message: "Origin is not allowed." }
      });
    }

    if (isPublicPath(request.method, request.url)) {
      return;
    }

    if (!isAuthorized(request, authToken, sessionSecret)) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "A valid session token is required." }
      });
    }
  });

  app.get("/api/bootstrap", async (request, reply) => {
    const code = queryValue(request.query, "code");
    const expected = bootstrapNonce;
    if (!expected || !secretsEqual(code, expected)) {
      return reply.status(401).header("cache-control", "no-store").send({
        error: { code: "UNAUTHORIZED", message: "A valid session token is required." }
      });
    }
    bootstrapNonce = "";
    return reply
      .header("cache-control", "no-store")
      .header("set-cookie", sessionCookie(sessionSecret, isHttpsRequest(request)))
      .redirect("/");
  });

  app.post("/api/session", async (request, reply) => {
    const token = bodyToken(request.body);
    if (!secretsEqual(token, authToken)) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "A valid session token is required." }
      });
    }
    return reply.header("set-cookie", sessionCookie(sessionSecret, isHttpsRequest(request))).send({ protocolVersion: 1 });
  });

  app.get("/api/session", async () => ({ protocolVersion: 1 }));

  app.get("/api/project", async () => activeStore().getProjectSnapshot());
  app.get<{ Params: { objectId: string }; Querystring: { projectId?: string } }>(
    "/api/objects/:objectId",
    async (request) => activeStore().inspectObject(request.params.objectId, request.query.projectId)
  );
  app.post("/api/edits/preview", async (request) =>
    activeStore().previewEdit(editRequestSchema.parse(request.body))
  );
  app.post("/api/edits", async (request) => activeStore().applyEdit(editRequestSchema.parse(request.body)));
  app.post("/api/save", async (request) => activeStore().saveScene(saveRequestSchema.parse(request.body)));
  app.post("/api/context", async (request) => {
    const body = contextRequestSchema.parse(request.body ?? {});
    return activeStore().createContext(body.objectIds ?? [], body.projectId);
  });
  app.get("/api/play", async () => activeStore().getPlayState());
  app.post("/api/play", async (request) =>
    activeStore().setPlayMode(playModeRequestSchema.parse(request.body))
  );
  app.post("/api/set-active", async (request) =>
    activeStore().setActive(setActiveRequestSchema.parse(request.body))
  );
  app.get("/api/game-view", async () => activeStore().getGameViewFrame());
  app.post("/api/input", async (request) =>
    activeStore().sendGameInput(gameInputSchema.parse(request.body))
  );

  if (options.webRoot && existsSync(options.webRoot)) {
    const webRoot = path.resolve(options.webRoot);
    const sendIndex = (reply: FastifyReply) => {
      const html = readFileSync(path.join(webRoot, "index.html"), "utf8");
      return reply.type("text/html; charset=utf-8").send(html);
    };
    app.get("/", async (_request, reply) => sendIndex(reply));
    app.register(fastifyStatic, {
      root: webRoot,
      // Serve files from disk per request: a wildcard route keeps rebuilt hashed
      // assets reachable without restarting the broker (wildcard: false snapshots
      // the file list at registration time and falls back to index.html).
      wildcard: true,
      index: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === "GET" &&
        !request.url.startsWith("/api/") &&
        !request.url.startsWith("/connector") &&
        !request.url.startsWith("/events")
      ) {
        return sendIndex(reply);
      }
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } });
    });
  }

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof UnityRemoteError) {
      return reply.status(error.statusCode).send(error.toJSON());
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Request payload is invalid.", details: { issues: error.issues } }
      });
    }
    const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: "INVALID_REQUEST", message: "Request payload is invalid." }
      });
    }
    console.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }
    });
  });

  return app;
}

function createEventedStore(store: UnityStore, hub: ConnectorHub): UnityStore {
  return {
    getProjectSnapshot: () => store.getProjectSnapshot(),
    inspectObject: (objectId, projectId) => store.inspectObject(objectId, projectId),
    previewEdit: (request) => store.previewEdit(request),
    applyEdit: async (request) => {
      const result = await store.applyEdit(request);
      hub.broadcast({
        type: "propertyChanged",
        projectId: request.projectId,
        sceneId: result.object.sceneId,
        objectId: result.object.id,
        revision: result.object.revision
      });
      return result;
    },
    saveScene: async (request) => {
      const result = await store.saveScene(request);
      hub.broadcast({
        type: "sceneSaved",
        projectId: request.projectId,
        sceneId: result.sceneId,
        revision: result.revision
      });
      return result;
    },
    setActive: async (request) => {
      const object = await store.inspectObject(request.objectId, request.projectId);
      const result = await store.setActive(request);
      hub.broadcast({
        type: "hierarchyChanged",
        projectId: request.projectId,
        sceneId: object.sceneId,
        objectId: result.objectId,
        revision: result.revision
      });
      return result;
    },
    createContext: (objectIds, projectId) => store.createContext(objectIds, projectId),
    getPlayState: () => store.getPlayState(),
    setPlayMode: async (request) => {
      const state = await store.setPlayMode(request);
      const snapshot = await store.getProjectSnapshot();
      hub.broadcast({ type: "playModeChanged", projectId: snapshot.project.id });
      return state;
    },
    getGameViewFrame: () => store.getGameViewFrame(),
    sendGameInput: (request) => store.sendGameInput(request)
  };
}

function isPublicPath(method: string, url: string): boolean {
  const pathname = url.split("?")[0] ?? url;
  if (pathname === "/connector" || pathname === "/events") {
    return true;
  }
  if (pathname === "/api/bootstrap" && method === "GET") {
    return true;
  }
  if (pathname === "/api/session" && method === "POST") {
    return true;
  }
  return !pathname.startsWith("/api/");
}

function isAuthorized(request: FastifyRequest, authToken: string, sessionSecret: string): boolean {
  return bearerMatches(request.headers.authorization, authToken) || secretsEqual(cookieValue(request.headers.cookie), sessionSecret);
}

function bearerMatches(authorization: string | undefined, token: string): boolean {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) {
    return false;
  }
  return secretsEqual(authorization.slice(prefix.length), token);
}

function secretsEqual(provided: string | undefined, expected: string): boolean {
  if (!provided || expected.length === 0) {
    return false;
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === BROWSER_SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function isHttpsRequest(request: FastifyRequest): boolean {
  if (request.protocol === "https") {
    return true;
  }
  const forwarded = request.headers["x-forwarded-proto"];
  const proto = typeof forwarded === "string" ? forwarded : forwarded?.[0];
  return proto?.split(",")[0]?.trim() === "https";
}

function sessionCookie(sessionSecret: string, secure: boolean): string {
  const base = `${BROWSER_SESSION_COOKIE}=${sessionSecret}; Path=/; HttpOnly; SameSite=Strict`;
  return secure ? `${base}; Secure` : base;
}

function queryValue(query: unknown, key: string): string {
  if (typeof query !== "object" || query === null || !(key in query)) {
    return "";
  }
  const value = (query as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function bodyToken(body: unknown): string {
  if (typeof body !== "object" || body === null || !("token" in body)) {
    return "";
  }
  const token = (body as { token?: unknown }).token;
  return typeof token === "string" ? token : "";
}
