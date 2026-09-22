import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const scalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const assetRootSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1)
});

export const projectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unityVersion: z.string().min(1),
  connected: z.boolean(),
  source: z.enum(["demo", "unity"]),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  assetRoots: z.array(assetRootSchema)
});

export const sceneSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string(),
  loaded: z.boolean(),
  dirty: z.boolean(),
  revision: z.number().int().nonnegative()
});

export type HierarchyNode = {
  id: string;
  name: string;
  active: boolean;
  children: HierarchyNode[];
};

export const hierarchyNodeSchema: z.ZodType<HierarchyNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    active: z.boolean(),
    children: z.array(hierarchyNodeSchema)
  })
);

export const componentSnapshotSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.string(), scalarValueSchema),
  editableProperties: z.array(z.string().min(1)),
  propertyDisplayNames: z.record(z.string(), z.string().min(1))
});

export const objectSnapshotSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean(),
  revision: z.number().int().nonnegative(),
  components: z.array(componentSnapshotSchema)
});

export const projectSnapshotSchema = z.object({
  project: projectSummarySchema,
  scenes: z.array(sceneSummarySchema),
  hierarchy: z.array(hierarchyNodeSchema)
});

export const editRequestSchema = z.object({
  projectId: z.string().min(1),
  objectId: z.string().min(1),
  componentId: z.string().min(1),
  property: z.string().min(1),
  value: scalarValueSchema,
  expectedRevision: z.number().int().nonnegative()
});

export const saveRequestSchema = z.object({
  projectId: z.string().min(1),
  sceneId: z.string().min(1)
});

export const setActiveRequestSchema = z.object({
  projectId: z.string().min(1),
  objectId: z.string().min(1),
  active: z.boolean(),
  expectedRevision: z.number().int().nonnegative()
});

export const contextRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  objectIds: z.array(z.string().min(1).max(256)).max(100).optional()
});

export const inspectRequestSchema = z.object({
  projectId: z.string().min(1).optional(),
  objectId: z.string().min(1)
});

export const errorBodySchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  statusCode: z.number().int().min(400).max(599).optional()
});

export const errorEnvelopeSchema = z.object({
  error: errorBodySchema
});

export const editResultSchema = z.object({
  transactionId: z.string().min(1),
  undoGroup: z.string().min(1),
  object: objectSnapshotSchema,
  before: scalarValueSchema,
  after: scalarValueSchema,
  sceneDirty: z.boolean()
});

export const editPreviewSchema = z.object({
  preview: z.literal(true),
  projectId: z.string().min(1),
  objectId: z.string().min(1),
  componentId: z.string().min(1),
  property: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  before: scalarValueSchema,
  after: scalarValueSchema,
  undoGroup: z.string().min(1)
});

export const saveResultSchema = z.object({
  sceneId: z.string().min(1),
  path: z.string(),
  dirty: z.literal(false),
  revision: z.number().int().nonnegative()
});

export const setActiveResultSchema = z.object({
  objectId: z.string().min(1),
  active: z.boolean(),
  revision: z.number().int().nonnegative(),
  sceneDirty: z.boolean()
});

export const unityContextSchema = z.object({
  kind: z.literal("unity-project-context"),
  generatedAt: z.string().min(1),
  project: projectSummarySchema,
  scenes: z.array(sceneSummarySchema),
  hierarchy: z.array(hierarchyNodeSchema),
  objects: z.array(objectSnapshotSchema)
});

export const playStateSchema = z.object({
  playing: z.boolean(),
  transitioning: z.boolean()
});

export const playModeRequestSchema = z.object({
  playing: z.boolean()
});

export const gameViewFrameSchema = z.object({
  mimeType: z.literal("image/jpeg"),
  data: z.string().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1)
});

export const gameInputSchema = z
  .object({
    type: z.enum(["keyDown", "keyUp", "mouseMove", "mouseDown", "mouseUp"]),
    key: z.string().min(1).optional(),
    button: z.number().int().min(0).max(2).optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional()
  })
  .superRefine((value, ctx) => {
    if ((value.type === "keyDown" || value.type === "keyUp") && (value.key === undefined || value.key.length < 1)) {
      ctx.addIssue({ code: "custom", message: "key is required", path: ["key"] });
    }
    if (value.type === "mouseMove" || value.type === "mouseDown" || value.type === "mouseUp") {
      if (value.x === undefined) {
        ctx.addIssue({ code: "custom", message: "x is required", path: ["x"] });
      }
      if (value.y === undefined) {
        ctx.addIssue({ code: "custom", message: "y is required", path: ["y"] });
      }
    }
    if ((value.type === "mouseDown" || value.type === "mouseUp") && value.button === undefined) {
      ctx.addIssue({ code: "custom", message: "button is required", path: ["button"] });
    }
  });

export const inputResultSchema = z.object({
  accepted: z.literal(true)
});

export const protocolEventSchema = z.object({
  type: z.enum(["hierarchyChanged", "propertyChanged", "connection", "sceneSaved", "playModeChanged"]),
  projectId: z.string().min(1),
  sceneId: z.string().optional(),
  objectId: z.string().optional(),
  revision: z.number().int().nonnegative().optional()
});

export const connectorHelloSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  role: z.enum(["unity", "events"]),
  token: z.string().min(1)
});

export const connectorRequestSchema = z.object({
  type: z.literal("request"),
  id: z.string().min(1),
  method: z.enum(["getProjectSnapshot", "inspectObject", "applyEdit", "previewEdit", "createContext", "saveScene", "setActive", "getPlayState", "setPlayMode", "getGameViewFrame", "sendGameInput"]),
  payload: z.unknown()
});

export const connectorResponseSchema = z.object({
  type: z.literal("response"),
  id: z.string().min(1),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: errorBodySchema.optional()
});

export const connectorEventSchema = z.object({
  type: z.literal("event"),
  event: protocolEventSchema
});

export type ScalarValue = z.infer<typeof scalarValueSchema>;
export type AssetRoot = z.infer<typeof assetRootSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type SceneSummary = z.infer<typeof sceneSummarySchema>;
export type ComponentSnapshot = z.infer<typeof componentSnapshotSchema>;
export type ObjectSnapshot = z.infer<typeof objectSnapshotSchema>;
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;
export type EditRequest = z.infer<typeof editRequestSchema>;
export type SaveRequest = z.infer<typeof saveRequestSchema>;
export type SetActiveRequest = z.infer<typeof setActiveRequestSchema>;
export type EditResult = z.infer<typeof editResultSchema>;
export type EditPreview = z.infer<typeof editPreviewSchema>;
export type SaveResult = z.infer<typeof saveResultSchema>;
export type SetActiveResult = z.infer<typeof setActiveResultSchema>;
export type UnityContext = z.infer<typeof unityContextSchema>;
export type PlayState = z.infer<typeof playStateSchema>;
export type PlayModeRequest = z.infer<typeof playModeRequestSchema>;
export type GameViewFrame = z.infer<typeof gameViewFrameSchema>;
export type GameInput = z.infer<typeof gameInputSchema>;
export type InputResult = z.infer<typeof inputResultSchema>;
export type ProtocolEvent = z.infer<typeof protocolEventSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type ConnectorHello = z.infer<typeof connectorHelloSchema>;
export type ConnectorRequest = z.infer<typeof connectorRequestSchema>;
export type ConnectorResponse = z.infer<typeof connectorResponseSchema>;
export type ConnectorEvent = z.infer<typeof connectorEventSchema>;
