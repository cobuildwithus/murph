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
// The entry budget is baseline + ~25% headroom (it gates cold-start parse).
// The total ceiling is held at its prior 9,300,000B value: this change shrank
// the bundle, so there is no reason to loosen the regression guard.
// Investigate the listed largest inputs before raising either.
const RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET = 9_300_000;
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BYTES_BUDGET = 2_900_000;
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
  const bundleBytes = assertRunnerEntrypointBundleWithinBudgets(
    buildResult.metafile,
  );
  console.log(
    `runner entrypoint bundle size: total ${bundleBytes.totalBytes}B of ${RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET}B budget, entry ${bundleBytes.entryBytes}B of ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BYTES_BUDGET}B budget`,
  );
  assertRunnerEntrypointBundleBoots({ bundleDir, bundleOutDir });
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
  budgets: { entryBytes: number; totalBytes: number } = {
    entryBytes: RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BYTES_BUDGET,
    totalBytes: RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET,
  },
): { entryBytes: number; totalBytes: number } {
  const outputs = Object.entries(metafile.outputs);
  const totalBytes = outputs.reduce((sum, [, output]) => sum + output.bytes, 0);

  // With code splitting, esbuild stamps `entryPoint` on dynamic-import
  // chunks too; the real entry output keeps the entry file's plain name
  // while shared and dynamic chunks carry content-hash suffixes.
  const entryOutput = outputs.find(
    ([outputPath, output]) =>
      output.entryPoint !== undefined
      && path.basename(outputPath) === "container-entrypoint.js",
  );
  if (!entryOutput) {
    throw new Error(
      "runner entrypoint bundle metafile has no container-entrypoint.js entry-point output; cannot enforce the entry-chunk byte budget.",
    );
  }
  const [entryPath, { bytes: entryBytes }] = entryOutput;
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
      "Investigate the largest metafile inputs below before raising the budget (see baseline comment on the budget constants):",
      ...largestInputs,
    ].join("\n"),
  );
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

function collectStaticRunnerEntrypointOutputPaths(
  metafile: Metafile,
  entryPath: string,
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
      if (imported.kind === "dynamic-import") {
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
}): void {
  const bundledEntryPath = path.join(
    input.bundleOutDir,
    "container-entrypoint.js",
  );
  // The entry path travels via env, not argv: with it in argv[1] the module's
  // own main-entrypoint guard would match during the probe import and start
  // the container HTTP server on the assembling machine.
  const probeSource = [
    "const entry = await import(process.env.RUNNER_ENTRYPOINT_BUNDLE_PROBE_PATH);",
    "if (typeof entry.startHostedContainerEntrypoint !== 'function') {",
    "  console.error('bundled container entrypoint is missing startHostedContainerEntrypoint');",
    "  process.exit(3);",
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
