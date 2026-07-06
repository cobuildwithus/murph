import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build, type Metafile } from "esbuild";

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
// Baselines measured from the real assembled bundle on 2026-07-06: total
// 8,201,281B across 34 chunks, entry container-entrypoint.js 2,288,516B.
//
// The entry chunk gates cold-start parse, so it is ratcheted, not given
// headroom: the guard holds it to the measured baseline plus a tight noise
// band. Any growth past baseline + tolerance fails the assembly, so weight
// can only land on the boot path as a reviewed edit to the baseline constant
// below. When an increase is intentional, set the baseline to the measured
// value the failure prints and say why in the same change.
//
// The total ceiling stays a fixed backstop at its prior 9,300,000B value (not
// ratcheted): #397 shrank the bundle, so there is no reason to loosen it, and
// dynamic (non-boot) chunk jitter should not force a baseline bump. Ratchet it
// too if total creep becomes the concern. Investigate the listed largest
// inputs before raising either.
const RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET = 9_300_000;
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES = 2_288_516;
// Noise band above the baseline before the ratchet trips (~2%): absorbs
// content-hash and minifier jitter without letting real boot-path weight land
// silently. Keep it tight; it is a tolerance for noise, not feature headroom.
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES = 48_000;
const RUNNER_ENTRYPOINT_FORBIDDEN_BOOT_INPUT_MARKERS = [
  "node_modules/grammy/",
  "node_modules/node-fetch/",
  "node_modules/@murphai/inboxd/dist/connectors/hosted-conversation.js",
  "node_modules/@murphai/inboxd/dist/connectors/telegram/connector.js",
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
    `runner entrypoint bundle size: entry ${bundleBytes.entryBytes}B (baseline ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES}B + ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES}B tolerance), total ${bundleBytes.totalBytes}B of ${RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET}B budget`,
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

// Single source of truth for the production budgets: the entry chunk is the
// ratcheted baseline plus its noise tolerance, the total is the fixed ceiling.
// Exported so a unit test can lock these values (the assembly path calls
// assertRunnerEntrypointBundleWithinBudgets with this as the default).
export function resolveRunnerEntrypointBundleBudgets(): {
  entryBytes: number;
  totalBytes: number;
} {
  return {
    entryBytes:
      RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES
      + RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES,
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
  budgets: { entryBytes: number; totalBytes: number }
    = resolveRunnerEntrypointBundleBudgets(),
): { entryBytes: number; totalBytes: number } {
  const outputs = Object.entries(metafile.outputs);
  const totalBytes = outputs.reduce((sum, [, output]) => sum + output.bytes, 0);

  const entryPath = findRunnerEntrypointBundleEntryOutputPath(metafile);
  const entryBytes = metafile.outputs[entryPath]?.bytes;
  if (entryBytes === undefined) {
    throw new Error(
      `runner entrypoint bundle metafile is missing output ${entryPath}; cannot enforce the entry-chunk byte budget.`,
    );
  }
  assertRunnerEntrypointBundleBootInputsAllowed(metafile, entryPath);

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
  if (violations.length === 0) {
    return { entryBytes, totalBytes };
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
  entryPath: string,
): void {
  const bootOutputPaths = collectStaticRunnerEntrypointOutputPaths(metafile, entryPath);
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
      ) {
        forbiddenInputs.add(inputPath);
      }
    }
  }

  if (forbiddenInputs.size > 0) {
    throw new Error(
      [
        "runner entrypoint bundle includes provider connector inputs in the static boot closure.",
        "Move these imports behind a per-turn dynamic import:",
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
      const importedOutputPath = resolveMetafileOutputImportPath(
        outputPath,
        imported.path,
      );
      if (importedOutputPath in metafile.outputs) {
        pending.push(importedOutputPath);
      }
    }
  }

  return outputPaths;
}

function resolveMetafileOutputImportPath(
  importerOutputPath: string,
  importedPath: string,
): string {
  const normalizedImportedPath = normalizeMetafilePath(importedPath);
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
