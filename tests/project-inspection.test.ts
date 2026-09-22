import { describe, expect, it } from "vitest";
import { createDemoStore } from "../src/server/store.js";

describe("project inspection contract", () => {
  it("returns the project, loaded scene, hierarchy, and selected object properties", async () => {
    const store = createDemoStore();
    const snapshot = await store.getProjectSnapshot();

    expect(snapshot.project.name).toBe("PlayerProject");
    expect(snapshot.project.source).toBe("demo");
    expect(snapshot.project.protocolVersion).toBe(1);
    expect(snapshot.project.assetRoots).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "Assets" })])
    );
    expect(snapshot.scenes).toContainEqual(
      expect.objectContaining({ path: "Assets/Scenes/Main.unity", loaded: true })
    );
    expect(snapshot.hierarchy[0]?.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "go-main-camera", name: "Main Camera" })])
    );

    expect(await store.inspectObject("go-main-camera")).toEqual(
      expect.objectContaining({
        revision: 1,
        components: expect.arrayContaining([
          expect.objectContaining({
            type: "UnityEngine.Transform",
            properties: expect.objectContaining({ "m_LocalPosition.x": 0 })
          })
        ])
      })
    );
  });
});
