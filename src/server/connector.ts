import { randomUUID, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import {
  connectorHelloSchema,
  connectorResponseSchema,
  editPreviewSchema,
  editRequestSchema,
  editResultSchema,
  objectSnapshotSchema,
  gameInputSchema,
  gameViewFrameSchema,
  inputResultSchema,
  playModeRequestSchema,
  playStateSchema,
  projectSnapshotSchema,
  protocolEventSchema,
  saveRequestSchema,
  saveResultSchema,
  setActiveRequestSchema,
  setActiveResultSchema,
  unityContextSchema,
  type ConnectorRequest,
  type ObjectSnapshot,
  type ProjectSnapshot,
  type ProtocolEvent
} from "../contracts/protocol.js";
import { statusForCode, UnityRemoteError } from "./errors.js";
import { gameViewUnavailable, inputUnavailable, playModeUnavailable, type UnityStore } from "./store.js";

const REQUEST_TIMEOUT_MS = 10_000;
export const SET_ACTIVE_SETTLE_WINDOW_MS = 300;

type ConnectorClock = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

const systemClock: ConnectorClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer)
};

export let connectorClock: ConnectorClock = systemClock;

export function setConnectorClockForTests(nextClock: ConnectorClock | undefined): void {
  connectorClock = nextClock ?? systemClock;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: UnityRemoteError) => void;
  timer: ReturnType<typeof setTimeout>;
};

type HierarchySettleSlot = {
  projectId: string;
  until: number;
  heldGeneric: ProtocolEvent | undefined;
  specificArrived: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function closeSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    socket.terminate();
  }
}

export class ConnectorHub {
  private unitySocket: WebSocket | undefined;
  private readonly eventSockets = new Set<WebSocket>();
  private readonly pending = new Map<string, Pending>();
  private readonly hierarchySettleSlots = new Map<string, HierarchySettleSlot>();
  private lastSnapshot: ProjectSnapshot | undefined;
  private readonly objectCache = new Map<string, ObjectSnapshot>();
  private hadUnity = false;

  get unityConnected(): boolean {
    return this.unitySocket !== undefined && this.unitySocket.readyState === this.unitySocket.OPEN;
  }

  activeStore(fallback: UnityStore): UnityStore {
    if (this.unityConnected) {
      return this.createUnityStore();
    }
    if (this.hadUnity && this.lastSnapshot) {
      return this.createFrozenStore();
    }
    return fallback;
  }

  authenticate(raw: string, expectedToken: string, role: "unity" | "events"): boolean {
    try {
      const parsed = connectorHelloSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success || parsed.data.role !== role) {
        return false;
      }
      const provided = Buffer.from(parsed.data.token);
      const expected = Buffer.from(expectedToken);
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  }

  attachUnity(socket: WebSocket): void {
    if (this.unitySocket && this.unitySocket !== socket) {
      closeSocket(this.unitySocket, 4000, "replaced");
      this.rejectAll("UNITY_REPLACED", "The Unity connector was replaced by a new session.", 409);
    }
    this.unitySocket = socket;
    this.hadUnity = true;
    socket.on("message", (data) => this.onUnityMessage(String(data)));
    socket.on("close", () => this.onUnityClose(socket));
    socket.on("error", () => this.onUnityClose(socket));
    this.broadcast({
      type: "connection",
      projectId: this.lastSnapshot?.project.id ?? "unity"
    });
  }

  attachEvents(socket: WebSocket): void {
    this.eventSockets.add(socket);
    const remove = (): void => {
      this.eventSockets.delete(socket);
    };
    socket.on("close", remove);
    socket.on("error", remove);
  }

  rejectSocket(socket: WebSocket, reason: string): void {
    closeSocket(socket, 4401, reason);
  }

  broadcast(event: ProtocolEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.eventSockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  private onUnityMessage(raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      this.failConnector("INVALID_UNITY_PAYLOAD", "Unity sent malformed JSON.");
      return;
    }
    if (typeof value !== "object" || value === null) {
      this.failConnector("INVALID_UNITY_PAYLOAD", "Unity sent an incompatible payload.");
      return;
    }
    const record = value as { type?: unknown; id?: unknown; event?: unknown };
    if (record.type === "event") {
      const parsed = protocolEventSchema.safeParse(record.event ?? record);
      if (parsed.success) {
        this.forwardUnityEvent(parsed.data);
      }
      return;
    }
    if (record.type !== "response") {
      return;
    }
    const response = connectorResponseSchema.safeParse(value);
    if (!response.success) {
      this.failConnector("INVALID_UNITY_PAYLOAD", "Unity sent an incompatible response.");
      return;
    }
    const pending = this.pending.get(response.data.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.data.id);
    clearTimeout(pending.timer);
    if (!response.data.ok || response.data.error) {
      const error = response.data.error;
      const code = error?.code ?? "UNITY_ERROR";
      pending.reject(
        new UnityRemoteError(
          code,
          error?.message ?? "Unity rejected the request.",
          statusForCode(code, error?.statusCode),
          (error?.details as Record<string, unknown> | undefined) ?? {}
        )
      );
      return;
    }
    pending.resolve(response.data.payload);
  }

