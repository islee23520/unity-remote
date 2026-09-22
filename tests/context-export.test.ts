import { describe, expect, it } from "vitest";
import { createDemoStore } from "../src/server/store.js";

describe("AI context export contract", () => {
  it("exports the same project, hierarchy, and inspected object contract used by the web client", async () => {
    const store = createDemoStore();
    const context = await store.createContext(["go-main-camera"]);
    const snapshot = await store.getProjectSnapshot();

    expect(context.kind).toBe("unity-project-context");
    expect(context.project).toEqual(snapshot.project);
    expect(context.scenes).toEqual(snapshot.scenes);
    expect(context.hierarchy).toEqual(snapshot.hierarchy);
    expect(context.objects).toEqual([await store.inspectObject("go-main-camera")]);
    expect(() => JSON.parse(JSON.stringify(context))).not.toThrow();
  });
});
