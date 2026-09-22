#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const projectPath = process.cwd();
const resultsPath = join(projectPath, ".omo/evidence/unity-editmode-results.xml");
const logPath = join(projectPath, ".omo/evidence/unity-editmode.log");

function findEditor() {
  if (process.env.UNITY_EDITOR && existsSync(process.env.UNITY_EDITOR)) {
    return process.env.UNITY_EDITOR;
  }
  const hub = "/Applications/Unity/Hub/Editor";
  if (!existsSync(hub)) {
    return undefined;
  }
  const versions = readdirSync(hub).sort().reverse();
  for (const version of versions) {
    const candidate = join(hub, version, "Unity.app/Contents/MacOS/Unity");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const editor = findEditor();
if (!editor) {
  console.error("Unity Editor not found. Set UNITY_EDITOR to the Unity executable.");
  process.exit(2);
}

mkdirSync(join(projectPath, ".omo/evidence"), { recursive: true });
try {
  unlinkSync(resultsPath);
} catch {
  // no previous results
}
const result = spawnSync(
  editor,
  [
    "-batchmode",
    "-nographics",
    "-projectPath",
    projectPath,
    "-runTests",
    "-testPlatform",
    "EditMode",
    "-assemblyNames",
    "Islee.UnityRemote.Editor.Tests",
    "-testResults",
    resultsPath,
    "-logFile",
    logPath
  ],
  { stdio: "inherit" }
);

if (!existsSync(resultsPath)) {
  console.error(`Unity produced no test results at ${resultsPath}`);
  process.exit(result.status === 0 ? 1 : result.status ?? 1);
}

const xml = readFileSync(resultsPath, "utf8");
const total = Number((xml.match(/\btotal="(\d+)"/) ?? [])[1] ?? 0);
const passed = Number((xml.match(/\bpassed="(\d+)"/) ?? [])[1] ?? 0);
const failed = Number((xml.match(/\bfailed="(\d+)"/) ?? [])[1] ?? 0);
if (total < 1) {
  console.error("Unity EditMode reported zero tests.");
  process.exit(1);
}
if (failed > 0 || passed !== total || result.status !== 0) {
  console.error(`Unity EditMode failed: ${passed}/${total} passed, ${failed} failed.`);
  process.exit(1);
}
console.log(`Unity EditMode passed: ${passed}/${total}`);
