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

// Byte budgets over the esbuild metafile make import-graph growth fail the
// assembly instead of silently regressing cold start. Entry and static-closure
// caps retain their platform-jitter tolerances.
//
// Static-closure baseline raised 2026-07-25 on main. The previous baseline left
// the packaged boot closure 735B under its cap, so the next small reviewed
// addition was guaranteed to fail assembly: adding provider-failure diagnosis to
// the voice memo tool measured 7,738,566B in CI. No module entered the boot graph
// for that change, so this is authored-code growth rather than an import
// regression. The baseline leaves roughly 128KB above that measurement so
// ordinary small additions do not re-red the lane. This deliberately widens the
// cold-start guard; keep the forbidden-boot-input markers below as the real
// defense against whole subsystems entering the boot path, and re-baseline down
// if a future prune reclaims the space.
//
// The total budget is expressed as the packaged measurement plus the established
// 32KB allowance for small reviewed additions. An exact measured ceiling was
// tried and reverted: it left zero slack, so an unrelated prompt change on main
// broke assembly. Do not restore the former 250KB operational growth allowance.
//
// Entry baseline raised 2026-07-25 for the hosted message-content retention
// owner. Its mailbox, pending-input, transcript, and inbox cleanup paths are
// intentionally reachable from idle maintenance. The entry measured 1,649,331B
// in CI; full local assembly measured 9,605,653B total and a 7,882,562B static
// closure. No forbidden subsystem entered the boot graph; the markers below
// remain the guard against that regression, while the existing tolerances cover
// ordinary small authored-code growth.
//
// The native iMessage response-card contract, tool, outbox, and transport paths
// measured 9,798,967B total on 2026-07-29. No forbidden subsystem entered the
// boot graph. The later combined measurements below supersede that total while
// retaining the response-card path in the reviewed graph.
//
// Direct/group turn parity, exact-message participant authorization, private
// media, hosted-alert integration, and open-ended experiment outcomes add
// authored code to existing runner chunks without adding a forbidden boot
// input. The combined 2026-07-29 macOS assembly measured an 8,117,894B static
// closure while remaining within the reviewed total budget.
//
// Direct Group subscription handling, Linq group-line recovery, and the
// rich-link retry-integrity guards extend the existing runner chunks without
// adding a forbidden boot input. The combined 2026-07-30 macOS assembly
// measured 9,979,011B. Ratchet the total baseline to that measurement and
// retain the established 32KB allowance.
//
// Private Environment voice processing reuses the existing hosted-runtime,
// parser, and vault paths, but keeps the capture-to-checkpoint handling in the
// static runner graph. CI measured an 8,196,760B static closure and macOS
// measured 9,894,078B total on 2026-07-30. After rebasing both changes together,
// the final macOS assembly measured 9,971,103B total and an 8,295,095B static
// closure. No forbidden subsystem entered the boot graph. Preserve that static
// measurement alongside main's higher cross-platform total measurement.
//
// Daily-nutrition response cards and the durable Linq app-card text fallback
// extend the existing assistant, hosted-runtime, and provider paths without
// adding a forbidden boot input. CI measured 10,020,882B total on 2026-07-31.
//
// Physical notes extend the existing dynamic-tool, hosted-runtime, and Web-port
// paths without adding a forbidden boot input. Linux CI measured 10,012,825B
// total on 2026-07-31.
//
// Deterministic reminder-availability refresh and foreground preemption extend
// the existing hosted-runtime chunk without adding a forbidden boot input.
// Linux CI measured 10,016,296B total on 2026-07-31.
//
// After merging the response-card path with physical notes, deterministic
// reminder refresh, and the checkpoint-first shutdown correction on current
// main, macOS assembly measured a 1,699,250B entry, 8,442,983B static
// closure, and 10,119,605B total on 2026-08-01. No forbidden subsystem
// entered the boot graph. Ratchet each baseline to the merged measurement and
// retain the established allowances.
//
// Source-aware deep- and REM-sleep group projections extend the existing
// vault-share projection path without adding a forbidden boot input. macOS
// assembly measured 10,159,653B total on 2026-08-04; retain the established
// allowance above that measured baseline.
//
// The hosted-local foreground-priority regression adds bounded test-only
// ordering observations to the runner entrypoint. After merging both changes,
// macOS assembly measured 10,186,925B total on 2026-08-05; retain the
// established allowance above that combined measured baseline.
//
// Compact-table response cards extend the existing response-card contract,
// transcript, and Linq delivery paths without adding a forbidden boot input.
// Linux CI measured an 8,540,082B static closure on 2026-08-05; retain the
// established allowance above that reviewed measurement.
//
// Current main combines the reviewed support, usage, provider-routing, and
// response-card additions. Protected Linux predeploy assembly measured
// 10,222,070B total, while two clean macOS packaged assemblies both measured
// 10,273,373B total on 2026-08-05. No forbidden subsystem entered the boot
// graph. Ratchet to the higher cross-platform measurement and retain the
// established reviewed-addition allowance.
//
// Restoring the disabled native-memory provider relay, diagnostics, and usage
// accounting extends those existing runner chunks without adding a forbidden
// boot input. Protected Linux predeploy assembly measured 10,222,098B total
// and macOS measured 10,273,401B total on 2026-08-06. Ratchet to the higher
// cross-platform measurement and retain the same allowance.
//
// Scheduled phone-call authority extends the existing Assistant Engine dynamic
// tool path without adding a forbidden boot input. After merging the native-
// memory relay restoration, macOS measured 10,276,559B total on 2026-08-06;
// retain the established allowance above that combined measurement.
//
// Dynamic-tool request parsing and execution are unnecessary before the first
// Codex tool call. Splitting that runtime from the provider-visible catalog
// reduced the static closure to 8,423,496B while keeping the full output at
// 10,298,233B. Ratchet the static baseline to that measured closure; the
// existing total ceiling already covers the small lazy-chunk boundary cost.
// The bounded @murphai/contracts/zod-runtime surface keeps Zod's required
// English error map while removing the 53-module locale catalog and unrelated
// namespace exports from production workspace imports. A clean macOS assembly
// measured a 1,729,632B entry, 8,182,922B static closure, and 9,862,735B total
// on 2026-08-06. Ratchet the static and total baselines to that implementation
// while retaining the established cross-platform tolerances.
//
// Lazy-loading the rare hosted wake handlers then removes their uncommon
// activation, notification, ask-completion, Environment voice, and Codex-auth
// paths from the static boot closure. After merging the Zod runtime change and
// current main, exact macOS assembly measured a 1,640,840B entry, 8,053,604B
// static closure, and 9,885,077B total on 2026-08-07. Ratchet both startup-path
// baselines while retaining the reviewed Zod total ceiling.
//
// Combining those startup reductions with the dynamic-tool runtime boundary
// measured a 1,641,254B entry, 7,885,509B static closure, and 9,902,746B total
// on 2026-08-07. Against the exact merged-main baseline, the boundary removes
// 168,095B from startup while adding 17,669B of lazy output. Ratchet all three
// measurements while retaining the established cross-platform tolerances.
//
// Replacing the deferred Junction provider's one generated SDK serializer with
// its five-field local predicate leaves entry and static startup bytes unchanged
// while reducing total lazy output to 9,851,385B. Ratchet the total ceiling to
// retain that removal without changing the startup tolerances.
//
// Adding the personalized generated contact card puts its request contract,
// exact-shape parser, direct route resolution, and acknowledgement handling in
// the runner's lazy output. Exact ubuntu assembly measured a 9,887,441B total
// on 2026-08-09; startup entry and static closure are unchanged, so ratchet
// only the total ceiling and keep both startup baselines and all tolerances.
//
// Generated-image delivery continuity adds runtime-owned transcript provenance,
// exact sent-media reply binding, and provider-resume fallback handling to the
// existing assistant chunks without adding a forbidden boot input. Exact macOS
// full hosted-local assembly measured a 8,016,324B static closure and
// 9,994,142B total on 2026-08-09. Ratchet both measurements while retaining
// the established cross-platform tolerances and reviewed-addition allowance.
// Adding the single-message group offer, exact reply ownership, and weekly
// contextualization instructions grows only that lazy assistant output. Exact
// ubuntu assembly measured a 9,933,709B total on 2026-08-10; retain the startup
// baselines and established total tolerance.
//
// Subsequent reviewed biomarker ranges, hosted
// runtime-control compaction, and named-diet guidance moved exact ubuntu total
// output from 9,908,973B to 9,933,847B by 2026-08-10. Entry and static closure
// remain within their existing ceilings and no forbidden subsystem enters the
// boot graph, so ratchet only the total ceiling and keep both startup baselines
// and all tolerances.
//
// Bounded group-tool failure diagnostics plus the strict included-usage read
// contract measured a 9,938,038B total on ubuntu and a 7,983,431B static
// closure on macOS before the mainline additions above were merged. Exact local
// production assembly of the combined graph measured a 9,986,541B total on
// 2026-08-10. Adding the workout response-card contract and canonical command
// reconciliation to that mainline graph measured a 9,994,210B total and
// 8,019,079B static closure on macOS. After adding the timezone and
// deliverable-occurrence projection, exact local production assembly measured
// a 1,674,361B entry, 8,046,334B static closure, and 10,024,188B total. The
// later combined graph measured the same 1,674,361B entry, an 8,044,557B static
// closure, and a 10,022,523B total. Retain the larger reviewed measurements and
// established cross-platform tolerances. The reviewed current-sender private
// completion path previously raised the exact combined macOS total to
// 10,029,806B and the static closure to 8,049,480B without adding a forbidden
// startup input. Adding the recurring-timezone and deliverable-occurrence
// projection to that graph measured a 1,689,761B entry, 8,064,335B static
// closure, and 10,044,661B total. Ratchet the entry and total baselines to the
// exact combined graph while retaining the established cross-platform
// tolerances.
//
// Preserving admitted identity and retry state for Junction blood-pressure
// history extends the deferred provider's lazy output. After merging the later
// mainline runtime boundaries, exact local production assembly of the combined
// graph measured a 1,596,214B entry, 7,718,295B static closure, and 9,637,008B
// total on 2026-08-10. Ratchet the total while retaining the reviewed startup
// baselines and all fixed cross-platform allowances.
//
// Combining that reduced graph with the reviewed current-sender private
// completion path measured a 1,614,630B entry, 7,757,204B static closure, and
// 9,678,656B total on macOS. Both startup measurements remain within the
// retained reviewed baselines, so ratchet only the total ceiling.
//
// Scorer-owned group challenge cards add the normalized score input,
// deterministic scorer, bounded card mapper, and static presentation to that
// combined graph. Exact local production assembly after the latest mainline
// runtime additions measured a 1,619,381B entry, 7,815,801B static closure, and
// 9,770,208B total on 2026-08-10. No forbidden subsystem entered the boot graph,
// so ratchet all three measurements and retain the established narrow
// cross-platform tolerances.
//
// Generated-avatar exact-byte binding plus the subsequent mainline health-
// history and provider additions extend existing lazy outputs without adding a
// forbidden boot input. Exact merged local assembly measured 9,808,583B total
// on 2026-08-11, so ratchet the total only and retain the 32KB allowance.
//
// Exact conversation mailbox consumption and its accepted-reaction recovery
// extend the existing hosted callback output without adding a forbidden boot
// input. Exact current-main assembly measured 9,846,997B total on 2026-08-11,
// so ratchet the total only and retain the 32KB allowance.
//
// Frequency-aware Junction sparse-history recovery extends the existing
// provider and importer outputs without adding a forbidden boot input. Exact
// current-base Linux CI assembly measured 9,883,360B total on 2026-08-12;
// retain the startup baselines and established 32KB allowance.
//
// The reviewed group-share readiness runtime combined with that current base
// extends existing hosted-runtime chunks without adding a forbidden boot input.
// Linux CI measured a 7,934,975B static closure on 2026-08-12; the matching
// macOS production assembly measured 9,960,217B total. Ratchet both measurements
// and retain the established cross-platform tolerances.
//
// Group-projection delivery ownership and its end-to-end deadline extend the
// same hosted callback graph without adding a forbidden boot input or changing
// runner permissions. Combined macOS assembly with group-share first
// materialization measured a 1,689,721B entry, 7,992,470B static closure, and
// 9,975,121B total. Ratchet each baseline to that integrated measurement and
// retain the established cross-platform tolerances.
const RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET = 9_975_121 + 32_768;
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES = 1_689_721;
const RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_BASELINE_BYTES = 7_992_470;
const RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES = 48_000;
const RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_TOLERANCE_BYTES = 96_000;
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
  "/contracts/dist/examples.js",
  "/query/dist/murph-age.js",
  "/query/dist/browser-replica/murph-age.js",
  "/assistant-engine/dist/assistant-codex/dynamic-tools.js",
  "/assistant-runtime/dist/hosted-runtime/events/assistant-notification.js",
  "/assistant-runtime/dist/hosted-runtime/events/assistant-ask-completion.js",
  "/assistant-runtime/dist/hosted-runtime/events/environment-voice.js",
  "/assistant-runtime/dist/hosted-runtime/events/codex-auth.js",
  "node_modules/zod/v4/locales/",
] as const;

const RUNNER_ENTRYPOINT_ALLOWED_BOOT_INPUT_MARKERS = [
  "/clinical-records/dist/retrieval-limits.js",
  "node_modules/zod/v4/locales/en.js",
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
    minifySyntax: true,
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
    `runner entrypoint bundle size: entry ${bundleBytes.entryBytes}B (baseline ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_BASELINE_BYTES}B + ${RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES}B tolerance), static boot closure ${bundleBytes.staticClosureBytes}B (baseline ${RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_BASELINE_BYTES}B + ${RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_TOLERANCE_BYTES}B tolerance), total ${bundleBytes.totalBytes}B of ${RUNNER_ENTRYPOINT_BUNDLE_TOTAL_BYTES_BUDGET}B budget`,
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
// their measured baseline plus emit-jitter tolerance; the total remains a
// fixed ceiling.
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
      + RUNNER_ENTRYPOINT_BUNDLE_ENTRY_TOLERANCE_BYTES,
    staticClosureBytes:
      RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_BASELINE_BYTES
      + RUNNER_ENTRYPOINT_BUNDLE_STATIC_CLOSURE_TOLERANCE_BYTES,
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
