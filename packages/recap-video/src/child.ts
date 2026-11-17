// One render, as a process of its own. The runner starts it with the path of a
// request file and reads one line of JSON from its output: what the video cost,
// or the refusal that means "no video". The runner starts it as the leader of a
// new process group, so stopping the group stops ffmpeg too. It also stops
// itself, and ffmpeg with it, when the runner goes away (its stdin closes) or
// its own deadline passes, so nothing it starts can outlive the turn that asked.
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { RecapVideoRefusal, type RecapVideoInput } from "./types.js";

export interface RecapVideoChildRequest {
  input: RecapVideoInput;
  outPath: string;
  deadlineMs: number;
}

export type RecapVideoChildResult =
  | { ok: true; bytes: number; frames: number; drawMs: number; encoder: { userSeconds: number; systemSeconds: number; maxRssBytes: number } | null }
  | { ok: false; code: string };

function stopGroup(): never {
  // The runner that would remove the work directory may be gone: the request, the photos and any partial video go first.
  const requestPath = process.argv[2];
  if (requestPath) {
    try {
      rmSync(path.dirname(requestPath), { recursive: true, force: true });
    } catch {
      // Removal is best effort; the runner's next render sweeps what is left.
    }
  }
  try {
    // Negative: the whole group, this process and the encoder it started.
    process.kill(-process.pid, "SIGKILL");
  } catch {
    // Not a group leader (started by hand): at least this process goes.
  }
  process.exit(1);
}

async function main(): Promise<RecapVideoChildResult> {
  const requestPath = process.argv[2];
  if (!requestPath) return { ok: false, code: "invalid_request" };
  const request = JSON.parse(await readFile(requestPath, "utf8")) as RecapVideoChildRequest;
  setTimeout(stopGroup, Math.max(1, request.deadlineMs)).unref();
  // Loaded after the deadline is armed: font registration and layout count against it too.
  const { createRecapVideoRenderer, encodeRecapVideo } = await import("./index.js");
  try {
    const renderer = await createRecapVideoRenderer(request.input);
    const result = await encodeRecapVideo(renderer, request.input.score, request.outPath);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof RecapVideoRefusal) return { ok: false, code: error.code };
    return { ok: false, code: "render_failed" };
  }
}

process.stdin.on("end", stopGroup);
process.stdin.on("close", stopGroup);
process.stdin.resume();
main().then(
  result => {
    process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
  },
  () => {
    process.stdout.write(`${JSON.stringify({ ok: false, code: "render_failed" })}\n`, () => process.exit(0));
  },
);
