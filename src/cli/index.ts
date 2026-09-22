#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { UnityRemoteError } from "../server/errors.js";
import { createBrokerClient, type BrokerClient } from "./client.js";

export type CliIo = {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  client?: BrokerClient;
};

const writeJson = (io: CliIo, value: unknown): void => {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

function parseExpectedRevision(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new UnityRemoteError("INVALID_REVISION", "--expect-revision must be a nonnegative integer.", 400);
  }
  return Number(raw);
}

function createProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name("unity-remote")
    .description("Inspect Unity projects, apply constrained scene edits, and export AI context.")
    .version("0.1.0")
    .option("--broker <url>", "Local broker URL", process.env.UNITY_REMOTE_BROKER ?? "http://127.0.0.1:4173")
    .option("--token <token>", "Broker session token", process.env.UNITY_REMOTE_TOKEN)
    .option("--token-file <path>", "File containing the broker session token", ".unity-remote-token")
    .showHelpAfterError(false)
    .configureOutput({
      writeOut: (chunk) => io.stdout.write(chunk),
      writeErr: () => undefined
    })
    .exitOverride();

  const clientOf = (command: Command): BrokerClient => {
    if (io.client) {
      return io.client;
    }
    const globals = command.optsWithGlobals() as { broker?: string; token?: string; tokenFile?: string };
    const options: { broker?: string; token?: string; tokenFile?: string } = {};
    if (globals.broker) options.broker = globals.broker;
    if (globals.token) options.token = globals.token;
    if (globals.tokenFile) options.tokenFile = globals.tokenFile;
    return createBrokerClient(options);
  };

  program
    .command("project")
    .description("Print the connected project, scenes, and hierarchy as JSON.")
    .action(async (_opts, command: Command) => writeJson(io, await clientOf(command).project()));

  program
    .command("inspect")
    .description("Inspect one GameObject as JSON.")
    .argument("<object-id>")
    .option("--project <id>", "Connected project id")
    .action(async (objectId: string, opts: { project?: string }, command: Command) =>
      writeJson(io, await clientOf(command).inspect(objectId, opts.project))
    );

  program
    .command("edit")
    .description("Preview or apply one constrained property edit. Pass --apply to mutate.")
    .requiredOption("--project <id>", "Connected project id")
    .requiredOption("--object <id>")
    .requiredOption("--component-id <id>", "Stable component id from inspect")
    .requiredOption("--property <path>", "Serialized property path")
    .requiredOption("--value <json>")
    .requiredOption("--expect-revision <number>")
    .option("--apply", "Apply the mutation after the preview contract is satisfied", false)
    .action(async (options: Record<string, string | boolean>, command: Command) => {
      const expectedRevision = parseExpectedRevision(String(options.expectRevision ?? ""));
      let value: unknown;
      try {
        value = JSON.parse(String(options.value ?? ""));
      } catch {
        throw new UnityRemoteError("INVALID_VALUE", "--value must contain valid JSON.", 400);
      }
      const payload = {
        projectId: String(options.project ?? ""),
        objectId: String(options.object ?? ""),
        componentId: String(options.componentId ?? ""),
        property: String(options.property ?? ""),
        value,
        expectedRevision
      };
      const client = clientOf(command);
      if (!options.apply) {
        writeJson(io, await client.preview(payload));
        return;
      }
      writeJson(io, await client.edit(payload));
    });

  program
    .command("save")
    .description("Save one dirty scene without applying a new mutation.")
    .requiredOption("--project <id>", "Connected project id")
    .requiredOption("--scene <id>", "Scene id")
    .action(async (options: { project: string; scene: string }, command: Command) =>
      writeJson(io, await clientOf(command).save({ projectId: options.project, sceneId: options.scene }))
    );

  program
    .command("context")
    .description("Export AI-ready project context as JSON.")
    .option("--project <id>", "Connected project id")
    .option("--objects <ids>", "Comma-separated GameObject IDs", "")
    .action(async (options: { project?: string; objects: string }, command: Command) => {
      const objectIds = options.objects.split(",").map((item) => item.trim()).filter(Boolean);
      writeJson(io, await clientOf(command).context({ projectId: options.project, objectIds }));
    });

  program
    .command("play")
    .description("Print Unity Play Mode state, or enter and exit Play Mode.")
    .option("--enter", "Enter Play Mode", false)
    .option("--exit", "Exit Play Mode", false)
    .action(async (options: { enter?: boolean; exit?: boolean }, command: Command) => {
      if (options.enter && options.exit) {
        throw new UnityRemoteError("INVALID_REQUEST", "Pass either --enter or --exit, not both.", 400);
      }
      const client = clientOf(command);
      if (!options.enter && !options.exit) {
        writeJson(io, await client.play());
        return;
      }
      writeJson(io, await client.setPlayMode(options.enter === true));
    });

  program
    .command("game-view")
    .description("Print the latest Unity Game View JPEG frame as JSON.")
    .action(async (_opts, command: Command) => writeJson(io, await clientOf(command).gameView()));

  program
    .command("input")
    .description("Send one keyboard or mouse event into the Unity Game View.")
    .requiredOption("--type <type>", "keyDown, keyUp, mouseMove, mouseDown, or mouseUp")
    .option("--key <key>", "DOM KeyboardEvent.key for keyDown/keyUp")
    .option("--button <n>", "Mouse button 0-2")
    .option("--x <n>", "Normalized Game View X in 0-1")
    .option("--y <n>", "Normalized Game View Y in 0-1")
    .action(async (options: { type: string; key?: string; button?: string; x?: string; y?: string }, command: Command) => {
      const payload: Record<string, unknown> = { type: options.type };
      if (options.key !== undefined) payload.key = options.key;
      if (options.button !== undefined) {
        if (!/^\d+$/.test(options.button)) {
          throw new UnityRemoteError("INVALID_REQUEST", "--button must be an integer 0-2.", 400);
        }
        payload.button = Number(options.button);
      }
      if (options.x !== undefined) {
        const x = Number(options.x);
        if (!Number.isFinite(x)) {
          throw new UnityRemoteError("INVALID_REQUEST", "--x must be a number.", 400);
        }
        payload.x = x;
      }
      if (options.y !== undefined) {
        const y = Number(options.y);
        if (!Number.isFinite(y)) {
          throw new UnityRemoteError("INVALID_REQUEST", "--y must be a number.", 400);
        }
        payload.y = y;
      }
      writeJson(io, await clientOf(command).sendInput(payload));
    });

  program.alias("unityctx");
  return program;
}

export async function runCli(argv: string[] = process.argv, io: CliIo = process): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return 0;
    }
    if (error instanceof UnityRemoteError) {
      io.stderr.write(`${JSON.stringify(error.toJSON(), null, 2)}\n`);
      return error.statusCode >= 500 ? 1 : 2;
    }
    if (error instanceof CommanderError) {
      io.stderr.write(
        `${JSON.stringify({ error: { code: "INVALID_REQUEST", message: error.message, details: { code: error.code } } }, null, 2)}\n`
      );
      return 2;
    }
    io.stderr.write(
      `${JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", details: {} } }, null, 2)}\n`
    );
    return 1;
  }
}

const invoked = (process.argv[1] ?? "").replaceAll("\\", "/");
if (/(?:^|\/)(cli\/index\.(?:ts|js)|unity-remote|unityctx)$/.test(invoked)) {
  process.exitCode = await runCli(process.argv);
}
