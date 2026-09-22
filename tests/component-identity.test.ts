import { describe, expect, it } from "vitest";
import { createDemoStore } from "../src/server/store.js";

describe("component and property identity", () => {
  it("edits the selected duplicate component without touching the other", async () => {
    const store = createDemoStore();
    const before = await store.inspectObject("go-player");
    const colliders = before.components.filter((item) => item.type === "UnityEngine.BoxCollider");
    expect(colliders).toHaveLength(2);
    expect(colliders[0]?.id).not.toBe(colliders[1]?.id);

    const result = await store.applyEdit({
      projectId: "project-player",
      objectId: "go-player",
      componentId: colliders[1]!.id,
      property: "m_Size.x",
      value: 9,
      expectedRevision: before.revision
    });

    const first = result.object.components.find((item) => item.id === colliders[0]?.id);
    const second = result.object.components.find((item) => item.id === colliders[1]?.id);
    expect(first?.properties["m_Size.x"]).toBe(1);
    expect(second?.properties["m_Size.x"]).toBe(9);
    expect(result.after).toBe(9);
  });

  it("addresses serialized fields by property path when display names collide", async () => {
    const store = createDemoStore();
    const before = await store.inspectObject("go-player");
    const collider = before.components.find((item) => item.id === "cmp-player-box-1");
    expect(collider?.propertyDisplayNames["m_Size.x"]).toBe("X");
    expect(collider?.propertyDisplayNames["m_Center.x"]).toBe("X");

    const result = await store.applyEdit({
      projectId: "project-player",
      objectId: "go-player",
      componentId: "cmp-player-box-1",
      property: "m_Center.x",
      value: 3,
      expectedRevision: before.revision
    });

    const updated = result.object.components.find((item) => item.id === "cmp-player-box-1");
    expect(updated?.properties["m_Size.x"]).toBe(1);
    expect(updated?.properties["m_Center.x"]).toBe(3);
  });
});
