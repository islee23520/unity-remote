import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  connectorEventSchema,
  connectorHelloSchema,
  connectorRequestSchema,
  connectorResponseSchema,
  contextRequestSchema,
  editPreviewSchema,
  editRequestSchema,
  editResultSchema,
  errorEnvelopeSchema,
  gameInputSchema,
  gameViewFrameSchema,
  inputResultSchema,
  inspectRequestSchema,
  objectSnapshotSchema,
  playModeRequestSchema,
  playStateSchema,
  projectSnapshotSchema,
  protocolEventSchema,
  saveRequestSchema,
  saveResultSchema,
  setActiveRequestSchema,
  setActiveResultSchema,
  unityContextSchema
} from "../src/contracts/protocol.js";
import { createDemoStore } from "../src/server/store.js";

const schema = JSON.parse(readFileSync("contracts/unity-remote.schema.json", "utf8")) as Record<string, unknown>;

const fixtures: Record<string, { def: string; parse: (value: unknown) => unknown }> = {
  "project-snapshot.json": { def: "projectSnapshot", parse: (value) => projectSnapshotSchema.parse(value) },
  "object-snapshot.json": { def: "objectSnapshot", parse: (value) => objectSnapshotSchema.parse(value) },
  "edit-request.json": { def: "editRequest", parse: (value) => editRequestSchema.parse(value) },
  "edit-preview.json": { def: "editPreview", parse: (value) => editPreviewSchema.parse(value) },
  "edit-result.json": { def: "editResult", parse: (value) => editResultSchema.parse(value) },
  "save-request.json": { def: "saveRequest", parse: (value) => saveRequestSchema.parse(value) },
  "save-result.json": { def: "saveResult", parse: (value) => saveResultSchema.parse(value) },
  "set-active-request.json": { def: "setActiveRequest", parse: (value) => setActiveRequestSchema.parse(value) },
  "set-active-result.json": { def: "setActiveResult", parse: (value) => setActiveResultSchema.parse(value) },
  "inspect-request.json": { def: "inspectRequest", parse: (value) => inspectRequestSchema.parse(value) },
  "context-request.json": { def: "contextRequest", parse: (value) => contextRequestSchema.parse(value) },
  "unity-context.json": { def: "unityContext", parse: (value) => unityContextSchema.parse(value) },
  "protocol-event.json": { def: "protocolEvent", parse: (value) => protocolEventSchema.parse(value) },
  "error-envelope.json": { def: "errorEnvelope", parse: (value) => errorEnvelopeSchema.parse(value) },
  "connector-hello.json": { def: "connectorHello", parse: (value) => connectorHelloSchema.parse(value) },
  "connector-request.json": { def: "connectorRequest", parse: (value) => connectorRequestSchema.parse(value) },
  "connector-response-error.json": { def: "connectorResponse", parse: (value) => connectorResponseSchema.parse(value) },
  "connector-response-internal-error.json": { def: "connectorResponse", parse: (value) => connectorResponseSchema.parse(value) },
  "connector-event.json": { def: "connectorEvent", parse: (value) => connectorEventSchema.parse(value) },
  "play-state.json": { def: "playState", parse: (value) => playStateSchema.parse(value) },
  "play-mode-request.json": { def: "playModeRequest", parse: (value) => playModeRequestSchema.parse(value) },
  "game-view-frame.json": { def: "gameViewFrame", parse: (value) => gameViewFrameSchema.parse(value) },
  "game-input.json": { def: "gameInput", parse: (value) => gameInputSchema.parse(value) },
  "input-result.json": { def: "inputResult", parse: (value) => inputResultSchema.parse(value) }
};

