import { execFile } from "node:child_process";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PHASE_PRODUCTION_BUILD } from "next/constants";

import {
  MURPH_VITEST_TEMP_MARKER,
  MURPH_VITEST_TEMP_PREFIX,
  resolveMurphTestTempBaseDirectory,
} from "../../../config/vitest-temp-lifecycle";
import { resolveHostedWebDistDir } from "../next-artifacts";
import { assertUnhashedOgImageRoutes } from "./check-og-route-manifest";

/**
 * Post-build proof that OG images still render from the *emitted* serverless
 * function, in the filesystem layout it is deployed into.
 *
 * The production incident this guards against was invisible to source-level
 * tests: the bundler inlined the build machine's absolute asset paths, so the
 * deployed function read paths that did not exist and every dynamic OG request
 * returned 500. Asserting file names appear in a `.nft.json` manifest does not
 * catch that, because the manifest can be correct while the bundled code looks
 * somewhere else entirely.
 *
 * So this check materializes a route's traced closure into a temporary
 * repo-root-shaped directory, makes the build checkout unreadable to the child
 * process, runs the emitted bundle with the temporary directory as its working
 * directory, and requires a real 1200x630 PNG plus proof that every brand-asset
 * read landed inside the materialized function.
 */

const execFileAsync = promisify(execFile);

type ProbeRoute = {
  /** Path under the dist directory, as the emitted function is laid out. */
  entry: string;
  expectedHeight: number;
  expectedWidth: number;
  params: Record<string, string>;
  url: string;
};

type ProbeResult = {
  bytes: number;
  contentType: string | null;
  entry: string;
  expectedHeight: number;
  expectedWidth: number;
  height: number;
  status: number;
  width: number;
};

type ProbeOutput = {
  blocked: string[];
  reads: string[];
  results: ProbeResult[];
};

// Two routes whose combined asset reads cover every export of app/font-files.ts.
// The invite unfurl is the route that failed in production: it is dynamic, has
// no static params, and therefore renders on demand in the deployed function.
const probeRoutes: ProbeRoute[] = [
  {
    entry: "server/app/join/[inviteCode]/opengraph-image/route.js",
    expectedHeight: 630,
    expectedWidth: 1200,
    params: { inviteCode: "invite-probe" },
    url: "http://localhost/join/invite-probe/opengraph-image",
  },
  // Adds Fraunces-400, which the hero share frame does not use.
  {
    entry: "server/app/opengraph-image/route.js",
    expectedHeight: 630,
    expectedWidth: 1200,
    params: {},
    url: "http://localhost/opengraph-image",
  },
  // The three cards whose routes once lived inside the (dashboard) route
  // group, where metadata images get hash-suffixed URLs that 404 the exact
  // URL pages advertise. Pinning the unhashed emitted entries makes any
  // return of the suffix fail the build instead of shipping broken previews.
  {
    entry: "server/app/connect/opengraph-image/route.js",
    expectedHeight: 630,
    expectedWidth: 1200,
    params: {},
    url: "http://localhost/connect/opengraph-image",
  },
  {
    entry: "server/app/biomarkers/[biomarkerId]/opengraph-image/route.js",
    expectedHeight: 630,
    expectedWidth: 1200,
    params: { biomarkerId: "biomarker-probe" },
    url: "http://localhost/biomarkers/biomarker-probe/opengraph-image",
  },
  {
    entry: "server/app/experiments/[experimentId]/opengraph-image/route.js",
    expectedHeight: 630,
    expectedWidth: 1200,
    params: { experimentId: "experiment-probe" },
    url: "http://localhost/experiments/experiment-probe/opengraph-image",
  },
  createIMessageCardProbe(),
];

const requiredAssetNames = [
  "logo.svg",
  "murph-mark.svg",
  "Fraunces-400.ttf",
  "Fraunces-600.ttf",
  "DMSans-400.ttf",
  "DMSans-600.ttf",
] as const;