  private forwardUnityEvent(event: ProtocolEvent): void {
    if (event.type !== "hierarchyChanged") {
      this.broadcast(event);
      return;
    }

    const slot = this.activeHierarchySettleSlot(event.projectId);
    if (event.objectId) {
      if (slot) {
        slot.specificArrived = true;
        slot.heldGeneric = undefined;
      }
      this.broadcast(event);
      return;
    }

    if (!slot) {
      this.broadcast(event);
      return;
    }

    // Unity may defer a generic hierarchy callback until after setActive's specific bridge event.
    // Hold one generic per project briefly: it is flushed at expiry unless a specific event
    // supersedes it, so unrelated external hierarchy notifications are delayed, never lost.
    slot.heldGeneric = event;
  }

  private beginHierarchySettle(projectId: string): void {
    const existing = this.hierarchySettleSlots.get(projectId);
    if (existing) {
      if (existing.timer) {
        connectorClock.clearTimeout(existing.timer);
      }
      existing.until = connectorClock.now() + SET_ACTIVE_SETTLE_WINDOW_MS;
      existing.specificArrived = false;
      existing.timer = connectorClock.setTimeout(
        () => this.finishHierarchySettle(existing),
        SET_ACTIVE_SETTLE_WINDOW_MS
      );
      return;
    }

    const slot: HierarchySettleSlot = {
      projectId,
      until: connectorClock.now() + SET_ACTIVE_SETTLE_WINDOW_MS,
      heldGeneric: undefined,
      specificArrived: false,
      timer: undefined
    };
    slot.timer = connectorClock.setTimeout(() => this.finishHierarchySettle(slot), SET_ACTIVE_SETTLE_WINDOW_MS);
    this.hierarchySettleSlots.set(projectId, slot);
  }

  private activeHierarchySettleSlot(projectId: string): HierarchySettleSlot | undefined {
    const slot = this.hierarchySettleSlots.get(projectId);
    if (!slot) {
      return undefined;
    }
    if (connectorClock.now() < slot.until) {
      return slot;
    }
    this.finishHierarchySettle(slot);
    return undefined;
  }

  private finishHierarchySettle(slot: HierarchySettleSlot): void {
    if (this.hierarchySettleSlots.get(slot.projectId) !== slot) {
      return;
    }
    this.hierarchySettleSlots.delete(slot.projectId);
    if (slot.timer) {
      connectorClock.clearTimeout(slot.timer);
    }
    if (slot.heldGeneric && !slot.specificArrived) {
      this.broadcast(slot.heldGeneric);
    }
  }

  private failConnector(code: string, message: string): void {
    const socket = this.unitySocket;
    this.unitySocket = undefined;
    this.rejectAll(code, message, statusForCode(code));
    if (socket) {
      closeSocket(socket, 4402, code);
    }
  }

  private onUnityClose(socket: WebSocket): void {
    if (this.unitySocket !== socket) {
      return;
    }
    this.unitySocket = undefined;
    this.rejectAll("DISCONNECTED", "The Unity Editor disconnected.", 503);
    if (this.lastSnapshot) {
      this.lastSnapshot = {
        ...this.lastSnapshot,
        project: { ...this.lastSnapshot.project, connected: false }
      };
    }
    this.broadcast({
      type: "connection",
      projectId: this.lastSnapshot?.project.id ?? "unity"
    });
  }

