import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build, type Metafile } from "esbuild";
import {
  MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV,
} from "@murphai/health-commons/runtime";

import {
  RUNNER_BUNDLE_SHARED_EXTERNALS,
  RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS,
} from "./bundle-shared.js";

// The unbundled container entrypoint evaluates ~960 module files at boot
// (~900 of them under node_modules). In production those land on lazily
// pulled Cloudflare image layers, which made module loading the dominant
// slice of cold-start nodeStartupMs (~2s measured 2026-06-12; V8 parse alone
// is ~0.3s on warm files — see the NODE_COMPILE_CACHE falsification notes in
// the cold-start exec history). Bundling collapses boot to a couple dozen
// chunk reads. The Dockerfile CMD runs this bundled entry; the unbundled
// `dist/` tree stays in the image for the worker artifact and diagnostics.
// The entrypoint graph never reaches the ink/react UI stack, but the shared
// guard markers keep that true.

// Top-level so chunk import.meta.url resolves two levels below the bundle
// root: engine code that derives a package root from its module location
// (e.g. vault-cli PATH candidates) keeps landing on `<bundle>/node_modules`.
export const RUNNER_ENTRYPOINT_BUNDLE_DIRECTORY_NAME = "dist-bundled";

// Byte budgets over the esbuild metafile so import-graph creep in the boot
// surface fails the assembly instead of silently regressing cold start.
// Latest ratcheted baselines come from reviewed bundle measurements:
// - entry container-entrypoint.js: 1,423,217B on CI Linux after the
//   2026-07-13 mainline integration;
// - static boot closure: 7,059,427B on CI Linux for the exact PR 608 head
//   after the generic group newsletter reader and native-memory isolation.
//   The forbidden-input guard below keeps clinical intake and other
//   turn-scoped importer code out of this closure.
// The tolerances below cover local emit jitter.
//
// The entry chunk gates cold-start parse, so its measured baseline stays
// explicit. The guard combines the original emit-jitter tolerance with a
// deliberate operational headroom allowance; growth past that combined cap
// still fails assembly, and the fixed total-bundle ceiling remains a separate
// backstop.
//
// Node parses the entry chunk plus every statically reachable chunk before
// HTTP listen, so the static boot closure is ratcheted with the same reviewed
// baseline discipline as the entry chunk. Its tolerance is wider than the
// entry tolerance because the closure spans ~5x more bytes and many more
// chunks, so path comments, content hashes, and platform-specific emit jitter
// have more surface.
//
// PR #813's reviewed route-authority boundary, after merging current main,
// measured 9,314,428B on CI Linux and 9,364,555B on local macOS. Ratchet the
// fixed total backstop to the exact larger measurement; dynamic chunk jitter
// still receives no extra margin or platform-specific branch. PR #824's full
// Epic query/admission expansion plus that mainline integration measures
// 9,371,132B on local macOS, 6,577B over the newer mainline ceiling; advance
// only by that exact combined-graph overage.
const RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET = 9_371_132;
// The exact PR #626 head after current-main exact-target reply handling adds
// reviewed boot-critical batching recovery logic. Assembly measured
// 1,486,467B on CI Linux (+699B over the prior budget) and 1,493,474B on local
// macOS (+7,706B); advance only by the larger entry overage and preserve the
// noise band. PR #678 then added 633B for runtime-owned approval-link delivery.
// Post-delivery foreground release, mutation-scoped maintenance,
// and indexed cron reconciliation on that merged base measure 1,497,825B on
// local macOS, 4,351B over the resulting budget. Advance by that exact overage;
// the review remediation deletes foreground terminal-evidence inspection and
// leaves exact replyability policy with maintenance. Preserving the merged
// base's precomputed boundary-tail retry added 233B; making the phase wake
// authoritative across the complete local tail drain removes 179B. Explicit
// invocation-local wake provenance adds 230B while preventing an inherited
// reminder from suppressing pending-index repair.
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES = 1_450_742;
// PR #631 added 913B for its reviewed Clinical Records crypto-lane labels and
// another 872B for bounded checkpoint/resume handling. The exact PR #626 head
// then measured a 7,190,569B local macOS closure (+33,357B over the prior
// budget); advance only by that measured overage and preserve the separate
// 96KB noise band.
// On that merged base, indexed cron search, purpose-correlated artifact reads,
// foreground cancellation, and delayed index repair measure a 7,192,498B local
// static boot closure, 1,929B over the resulting budget. Advance by that exact
// overage; boundary-tail retry preservation added the same measured 233B, and
// complete-tail wake ownership later removes 179B. Explicit invocation-local
// wake provenance adds 230B. Preserve the separate 96KB noise band.
// The July 16 main merge (through PR #772) measured a 7,467,190B local macOS
// closure; through the July 17 merges (Epic clinical records beta, onboarding
// clarifiers, four-child hosted concurrency) it grew to ~7,489,000B local.
// Rather than keep ratcheting this baseline by a few KB per merge on a
// fast-moving shared main — which broke local dev:reset repeatedly because
// local macOS runs ~40 KB heavier than the CI Linux measurement — use a round
// 7.5 MB baseline. The variance tolerance and operational allowance below
// provide the headroom. This intentionally loosens the boot-surface creep
// guard; the forbidden-input markers below and fixed 9.3 MB total ceiling
// remain the hard backstops. Re-tighten to a measured value if boot-closure
// creep needs active policing again.
const RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_BASELINE_BYTES = 7_500_000;
// Preserve the original emit-jitter bands and add one shared operational
// allowance to both coupled boot-path caps. The static closure contains the
// entry chunk, so applying the headroom to only one cap would be misleading.
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES = 48_000;
const RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_TOLERANCE_BYTES = 96_000;
const RUNNER_ENTRYPOINT_BUNDLE_OPERATIONAL_HEADROOM_BYTES = 250_000;
// The @murphai package markers are path suffixes, not node_modules-anchored:
// workspace package inputs appear as `node_modules/@murphai/*/dist/...` in
// the staged production assembly but as `packages/*/dist/...` when bundling
// straight from the repo checkout, and the guard must bite in both shapes.
const RUNNER_ENTRYPOINT_FORBIDDEN_BOOT_INPUT_MARKERS = [
  "node_modules/grammy/",
  "node_modules/node-fetch/",
  "/inboxd/dist/connectors/hosted-conversation.js",
  "/inboxd/dist/connectors/telegram/connector.js",
  "/device-syncd/dist/service.js",
  "/device-syncd/dist/registry.js",
  "/device-syncd/dist/providers/",
  "/importers/dist/",
  "/clinical-records/dist/",
  "node_modules/@junction-api/sdk/",
  "/health-metrics/dist/murph-age.js",
  "/health-metrics/dist/murph-age-source-routes.js",
  "/query/dist/murph-age.js",
  "/query/dist/browser-replica/murph-age.js",
] as const;