// Emitted into the temporary root rather than committed next to this file:
// the child must run without reading anything out of the build checkout, and
// the repository does not allow committed .cjs sources under apps/. Assertions
// live in the parent; the child only invokes and reports.
const probeSource = `"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const [, , tempRoot, blockedRoot, routesJson] = process.argv;
const routes = JSON.parse(routesJson);
const reads = [];
const blocked = [];

function isBlocked(target) {
  if (typeof target !== "string") return false;
  const resolved = path.resolve(target);
  return resolved === blockedRoot || resolved.startsWith(blockedRoot + path.sep);
}

function record(target) {
  if (typeof target !== "string") return;
  reads.push(target);
  if (isBlocked(target)) blocked.push(target);
}

function unavailable(target) {
  const error = new Error(
    "ENOENT: the build checkout is unavailable to the relocated function, open '" + target + "'",
  );
  error.code = "ENOENT";
  return error;
}

const realExistsSync = fs.existsSync;
fs.existsSync = (target) => {
  record(target);
  return isBlocked(target) ? false : realExistsSync(target);
};
const realReadFileSync = fs.readFileSync;
fs.readFileSync = (target, ...rest) => {
  record(target);
  if (isBlocked(target)) throw unavailable(target);
  return realReadFileSync(target, ...rest);
};
const realReadFile = fsp.readFile;
fsp.readFile = async (target, ...rest) => {
  record(target);
  if (isBlocked(target)) throw unavailable(target);
  return await realReadFile(target, ...rest);
};

function readPngSize(buffer) {
  const isPng = buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (!isPng) return { height: 0, width: 0 };
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) };
}

async function main() {
  const results = [];
  for (const route of routes) {
    const emitted = require(path.join(tempRoot, route.entry));
    const userland = await Promise.resolve(emitted.routeModule._lazyUserland.load());
    const response = await userland.GET(new Request(route.url), {
      params: Promise.resolve(route.params),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    results.push({
      bytes: buffer.length,
      contentType: response.headers.get("content-type"),
      entry: route.entry,
      expectedHeight: route.expectedHeight,
      expectedWidth: route.expectedWidth,
      status: response.status,
      ...readPngSize(buffer),
    });
  }
  process.stdout.write(JSON.stringify({ blocked, reads, results }));
}

main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error));
  process.exit(1);
});
`;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDirectory = path.join(appRoot, "app");
const repoRoot = path.resolve(appRoot, "../..");
const distDirName = resolveHostedWebDistDir(PHASE_PRODUCTION_BUILD);
const distDir = path.join(appRoot, distDirName);

if (!existsSync(distDir)) {
  throw new Error(
    `Cannot check the emitted OG runtime because apps/web/${distDirName} does not exist. Run next build first.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const appPathRoutesManifestPath = path.join(distDir, "app-path-routes-manifest.json");
  if (!existsSync(appPathRoutesManifestPath)) {
    throw new Error(`Next build output is missing ${appPathRoutesManifestPath}.`);
  }
  const appPathRoutesManifest = JSON.parse(
    await readFile(appPathRoutesManifestPath, "utf8"),
  ) as Record<string, string>;
  assertUnhashedOgImageRoutes(appDirectory, appPathRoutesManifest);

  const temporaryRoot = await createMarkedTemporaryRoot();
  try {
    for (const route of probeRoutes) {
      await materializeTracedFunction(path.join(distDir, route.entry), temporaryRoot);
    }

    assertDeployedAssetLayout(temporaryRoot);

    const probePath = path.join(temporaryRoot, "og-emitted-runtime-probe.cjs");
    await writeFile(probePath, probeSource, { encoding: "utf8", mode: 0o600 });

    const relocatedRoutes = probeRoutes.map((route) => ({
      entry: path.join(path.relative(repoRoot, distDir), route.entry),
      expectedHeight: route.expectedHeight,
      expectedWidth: route.expectedWidth,
      params: route.params,
      url: route.url,
    }));

    const probe = await execFileAsync(
      process.execPath,
      [
        probePath,
        realpathSync(temporaryRoot),
        realpathSync(repoRoot),
        JSON.stringify(relocatedRoutes),
      ],
      {
        cwd: temporaryRoot,
        env: { NODE_ENV: "production", PATH: process.env.PATH ?? "" },
        maxBuffer: 8 * 1024 * 1024,
      },
    ).catch((error: unknown) => {
      throw new Error([
        "The emitted OG route failed to render from its relocated serverless layout.",
        "This is the production failure mode: the bundle could not reach an asset outside the deployed function.",
        String((error as { stderr?: string })?.stderr ?? error),
      ].join("\n"));
    });

    assertProbeOutput(JSON.parse(probe.stdout) as ProbeOutput, realpathSync(temporaryRoot));
    console.log(
      `Rendered ${probeRoutes.length} emitted OG routes from a relocated function directory with the build checkout unavailable.`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

/**
 * The deployed function's root holds the repository layout, so brand assets sit
 * under `apps/web/`, never at the root. A route that resolved an asset as
 * `join(process.cwd(), "public", ...)` therefore read a path that does not
 * exist in the function; every such caller must go through app/font-files.ts.
 */
function assertDeployedAssetLayout(relocatedRoot: string): void {
  const deployed = path.join(relocatedRoot, "apps/web/public/logo.svg");
  const deployedMark = path.join(
    relocatedRoot,
    "apps/web/public/icons/murph-mark.svg",
  );
  const workingDirectoryRelative = path.join(relocatedRoot, "public/logo.svg");

  if (!existsSync(deployed)) {
    throw new Error(
      `Expected the traced function to contain apps/web/public/logo.svg at ${deployed}.`,
    );
  }
  if (!existsSync(deployedMark)) {
    throw new Error(
      `Expected the traced function to contain apps/web/public/icons/murph-mark.svg at ${deployedMark}.`,
    );
  }
  if (existsSync(workingDirectoryRelative)) {
    throw new Error([
      "The relocated function unexpectedly holds public/logo.svg at its root.",
      "Asset resolution assumptions in app/font-files.ts need to be rechecked.",
    ].join("\n"));
  }
}

function assertProbeOutput(output: ProbeOutput, relocatedRoot: string): void {
  const failures: string[] = [];

  for (const result of output.results) {
    if (result.status !== 200) {
      failures.push(`${result.entry} responded ${result.status}, expected 200`);
    }
    if (!result.contentType?.startsWith("image/png")) {
      failures.push(`${result.entry} returned content-type ${result.contentType}, expected image/png`);
    }
    if (
      result.width !== result.expectedWidth
      || result.height !== result.expectedHeight
    ) {
      failures.push(
        `${result.entry} returned a ${result.width}x${result.height} image, expected ${result.expectedWidth}x${result.expectedHeight}`,
      );
    }
  }

  const assetReads = output.reads.filter((read) =>
    requiredAssetNames.some((asset) => read.endsWith(asset))
  );
  for (const asset of requiredAssetNames) {
    if (!assetReads.some((read) => read.endsWith(asset))) {
      failures.push(`no emitted route read ${asset}`);
    }
  }
  for (const read of assetReads) {
    if (!path.resolve(read).startsWith(relocatedRoot + path.sep)) {
      failures.push(`asset read escaped the relocated function: ${read}`);
    }
  }
  for (const attempt of output.blocked) {
    failures.push(`the emitted bundle reached back into the build checkout: ${attempt}`);
  }

  if (failures.length > 0) {
    throw new Error([
      "The emitted OG serverless function does not render from its deployed filesystem layout.",
      "Check app/font-files.ts path resolution and outputFileTracingIncludes in next.config.ts.",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"));
  }
}

function createIMessageCardProbe(): ProbeRoute {
  const card = {
    schemaVersion: 2,
    card: {
      kind: "daily_nutrition",
      version: 2,
      localDate: "2026-08-11",
      mealCount: 1,
      totals: {
        calories: { total: 700, mealCount: 1 },
        proteinGrams: { total: 35, mealCount: 1 },
        carbsGrams: { total: 80, mealCount: 1 },
        fatGrams: { total: 20, mealCount: 1 },
        fiberGrams: { total: 8, mealCount: 1 },
      },
      goals: {
        calories: null,
        proteinGrams: null,
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
      },
    },
  };
  const payload = `${Buffer.from(JSON.stringify(card)).toString("base64url")}.png`;
  return {
    entry: "server/app/imessage/card/v1/[payload]/route.js",
    expectedHeight: 539,
    expectedWidth: 1200,
    params: { payload },
    url: `http://localhost/imessage/card/v1/${payload}`,
  };
}