  private rejectAll(code: string, message: string, status: number): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new UnityRemoteError(code, message, status));
      this.pending.delete(id);
    }
  }

  private rpc<T>(method: ConnectorRequest["method"], payload: unknown, parse: (value: unknown) => T): Promise<T> {
    const socket = this.unitySocket;
    if (!socket || socket.readyState !== socket.OPEN) {
      return Promise.reject(new UnityRemoteError("DISCONNECTED", "The Unity Editor is not connected.", 503));
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new UnityRemoteError("UNITY_TIMEOUT", `Unity did not answer '${method}' in time.`, 504, { method }));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          try {
            resolve(parse(value));
          } catch {
            reject(new UnityRemoteError("INVALID_UNITY_PAYLOAD", "Unity returned an incompatible payload.", 502));
          }
        },
        reject,
        timer
      });
      socket.send(JSON.stringify({ type: "request", id, method, payload } satisfies ConnectorRequest));
    });
  }

  private createUnityStore(): UnityStore {
    return {
      getProjectSnapshot: async () => {
        const snapshot = await this.rpc("getProjectSnapshot", {}, (value) => projectSnapshotSchema.parse(value));
        this.lastSnapshot = snapshot;
        return snapshot;
      },
      inspectObject: async (objectId, projectId) => {
        const object = await this.rpc("inspectObject", { objectId, projectId }, (value) =>
          objectSnapshotSchema.parse(value)
        );
        this.objectCache.set(object.id, object);
        return object;
      },
      previewEdit: (request) =>
        this.rpc("previewEdit", editRequestSchema.parse(request), (value) => editPreviewSchema.parse(value)),
      applyEdit: async (request) => {
        const result = await this.rpc("applyEdit", editRequestSchema.parse(request), (value) =>
          editResultSchema.parse(value)
        );
        this.objectCache.set(result.object.id, result.object);
        this.broadcast({
          type: "propertyChanged",
          projectId: request.projectId,
          sceneId: result.object.sceneId,
          objectId: result.object.id,
          revision: result.object.revision
        });
        return result;
      },
      saveScene: async (request) => {
        const result = await this.rpc("saveScene", saveRequestSchema.parse(request), (value) =>
          saveResultSchema.parse(value)
        );
        this.broadcast({
          type: "sceneSaved",
          projectId: request.projectId,
          sceneId: result.sceneId,
          revision: result.revision
        });
        return result;
      },
      setActive: (request) => {
        const parsed = setActiveRequestSchema.parse(request);
        this.beginHierarchySettle(parsed.projectId);
        return this.rpc("setActive", parsed, (value) => setActiveResultSchema.parse(value));
      },
      createContext: (objectIds, projectId) =>
        this.rpc("createContext", { objectIds, projectId }, (value) => unityContextSchema.parse(value)),
      getPlayState: () => this.rpc("getPlayState", {}, (value) => playStateSchema.parse(value)),
      setPlayMode: async (request) => {
        const state = await this.rpc("setPlayMode", playModeRequestSchema.parse(request), (value) =>
          playStateSchema.parse(value)
        );
        this.broadcast({
          type: "playModeChanged",
          projectId: this.lastSnapshot?.project.id ?? "unity"
        });
        return state;
      },
      getGameViewFrame: () => this.rpc("getGameViewFrame", {}, (value) => gameViewFrameSchema.parse(value)),
      sendGameInput: (request) =>
        this.rpc("sendGameInput", gameInputSchema.parse(request), (value) => inputResultSchema.parse(value))
    };
  }

  private createFrozenStore(): UnityStore {
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      throw new UnityRemoteError("DISCONNECTED", "The Unity Editor is not connected.", 503);
    }
    const objects = this.objectCache;
    const readSnapshot = async (): Promise<ProjectSnapshot> => ({
      ...snapshot,
      project: { ...snapshot.project, connected: false }
    });
    const rejectWrite = async (): Promise<never> => {
      throw new UnityRemoteError(
        "DISCONNECTED",
        "The Unity Editor disconnected. Reopen the project in the Editor to reconnect.",
        503
      );
    };
    return {
      getProjectSnapshot: readSnapshot,
      inspectObject: async (objectId) => {
        const object = objects.get(objectId);
        if (!object) {
          throw new UnityRemoteError("OBJECT_NOT_FOUND", `Object '${objectId}' was not found.`, 404, { objectId });
        }
        return object;
      },
      previewEdit: rejectWrite,
      applyEdit: rejectWrite,
      saveScene: rejectWrite,
      setActive: rejectWrite,
      getPlayState: async () => {
        throw playModeUnavailable();
      },
      setPlayMode: async () => {
        throw playModeUnavailable();
      },
      getGameViewFrame: async () => {
        throw gameViewUnavailable();
      },
      sendGameInput: async () => {
        throw inputUnavailable();
      },
      createContext: async (objectIds) => ({
        kind: "unity-project-context",
        generatedAt: new Date().toISOString(),
        ...(await readSnapshot()),
        objects: objectIds.map((id) => {
          const object = objects.get(id);
          if (!object) {
            throw new UnityRemoteError("OBJECT_NOT_FOUND", `Object '${id}' was not found.`, 404, { objectId: id });
          }
          return object;
        })
      })
    };
  }
}