describe("shared protocol", () => {
  it("validates every wire envelope fixture against JSON Schema and Zod", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(schema);
    const names = readdirSync("contracts/fixtures").filter((name) => name.endsWith(".json")).sort();
    expect(names).toEqual(Object.keys(fixtures).sort());
    const defs = (schema.$defs ?? {}) as Record<string, unknown>;
    const requiredDefs = [
      "projectSnapshot",
      "objectSnapshot",
      "editRequest",
      "editPreview",
      "editResult",
      "saveRequest",
      "saveResult",
      "setActiveRequest",
      "setActiveResult",
      "inspectRequest",
      "contextRequest",
      "unityContext",
      "protocolEvent",
      "errorEnvelope",
      "connectorHello",
      "connectorRequest",
      "connectorResponse",
      "connectorEvent",
      "playState",
      "playModeRequest",
      "gameViewFrame",
      "gameInput",
      "inputResult"
    ];
    expect(requiredDefs.every((def) => def in defs)).toBe(true);
    expect(new Set(Object.values(fixtures).map((item) => item.def))).toEqual(new Set(requiredDefs));

    for (const name of names) {
      const spec = fixtures[name];
      if (!spec) {
        throw new Error(`No protocol mapping for fixture ${name}`);
      }
      const value = JSON.parse(readFileSync(join("contracts/fixtures", name), "utf8")) as unknown;
      const validate = ajv.compile({ $ref: `https://unity-remote.local/contracts/unity-remote.schema.json#/$defs/${spec.def}` });
      const ok = validate(value);
      expect(ok, `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      expect(spec.parse(value)).toEqual(value);
    }
  });

  it("rejects malformed set-active input", () => {
    expect(() =>
      setActiveRequestSchema.parse({
        projectId: "unity-live",
        objectId: "object-1",
        active: "yes",
        expectedRevision: 1
      })
    ).toThrow();
  });

  it("accepts sendGameInput connector method", () => {
    expect(
      connectorRequestSchema.parse({
        type: "request",
        id: "req-input",
        method: "sendGameInput",
        payload: { type: "keyDown", key: "w" }
      }).method
    ).toBe("sendGameInput");
  });

  it("accepts getGameViewFrame connector method", () => {
    expect(
      connectorRequestSchema.parse({
        type: "request",
        id: "req-game-view",
        method: "getGameViewFrame",
        payload: {}
      }).method
    ).toBe("getGameViewFrame");
  });

  it("parses the game view frame fixture", () => {
    const value = JSON.parse(readFileSync("contracts/fixtures/game-view-frame.json", "utf8")) as unknown;
    const frame = gameViewFrameSchema.parse(value);
    expect(frame.mimeType).toBe("image/jpeg");
    expect(frame.width).toBeGreaterThanOrEqual(1);
    expect(frame.height).toBeGreaterThanOrEqual(1);
    expect(frame.data.length).toBeGreaterThan(0);
  });

  it("accepts getPlayState and setPlayMode connector methods", () => {
    expect(
      connectorRequestSchema.parse({
        type: "request",
        id: "req-play-state",
        method: "getPlayState",
        payload: {}
      }).method
    ).toBe("getPlayState");
    expect(
      connectorRequestSchema.parse({
        type: "request",
        id: "req-play-mode",
        method: "setPlayMode",
        payload: { playing: true }
      }).method
    ).toBe("setPlayMode");
  });

  it("accepts playModeChanged protocol events", () => {
    expect(
      protocolEventSchema.parse({
        type: "playModeChanged",
        projectId: "unity-live"
      }).type
    ).toBe("playModeChanged");
  });

  it("rejects a generic connector error that serializes statusCode 0", () => {
    expect(() =>
      connectorResponseSchema.parse({
        type: "response",
        id: "req-internal",
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          details: {},
          statusCode: 0
        }
      })
    ).toThrow();
  });

  it("exports demo snapshots that include component ids and serialized property paths", async () => {
    const snapshot = await createDemoStore().inspectObject("go-main-camera");
    const transform = snapshot.components.find((item) => item.type === "UnityEngine.Transform");
    expect(transform?.id).toBe("cmp-main-camera-transform");
    expect(transform?.properties["m_LocalPosition.x"]).toBe(0);
    expect(transform?.propertyDisplayNames["m_LocalPosition.x"]).toBe("Position X");
    expect(objectSnapshotSchema.parse(snapshot).id).toBe("go-main-camera");
  });
});
