// Writes single frames of the synthetic fixture as PNGs, for looking at pages beside the app.
//   pnpm --dir packages/recap-video frames <directory> <ms,ms,...>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createRecapVideoRenderer } from "../src/index.js";
import { writeFixture } from "../test/fixture.js";

const [directory, times] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
if (!directory || !times) throw new Error("Usage: frames <directory> <ms,ms,...>");
await mkdir(directory, { recursive: true });
const input = await writeFixture(path.join(directory, "fixture"));
const renderer = await createRecapVideoRenderer(input);
for (const ms of times.split(",").map(Number)) {
  const file = path.join(directory, `frame-${String(ms).padStart(5, "0")}.png`);
  await writeFile(file, renderer.drawFrame(ms).toBuffer("image/png"));
  console.log(file, JSON.stringify(renderer.frameState(ms)));
}