/**
 * Copies a route's emitted bundle plus every file in its `.nft.json` closure
 * into the temporary root, preserving each file's position relative to the
 * repository root. That is the shape the deployed function sees, so
 * `process.cwd()`-relative resolution is exercised exactly as it is in
 * production. Hard links keep this close to free; only cross-device targets
 * fall back to copying.
 */
async function materializeTracedFunction(
  routePath: string,
  temporaryRoot: string,
): Promise<void> {
  if (!existsSync(routePath)) {
    throw new Error([
      `Cannot find the emitted OG route ${path.relative(appRoot, routePath)}.`,
      "If the route moved, update probeRoutes in apps/web/scripts/check-og-emitted-runtime.ts.",
    ].join("\n"));
  }

  const trace = JSON.parse(await readFile(`${routePath}.nft.json`, "utf8")) as {
    files?: unknown;
  };
  const tracedFiles = Array.isArray(trace.files)
    ? trace.files.filter((file): file is string => typeof file === "string")
    : [];
  const routeDir = path.dirname(routePath);

  for (const source of [routePath, ...tracedFiles.map((file) => path.resolve(routeDir, file))]) {
    const destination = path.join(temporaryRoot, path.relative(repoRoot, source));
    if (existsSync(destination)) {
      continue;
    }
    await mkdir(path.dirname(destination), { recursive: true });

    const info = await lstat(source).catch(() => null);
    if (!info) {
      continue;
    }
    if (info.isSymbolicLink()) {
      // pnpm's store links are relative, so recreating them keeps the closure
      // self-contained instead of pointing back at the checkout.
      await symlink(await readlink(source), destination).catch(ignoreExisting);
      continue;
    }
    if (info.isDirectory()) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await link(source, destination).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        return;
      }
      await copyFile(source, destination);
    });
  }
}

/**
 * Uses the shared marked run root from `agent-docs/operations/local-storage-lifecycle.md`
 * so an interrupted run leaves a directory `scripts/cleanup-test-temp.ts` can
 * reap, rather than unmanaged top-level temp residue.
 */
async function createMarkedTemporaryRoot(): Promise<string> {
  const baseDirectory = resolveMurphTestTempBaseDirectory();
  await mkdir(baseDirectory, { recursive: true });
  const root = await mkdtemp(path.join(baseDirectory, MURPH_VITEST_TEMP_PREFIX));
  await writeFile(
    path.join(root, MURPH_VITEST_TEMP_MARKER),
    `${JSON.stringify({
      createdAt: new Date().toISOString(),
      ownerPid: process.pid,
      schemaVersion: 1,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return root;
}

function ignoreExisting(error: NodeJS.ErrnoException): void {
  if (error.code !== "EEXIST") {
    throw error;
  }
}