const RUNNER_ENTRYPOINT_ALLOWED_BOOT_INPUT_MARKERS = [
  "/clinical-records/dist/retrieval-limits.js",
] as const;

export async function bundleRunnerContainerEntrypoint(
  bundleDir: string,
): Promise<void> {
  const entryPath = path.join(bundleDir, "dist", "container-entrypoint.js");
  await access(entryPath);

  const bundleOutDir = path.join(
    bundleDir,
    RUNNER_ENTRYPOINT_BUNDLE_DIRECTORY_NAME,
  );
  await rm(bundleOutDir, { force: true, recursive: true });

  const buildResult = await build({
    banner: {
      js: "import { createRequire as __runnerEntrypointCreateRequire } from 'node:module'; const require = __runnerEntrypointCreateRequire(import.meta.url);",
    },
    bundle: true,
    entryPoints: [entryPath],
    external: [...RUNNER_BUNDLE_SHARED_EXTERNALS],
    format: "esm",
    logLevel: "error",
    metafile: true,
    outdir: bundleOutDir,
    platform: "node",
    splitting: true,
    tsconfigRaw: "{}",
  });
  assertRunnerEntrypointBundleInputsStayExternal(
    Object.keys(buildResult.metafile.inputs),
  );
  const entryOutputPath = findRunnerEntrypointBundleEntryOutputPath(
    buildResult.metafile,
  );
  const bundleBytes = assertRunnerEntrypointBundleWithinBudgets(
    buildResult.metafile,
  );
  console.log(
    `runner entrypoint bundle size: entry ${bundleBytes.entryBytes}B (baseline ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES}B + ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES}B tolerance + ${RUNNER_ENTRYPOINT_BUNDLE_OPERATIONAL_HEADROOM_BYTES}B headroom), static boot closure ${bundleBytes.staticClosureBytes}B (baseline ${RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_BASELINE_BYTES}B + ${RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_TOLERANCE_BYTES}B tolerance + ${RUNNER_ENTRYPOINT_BUNDLE_OPERATIONAL_HEADROOM_BYTES}B headroom), total ${bundleBytes.totalBytes}B of ${RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET}B budget`,
  );
  assertRunnerEntrypointBundleBoots({
    bundleDir,
    bundleOutDir,
    lazyChunkOutputPaths: [...collectLazyRunnerEntrypointOutputPaths(
      buildResult.metafile,
      entryOutputPath,
    )],
  });
}

