import type {
  ComponentSnapshot,
  EditPreview,
  EditRequest,
  EditResult,
  HierarchyNode,
  ObjectSnapshot,
  GameInput,
  GameViewFrame,
  InputResult,
  PlayModeRequest,
  PlayState,
  ProjectSnapshot,
  ProtocolEvent,
  SaveRequest,
  SaveResult,
  SetActiveRequest,
  SetActiveResult,
  ScalarValue,
  UnityContext
} from "../contracts/protocol.js";
import { PROTOCOL_VERSION } from "../contracts/protocol.js";
import { UnityRemoteError } from "./errors.js";

const clone = <T>(value: T): T => structuredClone(value);

export const PLAY_MODE_REQUIRES_UNITY = "Play Mode requires a connected Unity Editor.";
export const GAME_VIEW_REQUIRES_UNITY = "Game View requires a connected Unity Editor.";
export const INPUT_REQUIRES_UNITY = "Input requires a connected Unity Editor.";

export function playModeUnavailable(): UnityRemoteError {
  return new UnityRemoteError("DISCONNECTED", PLAY_MODE_REQUIRES_UNITY, 503);
}

export function gameViewUnavailable(): UnityRemoteError {
  return new UnityRemoteError("DISCONNECTED", GAME_VIEW_REQUIRES_UNITY, 503);
}

export function inputUnavailable(): UnityRemoteError {
  return new UnityRemoteError("DISCONNECTED", INPUT_REQUIRES_UNITY, 503);
}

export interface UnityStore {
  getProjectSnapshot(): Promise<ProjectSnapshot>;
  inspectObject(objectId: string, projectId?: string): Promise<ObjectSnapshot>;
  previewEdit(request: EditRequest): Promise<EditPreview>;
  applyEdit(request: EditRequest): Promise<EditResult>;
  saveScene(request: SaveRequest): Promise<SaveResult>;
  setActive(request: SetActiveRequest): Promise<SetActiveResult>;
  createContext(objectIds: string[], projectId?: string): Promise<UnityContext>;
  getPlayState(): Promise<PlayState>;
  setPlayMode(request: PlayModeRequest): Promise<PlayState>;
  getGameViewFrame(): Promise<GameViewFrame>;
  sendGameInput(request: GameInput): Promise<InputResult>;
}

export type DemoStoreOptions = {
  onEvent?: (event: ProtocolEvent) => void;
};

const TRANSFORM_LABELS: Record<string, string> = {
  "m_LocalPosition.x": "Position X",
  "m_LocalPosition.y": "Position Y",
  "m_LocalPosition.z": "Position Z",
  "m_LocalEulerAnglesHint.x": "Rotation X",
  "m_LocalEulerAnglesHint.y": "Rotation Y",
  "m_LocalEulerAnglesHint.z": "Rotation Z"
};

function transformComponent(
  id: string,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): ComponentSnapshot {
  const properties: Record<string, ScalarValue> = {
    "m_LocalPosition.x": position.x,
    "m_LocalPosition.y": position.y,
    "m_LocalPosition.z": position.z,
    "m_LocalEulerAnglesHint.x": rotation.x,
    "m_LocalEulerAnglesHint.y": rotation.y,
    "m_LocalEulerAnglesHint.z": rotation.z
  };
  return {
    id,
    type: "UnityEngine.Transform",
    properties,
    editableProperties: Object.keys(properties),
    propertyDisplayNames: { ...TRANSFORM_LABELS }
  };
}

function component(
  id: string,
  type: string,
  properties: Record<string, ScalarValue>,
  propertyDisplayNames: Record<string, string>
): ComponentSnapshot {
  return {
    id,
    type,
    properties,
    editableProperties: Object.keys(properties),
    propertyDisplayNames
  };
}

