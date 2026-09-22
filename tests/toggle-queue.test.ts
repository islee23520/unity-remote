import { describe, expect, it, vi } from "vitest";
import { createToggleQueue } from "../src/web/toggleQueue.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("toggle queue", () => {
  it("executes overlapping tasks for the same object sequentially in submission order", async () => {
    const queue = createToggleQueue();
    const first = deferred<string>();
    const started = deferred<void>();
    const order: string[] = [];

    const firstResult = queue.enqueue("camera", async () => {
      order.push("first:start");
      started.resolve();
      const value = await first.promise;
      order.push("first:end");
      return value;
    });
    const secondTask = vi.fn(async () => {
      order.push("second:start");
      return "second";
    });
    const secondResult = queue.enqueue("camera", secondTask);

    await started.promise;
    expect(order).toEqual(["first:start"]);
    expect(secondTask).not.toHaveBeenCalled();

    first.resolve("first");
    await expect(firstResult).resolves.toBe("first");
    await expect(secondResult).resolves.toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("allows tasks for different objects to interleave", async () => {
    const queue = createToggleQueue();
    const camera = deferred<string>();
    const lightTask = vi.fn(async () => "light");

    const cameraResult = queue.enqueue("camera", () => camera.promise);
    const lightResult = queue.enqueue("light", lightTask);

    await expect(lightResult).resolves.toBe("light");
    expect(lightTask).toHaveBeenCalledOnce();
    camera.resolve("camera");
    await expect(cameraResult).resolves.toBe("camera");
  });

  it("continues the chain after a task fails", async () => {
    const queue = createToggleQueue();
    const failed = queue.enqueue("camera", async () => {
      throw new Error("failed");
    });
    const recovered = queue.enqueue("camera", async () => "recovered");

    await expect(failed).rejects.toThrow("failed");
    await expect(recovered).resolves.toBe("recovered");
  });

  it("resolves each enqueue with that task's result", async () => {
    const queue = createToggleQueue();

    await expect(queue.enqueue("camera", async () => ({ active: false }))).resolves.toEqual({ active: false });
    await expect(queue.enqueue("camera", async () => 7)).resolves.toBe(7);
  });
});