// Single source of truth for the production budgets: both boot-path caps use
// their ratcheted baseline, emit-jitter tolerance, and shared operational
// headroom; the total remains a fixed ceiling.
// Exported so a unit test can lock these values (the assembly path calls
// assertRunnerEntrypointBundleWithinBudgets with this as the default).
export function resolveRunnerEntrypointBundleBudgets(): {
  entryBytes: number;
  staticClosureBytes: number;
  totalBytes: number;
} {
  return {
    entryBytes:
      RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES
      + RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES
      + RUNNER_ENTRYPOINT_BUNDLE_OPERATIONAL_HEADROOM_BYTES,
    staticClosureBytes:
      RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_BASELINE_BYTES
      + RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_TOLERANCE_BYTES
      + RUNNER_ENTRYPOINT_BUNDLE_OPERATIONAL_HEADROOM_BYTES,
    totalBytes: RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET,
  };
}

function assertRunnerEntrypointBundleInputsStayExternal(
  inputPaths: string[],
): void {
  for (const inputPath of inputPaths) {
    for (const marker of RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS) {
      if (inputPath.includes(`node_modules${marker}`)) {
        throw new Error(
          `runner entrypoint bundle inlined ${inputPath}; keep ${marker.slice(1, -1)} external so the runtime resolves the installed copy.`,
        );
      }
    }
  }
}

// Exported for direct unit testing with synthetic metafiles; the production
// call site always uses the default budgets above.
export function assertRunnerEntrypointBundleWithinBudgets(
  metafile: Metafile,
  budgets: { entryBytes: number; staticClosureBytes: number; totalBytes: number }
    = resolveRunnerEntrypointBundleBudgets(),
): { entryBytes: number; staticClosureBytes: number; totalBytes: number } {
  const outputs = Object.entries(metafile.outputs);
  const totalBytes = outputs.reduce((sum, [, output]) => sum + output.bytes, 0);

  const entryPath = findRunnerEntrypointBundleEntryOutputPath(metafile);
  const entryBytes = metafile.outputs[entryPath]?.bytes;
  if (entryBytes === undefined) {
    throw new Error(
      `runner entrypoint bundle metafile is missing output ${entryPath}; cannot enforce the entry-chunk byte budget.`,
    );
  }
  const staticBootOutputPaths = collectStaticRunnerEntrypointOutputPaths(
    metafile,
    entryPath,
  );
  const staticClosureBytes = [...staticBootOutputPaths].reduce(
    (sum, outputPath) => sum + (metafile.outputs[outputPath]?.bytes ?? 0),
    0,
  );
  assertRunnerEntrypointBundleBootInputsAllowed(
    metafile,
    staticBootOutputPaths,
  );

  const violations: string[] = [];
  if (totalBytes > budgets.totalBytes) {
    violations.push(
      `total output ${totalBytes}B exceeds budget ${budgets.totalBytes}B`,
    );
  }
  if (entryBytes > budgets.entryBytes) {
    violations.push(
      `entry chunk ${entryPath} ${entryBytes}B exceeds budget ${budgets.entryBytes}B`,
    );
  }
  if (staticClosureBytes > budgets.staticClosureBytes) {
    violations.push(
      `static boot closure ${staticClosureBytes}B exceeds budget ${budgets.staticClosureBytes}B`,
    );
  }
  if (violations.length === 0) {
    return { entryBytes, staticClosureBytes, totalBytes };
  }

  const largestInputs = Object.entries(metafile.inputs)
    .sort(([, left], [, right]) => right.bytes - left.bytes)
    .slice(0, 10)
    .map(([inputPath, input]) => `  ${input.bytes}B ${inputPath}`);

  throw new Error(
    [
      `runner entrypoint bundle exceeded its byte budget: ${violations.join("; ")}.`,
      "Investigate the largest metafile inputs below. If the growth is intended, update the matching baseline/budget constant to the measured value in the same change (see the baseline comment on the budget constants):",
      ...largestInputs,
    ].join("\n"),
  );
}

