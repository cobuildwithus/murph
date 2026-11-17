// Draws one frame of every shape a recap can take and lays them out on contact sheets, for looking at beside the app.
//   pnpm --dir packages/recap-video proof <directory>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCanvas, type Canvas } from "@napi-rs/canvas";

import { createRecapVideoRenderer, RecapVideoRefusal } from "../src/index.js";
import { applyText } from "../src/surface.js";
import { writeFixture } from "../test/fixture.js";
import { SHAPES } from "../test/shapes.js";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: proof <directory>");
await mkdir(path.join(directory, "frames"), { recursive: true });
const base = await writeFixture(path.join(directory, "fixture"));

const drawn: { name: string; frame: Canvas }[] = [], left: string[] = [];
for (const shape of SHAPES) {
  try {
    const renderer = await createRecapVideoRenderer(shape.build(base));
    const entry = renderer.timeline.entries.find(found => found.page.id === shape.page || (shape.page === "result" && found.kind === "poster"));
    if (!entry) throw new Error(`${shape.name} has no page ${shape.page}.`);
    const frame = createCanvas(renderer.width, renderer.height);
    frame.getContext("2d").drawImage(renderer.drawFrame(entry.fromMs + (shape.atMs ?? Math.min(4600, entry.toMs - entry.fromMs - 40))), 0, 0);
    await writeFile(path.join(directory, "frames", `${shape.name}.png`), frame.toBuffer("image/png"));
    drawn.push({ name: shape.name, frame });
  } catch (error) {
    if (!(error instanceof RecapVideoRefusal)) throw error;
    left.push(`${shape.name}: refused (${error.code}) ${error.message}`);
  }
}

// Contact sheets: eight frames to a sheet, each under its shape's name.
const columns = 4, rows = 2, cell = { width: 402, height: 874 }, label = 34, gap = 16;
for (let from = 0, sheet = 1; from < drawn.length; from += columns * rows, sheet++) {
  const canvas = createCanvas(gap + columns * (cell.width + gap), gap + rows * (cell.height + label + gap)), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2A2622";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  drawn.slice(from, from + columns * rows).forEach((shape, at) => {
    const x = gap + (at % columns) * (cell.width + gap), y = gap + Math.floor(at / columns) * (cell.height + label + gap);
    applyText(ctx, { font: "mono", size: 15, lineHeight: 20, color: "#FFFCF6" });
    ctx.fillText(shape.name, x, y + 22);
    ctx.drawImage(shape.frame, x, y + label, cell.width, cell.height);
  });
  await writeFile(path.join(directory, `shapes-${sheet}.jpg`), canvas.toBuffer("image/jpeg", 90));
}
await writeFile(path.join(directory, "shapes.txt"), [`${drawn.length} shapes drawn:`, ...drawn.map(shape => `  ${shape.name}`), "", `${left.length} left out:`, ...left.map(line => `  ${line}`), ""].join("\n"));
console.log(`${drawn.length} shapes drawn, ${left.length} left out. See ${path.join(directory, "shapes.txt")}.`);
