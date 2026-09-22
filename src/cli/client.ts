import { readFileSync } from "node:fs";
import { UnityRemoteError } from "../server/errors.js";

export type BrokerClient = {
  project(): Promise<unknown>;
  inspect(objectId: string, projectId?: string): Promise<unknown>;
  preview(body: unknown): Promise<unknown>;
  edit(body: unknown): Promise<unknown>;
  save(body: unknown): Promise<unknown>;
  context(body: unknown): Promise<unknown>;
  play(): Promise<unknown>;
  setPlayMode(playing: boolean): Promise<unknown>;
  gameView(): Promise<unknown>;
  sendInput(body: unknown): Promise<unknown>;
};

export type ClientOptions = {
  broker?: string;
  token?: string;
  tokenFile?: string;
};

export function createBrokerClient(options: ClientOptions): BrokerClient {
  const base = (options.broker ?? process.env.UNITY_REMOTE_BROKER ?? "http://127.0.0.1:4173").replace(/\/$/, "");
  const token = options.token?.trim() || process.env.UNITY_REMOTE_TOKEN?.trim() || readToken(options.tokenFile ?? ".unity-remote-token");

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers
        }
      });
    } catch (error) {
      throw new UnityRemoteError(
        "BROKER_UNAVAILABLE",
        `Could not reach the Unity Remote broker at ${base}.`,
        503,
        { broker: base, cause: error instanceof Error ? error.message : "unknown" }
      );
    }

    const payload = (await response.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
      | undefined;
    if (!response.ok) {
      throw new UnityRemoteError(
        payload?.error?.code ?? "INVALID_REQUEST",
        payload?.error?.message ?? `Broker request failed with ${response.status}.`,
        response.status,
        payload?.error?.details ?? {}
      );
    }
    return payload;
  }

  return {
    project: () => request("/api/project"),
    inspect: (objectId, projectId) => {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return request(`/api/objects/${encodeURIComponent(objectId)}${query}`);
    },
    preview: (body) => request("/api/edits/preview", { method: "POST", body: JSON.stringify(body) }),
    edit: (body) => request("/api/edits", { method: "POST", body: JSON.stringify(body) }),
    save: (body) => request("/api/save", { method: "POST", body: JSON.stringify(body) }),
    context: (body) => request("/api/context", { method: "POST", body: JSON.stringify(body) }),
    play: () => request("/api/play"),
    setPlayMode: (playing) => request("/api/play", { method: "POST", body: JSON.stringify({ playing }) }),
    gameView: () => request("/api/game-view"),
    sendInput: (body) => request("/api/input", { method: "POST", body: JSON.stringify(body) })
  };
}

function readToken(tokenFile: string): string {
  try {
    return readFileSync(tokenFile, "utf8").trim();
  } catch {
    throw new UnityRemoteError(
      "UNAUTHORIZED",
      `No session token found. Start the broker or pass --token / --token-file (looked for ${tokenFile}).`,
      401,
      { tokenFile }
    );
  }
}
