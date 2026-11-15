import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { RecapVideoChildRequest, RecapVideoChildResult } from "../src/index.js";
import { writeFixture } from "./fixture.js";

// The runner starts the child as its own process, in a new group, and reads one JSON line from it.
const CHILD = fileURLToPath(new URL("../src/child.ts", import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
if (process.env.RECAP_VIDEO_REQUIRE_FFMPEG && !hasFfmpeg) throw new Error("This lane proves the encode and found no ffmpeg.");

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function request(change: (request: RecapVideoChildRequest) => RecapVideoChildRequest = value => value) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recap-video-child-"));
  directories.push(directory);
  const { extras: _extras, ...input } = await writeFixture(directory);
  const value = change({ input, outPath: path.join(directory, "recap.mp4"), deadlineMs: 170_000 });
  const requestPath = path.join(directory, "request.json");
  await writeFile(requestPath, JSON.stringify(value));
  return { requestPath, outPath: value.outPath };
}

function start(requestPath: string): { child: ChildProcess; closed: Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> } {
  const child = spawn(process.execPath, ["--import", "tsx", CHILD, requestPath], { detached: true, stdio: ["pipe", "pipe", "ignore"] });
  let output = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>(resolve => {
    child.once("close", (code, signal) => resolve({ code, signal, output }));
  });
  return { child, closed };
}

/** Whether anything in the group still runs. A killed process whose parent is gone waits as a zombie for
 * PID 1 to reap it; in the runner image tini does, but under a bare `docker run` this test is PID 1 and
 * never will, so zombies count as stopped. */
const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== "linux") return true;
  return readdirSync("/proc").filter(name => /^\d+$/u.test(name)).some(name => {
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return Number(fields[2]) === pid && fields[0] !== "Z";
    } catch {
      return false;
    }
  });
};

async function waitFor(file: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await access(file).then(() => true, () => false)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("The encoder never started.");
}

describe("the render child", () => {
  it("answers a show it will not draw with the refusal, before any encoder starts", async () => {
    const { requestPath, outPath } = await request(value => ({ ...value, input: { ...value.input, stake: { kind: "punishment", title: "" } } }));
    const { closed } = start(requestPath);
    const { code, output } = await closed;
    expect(code).toBe(0);
    const result = JSON.parse(output.trim()) as RecapVideoChildResult;
    expect(result).toEqual({ ok: false, code: "unsupported_stake" });
    await expect(access(outPath)).rejects.toThrow();
  });

  it.skipIf(!hasFfmpeg)("renders the show as one file and reports what it cost", async () => {
    const { requestPath, outPath } = await request();
    const started = performance.now();
    const { closed } = start(requestPath);
    const { code, output } = await closed;
    const wallMs = performance.now() - started;
    expect(code).toBe(0);
    const result = JSON.parse(output.trim()) as RecapVideoChildResult;
    if (!result.ok) throw new Error(`Refused: ${result.code}`);
    expect(result.bytes).toBe((await stat(outPath)).size);
    expect(result.bytes).toBeLessThanOrEqual(8_000_000);
    // The cost, where the runner pays it. The runner-image lane prints this at the runner's two CPUs.
    console.info(JSON.stringify({ recapVideoChild: { wallSeconds: Number((wallMs / 1000).toFixed(1)), megabytes: Number((result.bytes / 1e6).toFixed(2)),
      encoderPeakMegabytes: result.encoder ? Math.round(result.encoder.maxRssBytes / 1e6) : null, cpus: os.availableParallelism() } }));
  }, 240_000);

  it.skipIf(!hasFfmpeg)("stops itself and its encoder when the runner goes away", async () => {
    const { requestPath, outPath } = await request();
    const { child, closed } = start(requestPath);
    await waitFor(outPath, 60_000);
    // The runner's end of the pipe closes, as it does when the runner dies.
    child.stdin!.end();
    const { signal } = await closed;
    expect(signal).toBe("SIGKILL");
    expect(groupAlive(child.pid!)).toBe(false);
    // Nobody is left to clean up after it: the request, the inputs and the partial video are gone too.
    await expect(access(path.dirname(requestPath))).rejects.toThrow();
  }, 120_000);

  it.skipIf(!hasFfmpeg)("stops itself and its encoder at its own deadline", async () => {
    const { requestPath } = await request(value => ({ ...value, deadlineMs: 1500 }));
    const { child, closed } = start(requestPath);
    const { signal } = await closed;
    expect(signal).toBe("SIGKILL");
    expect(groupAlive(child.pid!)).toBe(false);
  }, 60_000);
});
