import {
  protocolEventSchema,
  type EditPreview,
  type EditRequest,
  type EditResult,
  type GameInput,
  type GameViewFrame,
  type ObjectSnapshot,
  type PlayModeRequest,
  type PlayState,
  type ProjectSnapshot,
  type ProtocolEvent,
  type SaveResult,
  type SetActiveRequest,
  type SetActiveResult,
  type UnityContext
} from "../contracts/protocol";

async function readError(response: Response): Promise<unknown> {
  return response.json().catch(() => ({ error: { code: "INVALID_REQUEST", message: response.statusText } }));
}

export async function readSession(): Promise<void> {
  const response = await fetch("/api/session", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw await readError(response);
}

export async function createSession(token: string): Promise<void> {
  const response = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token })
  });
  if (!response.ok) throw await readError(response);
}

export function createApi() {
  const headers = (): HeadersInit => ({
    accept: "application/json"
  });

  async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { credentials: "same-origin", headers: headers() });
    if (!response.ok) throw await readError(response);
    return response.json() as Promise<T>;
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw await readError(response);
    return response.json() as Promise<T>;
  }

  return {
    project: () => getJson<ProjectSnapshot>("/api/project"),
    object: (id: string, projectId: string) =>
      getJson<ObjectSnapshot>(`/api/objects/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`),
    preview: (payload: EditRequest) => postJson<EditPreview>("/api/edits/preview", payload),
    edit: (payload: EditRequest) => postJson<EditResult>("/api/edits", payload),
    save: (projectId: string, sceneId: string) => postJson<SaveResult>("/api/save", { projectId, sceneId }),
    setActive: (payload: SetActiveRequest) => postJson<SetActiveResult>("/api/set-active", payload),
    context: (projectId: string, objectIds: string[]) =>
      postJson<UnityContext>("/api/context", { projectId, objectIds }),
    playState: () => getJson<PlayState>("/api/play"),
    setPlayMode: (playing: boolean) => postJson<PlayState>("/api/play", { playing } satisfies PlayModeRequest),
    gameView: () => getJson<GameViewFrame>("/api/game-view"),
    sendInput: (payload: GameInput) => postJson<{ accepted: true }>("/api/input", payload)
  };
}

export type EventSocketHandlers = {
  onEvent: (event: ProtocolEvent) => void;
  onStatus?: (status: "open" | "closed" | "error", detail?: string) => void;
};

export function openEventSocket(handlers: EventSocketHandlers): WebSocket {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/events`);
  socket.addEventListener("open", () => {
    handlers.onStatus?.("open");
  });
  socket.addEventListener("message", (message) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(message.data)) as unknown;
    } catch {
      handlers.onStatus?.("error", "Event payload was not valid JSON.");
      return;
    }
    if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "hello-ok") {
      return;
    }
    const event = protocolEventSchema.safeParse(parsed);
    if (!event.success) {
      handlers.onStatus?.("error", "Event payload did not match the protocol.");
      return;
    }
    handlers.onEvent(event.data);
  });
  socket.addEventListener("close", () => handlers.onStatus?.("closed"));
  socket.addEventListener("error", () => handlers.onStatus?.("error", "Event socket error."));
  return socket;
}
