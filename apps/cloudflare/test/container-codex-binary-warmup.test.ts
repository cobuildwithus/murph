import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { warmHostedContainerCodexBinary } from "../src/container-codex-binary-warmup.js";

// The fake app-server records what it was started with, then either answers
// `initialize` or stalls, and never exits on its own: the warmup must kill it.
type FakeBehavior = "answer" | "exit" | "stall";

interface FakeRecord {
  config: string;
  cwd: string;
  envKeys: string[];
  pid: number;
}

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(path.join(tmpdir(), "codex-warmup-test-"));
});

afterEach(async () => {
  await rm(testRoot, { force: true, recursive: true });
});

async function writeFakeCodex(behavior: FakeBehavior): Promise<{
  command: string;
  recordPath: string;
}> {
  const recordPath = path.join(testRoot, "record.json");
  const command = path.join(testRoot, "fake-codex.mjs");
  await writeFile(command, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({
  config: readFileSync(path.join(process.env.CODEX_HOME, "config.toml"), "utf8"),
  cwd: process.cwd(),
  envKeys: Object.keys(process.env).sort(),
  pid: process.pid,
}));
const behavior = ${JSON.stringify(behavior)};
if (behavior === "exit") process.exit(3);
setInterval(() => {}, 1000);
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (behavior === "answer" && buffer.includes("\\n")) {
    const request = JSON.parse(buffer.split("\\n")[0]);
    process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n");
  }
});
`);
  await chmod(command, 0o755);
  return { command, recordPath };
}

async function readRecord(recordPath: string): Promise<FakeRecord> {
  return JSON.parse(await readFile(recordPath, "utf8")) as FakeRecord;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(target: string): Promise<boolean> {
  return await stat(target).then(() => true, () => false);
}

const executablePath = [path.dirname(process.execPath), process.env.PATH ?? ""].join(":");

describe("warmHostedContainerCodexBinary", () => {
  it("answers ready after initialize, then kills the process and removes its scratch home", async () => {
    const fake = await writeFakeCodex("answer");

    const result = await warmHostedContainerCodexBinary({
      codexCommand: fake.command,
      executablePath,
      modelCatalogJsonPath: "/usr/local/share/murph/catalog.json",
      signal: new AbortController().signal,
    });

    expect(result.outcome).toBe("ready");
    const record = await readRecord(fake.recordPath);
    expect(isProcessAlive(record.pid)).toBe(false);
    expect(await pathExists(record.cwd)).toBe(false);
    // Scratch-only environment: nothing from the supervisor process leaks in.
    // (macOS adds __CF_USER_TEXT_ENCODING to every process.)
    expect(record.envKeys.filter((key) => !key.startsWith("__CF_")))
      .toEqual(["CODEX_HOME", "HOME", "PATH", "TMPDIR"]);
    expect(record.config).toContain('model_catalog_json = "/usr/local/share/murph/catalog.json"');
    expect(record.config).toMatch(/\[analytics\]\nenabled = false/u);
    expect(record.config).toContain("check_for_update_on_startup = false");
  });

  it("times out a stalled app-server and kills it", async () => {
    const fake = await writeFakeCodex("stall");

    const result = await warmHostedContainerCodexBinary({
      codexCommand: fake.command,
      executablePath,
      modelCatalogJsonPath: "/catalog.json",
      signal: new AbortController().signal,
      timeoutMs: 300,
    });

    expect(result.outcome).toBe("timed_out");
    const record = await readRecord(fake.recordPath);
    expect(isProcessAlive(record.pid)).toBe(false);
  });

  it("stops when the container shutdown signal aborts", async () => {
    const fake = await writeFakeCodex("stall");
    const controller = new AbortController();

    const pending = warmHostedContainerCodexBinary({
      codexCommand: fake.command,
      executablePath,
      modelCatalogJsonPath: "/catalog.json",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);

    expect((await pending).outcome).toBe("aborted");
    const record = await readRecord(fake.recordPath);
    expect(isProcessAlive(record.pid)).toBe(false);
  });

  it("does not start anything once shutdown has begun", async () => {
    const fake = await writeFakeCodex("answer");
    const controller = new AbortController();
    controller.abort();

    const result = await warmHostedContainerCodexBinary({
      codexCommand: fake.command,
      executablePath,
      modelCatalogJsonPath: "/catalog.json",
      signal: controller.signal,
    });

    expect(result.outcome).toBe("aborted");
    expect(await pathExists(fake.recordPath)).toBe(false);
  });

  it("reports failure without throwing for an early exit or a missing binary", async () => {
    const fake = await writeFakeCodex("exit");

    await expect(warmHostedContainerCodexBinary({
      codexCommand: fake.command,
      executablePath,
      modelCatalogJsonPath: "/catalog.json",
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ outcome: "failed" });
    await expect(warmHostedContainerCodexBinary({
      codexCommand: path.join(testRoot, "missing-codex"),
      executablePath,
      modelCatalogJsonPath: "/catalog.json",
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ outcome: "failed" });
  });
});
