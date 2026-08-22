import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import React from "react";

type OgImageRouteModule = {
  default?: (input?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
};

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "../app");

export async function renderOgImageRoute(input: {
  outputPath: string;
  params?: Record<string, string>;
  routePath: string;
}): Promise<{ bytes: number; height: number; width: number }> {
  const routePath = resolveRoutePath(input.routePath);
  // The repository preserves JSX and tsx may use the classic transform for a
  // dynamically imported route. Supply React before evaluating its renderer.
  Object.assign(globalThis, { React });
  const routeModule = await import(`${pathToFileURL(routePath).href}?render=${Date.now()}`) as OgImageRouteModule;
  if (typeof routeModule.default !== "function") {
    throw new Error(`OG image route has no default renderer: ${routePath}`);
  }
  const response = await routeModule.default({ params: Promise.resolve(input.params ?? {}) });
  if (!(response instanceof Response) || !response.ok) {
    throw new Error(`OG image renderer returned ${response instanceof Response ? response.status : "a non-Response value"}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const dimensions = readPngDimensions(bytes);
  if (dimensions.width !== 1200 || dimensions.height !== 630) {
    throw new Error(`OG image must be a 1200x630 PNG; received ${dimensions.width}x${dimensions.height}.`);
  }
  const outputPath = path.resolve(input.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes, { mode: 0o600 });
  return { bytes: bytes.length, ...dimensions };
}

function resolveRoutePath(routePathInput: string): string {
  const candidate = path.resolve(routePathInput);
  const routePath = path.basename(candidate) === "opengraph-image.tsx"
    ? candidate
    : path.join(candidate, "opengraph-image.tsx");
  const relative = path.relative(appRoot, routePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("OG image route must be inside apps/web/app.");
  }
  return routePath;
}

function readPngDimensions(bytes: Buffer): { height: number; width: number } {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("OG image renderer did not return a PNG.");
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  if (cliArgs[0] === "--") cliArgs.shift();
  const [routePath, outputPath, paramsJson] = cliArgs;
  if (!routePath || !outputPath) {
    console.error("Usage: pnpm --dir apps/web og-assets:render -- <route-dir-or-file> <out.png> [params-json]");
    process.exitCode = 1;
  } else {
    let params: Record<string, string> | undefined;
    try {
      params = paramsJson ? JSON.parse(paramsJson) as Record<string, string> : undefined;
      const result = await renderOgImageRoute({ outputPath, params, routePath });
      console.log(`Rendered ${result.width}x${result.height} OG image (${result.bytes} bytes) to ${path.resolve(outputPath)}.`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  void main();
}