export function createDemoStore(options: DemoStoreOptions = {}): UnityStore {
  const hierarchy: HierarchyNode[] = [
    {
      id: "scene-main-root",
      name: "Main",
      active: true,
      children: [
        { id: "go-main-camera", name: "Main Camera", active: true, children: [] },
        { id: "go-directional-light", name: "Directional Light", active: true, children: [] },
        { id: "go-player", name: "Player", active: true, children: [] }
      ]
    }
  ];

  const objects = new Map<string, ObjectSnapshot>([
    [
      "go-main-camera",
      {
        id: "go-main-camera",
        sceneId: "scene-main",
        name: "Main Camera",
        active: true,
        revision: 1,
        components: [
          transformComponent("cmp-main-camera-transform", { x: 0, y: 1, z: -10 }),
          component(
            "cmp-main-camera-camera",
            "UnityEngine.Camera",
            { m_FieldOfView: 60, m_NearClipPlane: 0.3, m_FarClipPlane: 1000 },
            { m_FieldOfView: "Field Of View", m_NearClipPlane: "Near", m_FarClipPlane: "Far" }
          )
        ]
      }
    ],
    [
      "go-directional-light",
      {
        id: "go-directional-light",
        sceneId: "scene-main",
        name: "Directional Light",
        active: true,
        revision: 1,
        components: [
          transformComponent("cmp-directional-light-transform", { x: 0, y: 3, z: 0 }, { x: 50, y: -30, z: 0 }),
          component(
            "cmp-directional-light-light",
            "UnityEngine.Light",
            { m_Intensity: 1, m_Color: "#fff4d6" },
            { m_Intensity: "Intensity", m_Color: "Color" }
          )
        ]
      }
    ],
    [
      "go-player",
      {
        id: "go-player",
        sceneId: "scene-main",
        name: "Player",
        active: true,
        revision: 1,
        components: [
          transformComponent("cmp-player-transform", { x: 0, y: 0, z: 0 }),
          component(
            "cmp-player-box-1",
            "UnityEngine.BoxCollider",
            { "m_Size.x": 1, "m_Center.x": 0, m_IsTrigger: false },
            { "m_Size.x": "X", "m_Center.x": "X", m_IsTrigger: "Is Trigger" }
          ),
          component(
            "cmp-player-box-2",
            "UnityEngine.BoxCollider",
            { "m_Size.x": 2, "m_Center.x": 0.5, m_IsTrigger: true },
            { "m_Size.x": "X", "m_Center.x": "X", m_IsTrigger: "Is Trigger" }
          )
        ]
      }
    ]
  ]);

  const projectSnapshot: ProjectSnapshot = {
    project: {
      id: "project-player",
      name: "PlayerProject",
      unityVersion: "6000.0",
      connected: true,
      source: "demo",
      protocolVersion: PROTOCOL_VERSION,
      assetRoots: [
        { name: "Assets", path: "Assets" },
        { name: "Packages", path: "Packages" }
      ]
    },
    scenes: [
      {
        id: "scene-main",
        name: "Main",
        path: "Assets/Scenes/Main.unity",
        loaded: true,
        dirty: false,
        revision: 1
      }
    ],
    hierarchy
  };

  function assertProject(projectId: string | undefined): void {
    if (projectId && projectId !== projectSnapshot.project.id) {
      throw new UnityRemoteError(
        "PROJECT_MISMATCH",
        `Project '${projectId}' is not the connected project '${projectSnapshot.project.id}'.`,
        409,
        { projectId, actualProjectId: projectSnapshot.project.id }
      );
    }
  }

  async function inspectObject(objectId: string, projectId?: string): Promise<ObjectSnapshot> {
    assertProject(projectId);
    const object = objects.get(objectId);
    if (!object) {
      throw new UnityRemoteError("OBJECT_NOT_FOUND", `Object '${objectId}' was not found.`, 404, { objectId });
    }
    return clone(object);
  }

  function resolveEditable(request: EditRequest): {
    object: ObjectSnapshot;
    component: ComponentSnapshot;
    before: ScalarValue;
  } {
    assertProject(request.projectId);
    const object = objects.get(request.objectId);
    if (!object) {
      throw new UnityRemoteError(
        "OBJECT_NOT_FOUND",
        `Object '${request.objectId}' was not found.`,
        404,
        { objectId: request.objectId }
      );
    }
    if (object.revision !== request.expectedRevision) {
      throw new UnityRemoteError(
        "REVISION_CONFLICT",
        `Expected revision ${request.expectedRevision}, but object is at revision ${object.revision}.`,
        409,
        { expectedRevision: request.expectedRevision, actualRevision: object.revision, objectId: object.id }
      );
    }
    const component = object.components.find((item) => item.id === request.componentId);
    if (!component) {
      throw new UnityRemoteError(
        "COMPONENT_NOT_FOUND",
        `Component '${request.componentId}' was not found.`,
        404,
        { componentId: request.componentId }
      );
    }
    if (!component.editableProperties.includes(request.property)) {
      throw new UnityRemoteError(
        "PROPERTY_NOT_EDITABLE",
        `Property '${request.componentId}.${request.property}' is not editable.`,
        422,
        { componentId: request.componentId, property: request.property }
      );
    }
    const before = component.properties[request.property];
    if (before === undefined) {
      throw new UnityRemoteError(
        "PROPERTY_NOT_FOUND",
        `Property '${request.componentId}.${request.property}' was not found.`,
        404,
        { componentId: request.componentId, property: request.property }
      );
    }
    return { object, component, before };
  }

  function undoGroupName(objectName: string, property: string): string {
    return `Unity Remote: ${objectName} ${property}`;
  }

  function setHierarchyNodeActive(nodes: HierarchyNode[], objectId: string, active: boolean): boolean {
    for (const node of nodes) {
      if (node.id === objectId) {
        node.active = active;
        return true;
      }
      if (setHierarchyNodeActive(node.children, objectId, active)) {
        return true;
      }
    }
    return false;
  }

  return {
    async getProjectSnapshot() {
      return clone(projectSnapshot);
    },
    inspectObject,
    async previewEdit(request) {
      const { object, before } = resolveEditable(request);
      return {
        preview: true,
        projectId: request.projectId,
        objectId: object.id,
        componentId: request.componentId,
        property: request.property,
        expectedRevision: request.expectedRevision,
        before,
        after: request.value,
        undoGroup: undoGroupName(object.name, request.property)
      };
    },
    async applyEdit(request) {
      const { object, component, before } = resolveEditable(request);
      component.properties[request.property] = request.value;
      object.revision += 1;
      const scene = projectSnapshot.scenes.find((item) => item.id === object.sceneId);
      if (scene) {
        scene.dirty = true;
        scene.revision += 1;
      }
      options.onEvent?.({
        type: "propertyChanged",
        projectId: projectSnapshot.project.id,
        sceneId: object.sceneId,
        objectId: object.id,
        revision: object.revision
      });
      return {
        transactionId: `tx-${object.revision}`,
        undoGroup: undoGroupName(object.name, request.property),
        object: clone(object),
        before,
        after: request.value,
        sceneDirty: scene?.dirty ?? false
      };
    },
    async setActive(request) {
      assertProject(request.projectId);
      const object = objects.get(request.objectId);
      if (!object) {
        throw new UnityRemoteError(
          "OBJECT_NOT_FOUND",
          `Object '${request.objectId}' was not found.`,
          404,
          { objectId: request.objectId }
        );
      }
      if (object.revision !== request.expectedRevision) {
        throw new UnityRemoteError(
          "REVISION_CONFLICT",
          `Expected revision ${request.expectedRevision}, but object is at revision ${object.revision}.`,
          409,
          { expectedRevision: request.expectedRevision, actualRevision: object.revision, objectId: object.id }
        );
      }
      object.active = request.active;
      setHierarchyNodeActive(hierarchy, object.id, request.active);
      object.revision += 1;
      const scene = projectSnapshot.scenes.find((item) => item.id === object.sceneId);
      if (scene) {
        scene.dirty = true;
        scene.revision += 1;
      }
      options.onEvent?.({
        type: "hierarchyChanged",
        projectId: projectSnapshot.project.id,
        sceneId: object.sceneId,
        objectId: object.id,
        revision: object.revision
      });
      return {
        objectId: object.id,
        active: object.active,
        revision: object.revision,
        sceneDirty: scene?.dirty ?? false
      };
    },
    async saveScene(request) {
      assertProject(request.projectId);
      const scene = projectSnapshot.scenes.find((item) => item.id === request.sceneId);
      if (!scene) {
        throw new UnityRemoteError("SCENE_NOT_FOUND", `Scene '${request.sceneId}' was not found.`, 404, {
          sceneId: request.sceneId
        });
      }
      scene.dirty = false;
      options.onEvent?.({
        type: "sceneSaved",
        projectId: projectSnapshot.project.id,
        sceneId: scene.id,
        revision: scene.revision
      });
      return {
        sceneId: scene.id,
        path: scene.path,
        dirty: false,
        revision: scene.revision
      };
    },
    async createContext(objectIds, projectId) {
      assertProject(projectId);
      const snapshot = clone(projectSnapshot);
      return {
        kind: "unity-project-context",
        generatedAt: new Date().toISOString(),
        project: snapshot.project,
        scenes: snapshot.scenes,
        hierarchy: snapshot.hierarchy,
        objects: await Promise.all(objectIds.map((id) => inspectObject(id, projectId)))
      };
    },
    async getPlayState() {
      throw playModeUnavailable();
    },
    async setPlayMode() {
      throw playModeUnavailable();
    },
    async getGameViewFrame() {
      throw gameViewUnavailable();
    },
    async sendGameInput() {
      throw inputUnavailable();
    }
  };
}