function findRunnerEntrypointBundleEntryOutputPath(metafile: Metafile): string {
  // With code splitting, esbuild stamps `entryPoint` on dynamic-import
  // chunks too; the real entry output keeps the entry file's plain name
  // while shared and dynamic chunks carry content-hash suffixes.
  const entryOutput = Object.entries(metafile.outputs).find(
    ([outputPath, output]) =>
      output.entryPoint !== undefined
      && path.basename(outputPath) === "container-entrypoint.js",
  );
  if (!entryOutput) {
    throw new Error(
      "runner entrypoint bundle metafile has no container-entrypoint.js entry-point output; cannot enforce the entry-chunk byte budget.",
    );
  }
  return entryOutput[0];
}

function assertRunnerEntrypointBundleBootInputsAllowed(
  metafile: Metafile,
  bootOutputPaths: Set<string>,
): void {
  const forbiddenInputs = new Set<string>();

  for (const outputPath of bootOutputPaths) {
    const output = metafile.outputs[outputPath];
    if (!output) {
      continue;
    }
    for (const inputPath of Object.keys(output.inputs)) {
      const normalizedInputPath = normalizeMetafilePath(inputPath);
      if (
        RUNNER_ENTRYPOINT_FORBIDDEN_BOOT_INPUT_MARKERS.some((marker) =>
          normalizedInputPath.includes(marker)
        )
        && !RUNNER_ENTRYPOINT_ALLOWED_BOOT_INPUT_MARKERS.some((marker) =>
          normalizedInputPath.includes(marker)
        )
      ) {
        forbiddenInputs.add(inputPath);
      }
    }
  }

  if (forbiddenInputs.size > 0) {
    throw new Error(
      [
        "runner entrypoint bundle includes forbidden inputs in the static boot closure.",
        "Move these imports behind a per-turn dynamic import or a narrow package subpath:",
        ...[...forbiddenInputs].sort().map((inputPath) => `  ${inputPath}`),
      ].join("\n"),
    );
  }
}

type MetafileOutputImport = Metafile["outputs"][string]["imports"][number];

function collectStaticRunnerEntrypointOutputPaths(
  metafile: Metafile,
  entryPath: string,
): Set<string> {
  return collectRunnerEntrypointOutputPaths(
    metafile,
    entryPath,
    (imported) => imported.kind !== "dynamic-import",
  );
}

export function collectLazyRunnerEntrypointOutputPaths(
  metafile: Metafile,
  entryPath: string,
): Set<string> {
  const staticOutputPaths = collectStaticRunnerEntrypointOutputPaths(
    metafile,
    entryPath,
  );
  const outputPaths = collectRunnerEntrypointOutputPaths(
    metafile,
    entryPath,
    () => true,
  );

  for (const outputPath of staticOutputPaths) {
    outputPaths.delete(outputPath);
  }

  return outputPaths;
}

