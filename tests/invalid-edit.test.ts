import { describe, expect, it } from "vitest";
import { createDemoStore } from "../src/server/store.js";

describe("invalid edit contract", () => {
  it("rejects missing objects with a stable structured error", async () => {
    const store = createDemoStore();

    await expect(
      store.applyEdit({
        projectId: "project-player",
        objectId: "go-missing",
        componentId: "cmp-main-camera-transform",
        property: "m_LocalPosition.x",
        value: 4,
        expectedRevision: 1
      })
    ).rejects.toMatchObject({
      code: "OBJECT_NOT_FOUND",
      statusCode: 404
    });
  });

  it("rejects stale revisions instead of silently merging", async () => {
    const store = createDemoStore();

    await expect(
      store.applyEdit({
        projectId: "project-player",
        objectId: "go-main-camera",
        componentId: "cmp-main-camera-transform",
        property: "m_LocalPosition.x",
        value: 4,
        expectedRevision: 0
      })
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", statusCode: 409 });
  });

  it("rejects edits that omit the connected project id", async () => {
    const store = createDemoStore();

    await expect(
      store.applyEdit({
        projectId: "project-other",
        objectId: "go-main-camera",
        componentId: "cmp-main-camera-transform",
        property: "m_LocalPosition.x",
        value: 4,
        expectedRevision: 1
      })
    ).rejects.toMatchObject({ code: "PROJECT_MISMATCH", statusCode: 409 });
  });
});
