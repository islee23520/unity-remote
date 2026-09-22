import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/server/app.js";
import { createDemoStore } from "../src/server/store.js";
import { runCli } from "../src/cli/index.js";

const AUTH_TOKEN = "cli-token";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout: { write(chunk: string) { stdout.push(chunk); }, text: () => stdout.join("") },
    stderr: { write(chunk: string) { stderr.push(chunk); }, text: () => stderr.join("") }
  };
}

describe("CLI", () => {
  let app: FastifyInstance | undefined;
  let broker: string;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  async function startBroker(): Promise<void> {
    app = createApp(createDemoStore(), { authToken: AUTH_TOKEN });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    broker = `http://127.0.0.1:${port}`;
  }

  it("reads project state from the broker and requires an explicit project for mutations", async () => {
    await startBroker();
    const projectIo = capture();
    const projectCode = await runCli(
      ["node", "unity-remote", "--broker", broker, "--token", AUTH_TOKEN, "project"],
      projectIo
    );
    expect(projectCode).toBe(0);
    expect(JSON.parse(projectIo.stdout.text()).project.id).toBe("project-player");

    const missingProject = capture();
    const missingCode = await runCli(
      [
        "node",
        "unity-remote",
        "--broker",
        broker,
        "--token",
        AUTH_TOKEN,
        "edit",
        "--object",
        "go-main-camera",
        "--component-id",
        "cmp-main-camera-transform",
        "--property",
        "m_LocalPosition.x",
        "--value",
        "4",
        "--expect-revision",
        "1"
      ],
      missingProject
    );
    expect(missingCode).toBe(2);
    expect(JSON.parse(missingProject.stderr.text()).error.code).toBe("INVALID_REQUEST");

    const previewIo = capture();
    const previewCode = await runCli(
      [
        "node",
        "unity-remote",
        "--broker",
        broker,
        "--token",
        AUTH_TOKEN,
        "edit",
        "--project",
        "project-player",
        "--object",
        "go-main-camera",
        "--component-id",
        "cmp-main-camera-transform",
        "--property",
        "m_LocalPosition.x",
        "--value",
        "4",
        "--expect-revision",
        "1"
      ],
      previewIo
    );
    expect(previewCode).toBe(0);
    expect(JSON.parse(previewIo.stdout.text()).preview).toBe(true);

    const applyIo = capture();
    const applyCode = await runCli(
      [
        "node",
        "unity-remote",
        "--broker",
        broker,
        "--token",
        AUTH_TOKEN,
        "edit",
        "--project",
        "project-player",
        "--object",
        "go-missing",
        "--component-id",
        "cmp-main-camera-transform",
        "--property",
        "m_LocalPosition.x",
        "--value",
        "4",
        "--expect-revision",
        "1",
        "--apply"
      ],
      applyIo
    );
    expect(applyCode).toBe(2);
    expect(JSON.parse(applyIo.stderr.text()).error.code).toBe("OBJECT_NOT_FOUND");
  });

  it("reports Play Mode as unavailable against the demo broker for read, enter, and exit", async () => {
    await startBroker();
    for (const args of [[], ["--enter"], ["--exit"]]) {
      const io = capture();
      const code = await runCli(
        ["node", "unity-remote", "--broker", broker, "--token", AUTH_TOKEN, "play", ...args],
        io
      );
      expect(code).not.toBe(0);
      expect(JSON.parse(io.stderr.text()).error.code).toBe("DISCONNECTED");
      expect(io.stdout.text()).toBe("");
    }
  });

  it("reports Game View as unavailable against the demo broker", async () => {
    await startBroker();
    const io = capture();
    const code = await runCli(
      ["node", "unity-remote", "--broker", broker, "--token", AUTH_TOKEN, "game-view"],
      io
    );
    expect(code).not.toBe(0);
    expect(io.stdout.text()).toBe("");
    expect(JSON.parse(io.stderr.text()).error.code).toBe("DISCONNECTED");
    expect(JSON.parse(io.stderr.text()).error.message).toBe("Game View requires a connected Unity Editor.");
  });

  it("reports input as unavailable against the demo broker", async () => {
    await startBroker();
    const io = capture();
    const code = await runCli(
      ["node", "unity-remote", "--broker", broker, "--token", AUTH_TOKEN, "input", "--type", "keyDown", "--key", "w"],
      io
    );
    expect(code).not.toBe(0);
    expect(io.stdout.text()).toBe("");
    expect(JSON.parse(io.stderr.text()).error.code).toBe("DISCONNECTED");
    expect(JSON.parse(io.stderr.text()).error.message).toBe("Input requires a connected Unity Editor.");
  });

  it("refuses a play command that asks to enter and exit at the same time", async () => {
    const io = capture();
    const code = await runCli(["node", "unity-remote", "--token", AUTH_TOKEN, "play", "--enter", "--exit"], io);
    expect(code).toBe(2);
    expect(JSON.parse(io.stderr.text()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects revision tokens that are not whole nonnegative integers", async () => {
    const io = capture();
    const code = await runCli(
      [
        "node",
        "unity-remote",
        "--token",
        AUTH_TOKEN,
        "edit",
        "--project",
        "project-player",
        "--object",
        "go-main-camera",
        "--component-id",
        "cmp-main-camera-transform",
        "--property",
        "m_LocalPosition.x",
        "--value",
        "4",
        "--expect-revision",
        "1oops"
      ],
      io
    );
    expect(code).toBe(2);
    expect(JSON.parse(io.stderr.text()).error.code).toBe("INVALID_REVISION");
  });
});