function collectRunnerEntrypointOutputPaths(
  metafile: Metafile,
  entryPath: string,
  shouldFollowImport: (imported: MetafileOutputImport) => boolean,
): Set<string> {
  const outputPaths = new Set<string>();
  const pending = [normalizeMetafilePath(entryPath)];

  while (pending.length > 0) {
    const outputPath = pending.pop();
    if (!outputPath || outputPaths.has(outputPath)) {
      continue;
    }
    outputPaths.add(outputPath);

    const output = metafile.outputs[outputPath];
    if (!output) {
      continue;
    }
    for (const imported of output.imports) {
      if (!shouldFollowImport(imported)) {
        continue;
      }
      const importedOutputPath = resolveMetafileOutputImportPath({
        importedPath: imported.path,
        importerOutputPath: outputPath,
        outputPaths: metafile.outputs,
      });
      if (importedOutputPath in metafile.outputs) {
        pending.push(importedOutputPath);
      }
    }
  }

  return outputPaths;
}

function resolveMetafileOutputImportPath(input: {
  importedPath: string;
  importerOutputPath: string;
  outputPaths: Metafile["outputs"];
}): string {
  const { importedPath, importerOutputPath, outputPaths } = input;
  const normalizedImportedPath = normalizeMetafilePath(importedPath);
  if (normalizedImportedPath in outputPaths) {
    return normalizedImportedPath;
  }
  if (!normalizedImportedPath.startsWith(".")) {
    return normalizedImportedPath;
  }
  return normalizeMetafilePath(
    path.join(path.dirname(importerOutputPath), normalizedImportedPath),
  );
}

function normalizeMetafilePath(inputPath: string): string {
  return inputPath.replaceAll("\\", "/");
}

// Boot probe on the real assembled artifact: importing the bundled entry must
// evaluate the full module graph (resolving every external from the staged
// node_modules) and expose the supervisor entry function. This catches
// unresolved externals and module-scope crashes at assembly time instead of
// at the first production cold start.
function assertRunnerEntrypointBundleBoots(input: {
  bundleDir: string;
  bundleOutDir: string;
  lazyChunkOutputPaths: string[];
}): void {
  const bundledEntryPath = path.join(
    input.bundleOutDir,
    "container-entrypoint.js",
  );
  const lazyChunks = input.lazyChunkOutputPaths.map((outputPath) => {
    const filePath = path.resolve(outputPath.split("/").join(path.sep));
    const relativePath = path.relative(input.bundleOutDir, filePath);
    return {
      path: relativePath.startsWith("..") || path.isAbsolute(relativePath)
        ? normalizeMetafilePath(outputPath)
        : normalizeMetafilePath(relativePath),
      url: pathToFileURL(filePath).href,
    };
  });
  // The entry path travels via env, not argv: with it in argv[1] the module's
  // own main-entrypoint guard would match during the probe import and start
  // the container HTTP server on the assembling machine. Lazy chunk paths use
  // the same env channel so the probe still has no bundle target in argv.
  const probeSource = [
    "const entry = await import(process.env.RUNNER_ENTRYPOINT_BUNDLE_PROBE_PATH);",
    "if (typeof entry.startHostedContainerEntrypoint !== 'function') {",
    "  console.error('bundled container entrypoint is missing startHostedContainerEntrypoint');",
    "  process.exit(3);",
    "}",
    "const lazyChunks = JSON.parse(process.env.RUNNER_ENTRYPOINT_BUNDLE_PROBE_LAZY_CHUNKS ?? '[]');",
    "for (const chunk of lazyChunks) {",
    "  try {",
    "    await import(chunk.url);",
    "  } catch (error) {",
    "    console.error(`bundled lazy chunk failed to evaluate: ${chunk.path}`);",
    "    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));",
    "    process.exit(4);",
    "  }",
    "}",
    "process.exit(0);",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", probeSource],
    {
      cwd: input.bundleDir,
      encoding: "utf8",
      env: {
        ...process.env,
        [MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]: path.join(
          input.bundleDir,
          "node_modules",
          "@murphai",
          "health-commons",
        ),
        RUNNER_ENTRYPOINT_BUNDLE_PROBE_PATH: pathToFileURL(bundledEntryPath).href,
        RUNNER_ENTRYPOINT_BUNDLE_PROBE_LAZY_CHUNKS: JSON.stringify(lazyChunks),
      },
      timeout: 60_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [
        `runner entrypoint bundle boot probe failed with status ${result.status ?? "unknown"}.`,
        `stderr head: ${(result.stderr ?? "").slice(0, 600)}`,
      ].join("\n"),
    );
  }
}
