// Renders the synthetic fixture and prints what it cost.
//   pnpm --dir packages/recap-video measure [out.mp4] [--preset=veryfast]
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRecapVideoRenderer, encodeRecapVideo } from "../src/index.js";
import { writeFixture } from "../test/fixture.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1];
const directory = await mkdtemp(path.join(os.tmpdir(), "recap-video-measure-"));
const kept = args.find(arg => !arg.startsWith("--"));
const out = kept ?? path.join(directory, "recap.mp4");
try {
  const started = performance.now();
  const input = await writeFixture(directory);
  const renderer = await createRecapVideoRenderer(input);
  const laidOut = performance.now();
  const result = await encodeRecapVideo(renderer, input.score, out, { preset: flag("preset") });
  const finished = performance.now(), usage = process.resourceUsage();
  // Node reports its peak resident size in kilobytes.
  const peak = usage.maxRSS * 1024;
  console.log(JSON.stringify({
    machine: `${os.cpus()[0]?.model ?? "unknown"}, ${os.availableParallelism()} threads, ${os.platform()} ${os.arch()}`,
    videoSeconds: renderer.timeline.durationMs / 1000,
    frames: result.frames,
    megabytes: Number((result.bytes / 1e6).toFixed(2)),
    wallSeconds: Number(((finished - started) / 1000).toFixed(2)),
    layoutSeconds: Number(((laidOut - started) / 1000).toFixed(2)),
    drawSeconds: Number((result.drawMs / 1000).toFixed(2)),
    drawProcess: { cpuSeconds: Number(((usage.userCPUTime + usage.systemCPUTime) / 1e6).toFixed(2)), peakMegabytes: Math.round(peak / 1e6) },
    encoder: result.encoder && { cpuSeconds: Number((result.encoder.userSeconds + result.encoder.systemSeconds).toFixed(2)), peakMegabytes: Math.round(result.encoder.maxRssBytes / 1e6) },
    out: kept ?? "(removed)",
  }, null, 2));
} finally {
  // The fixture's pictures and music go either way; a video asked for by name is somewhere else.
  await rm(directory, { recursive: true, force: true });
}
