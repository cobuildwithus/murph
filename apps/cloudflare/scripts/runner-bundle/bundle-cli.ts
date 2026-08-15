import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, type Metafile } from "esbuild";
import {
  MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV,
} from "@murphai/health-commons/runtime";

import {
  RUNNER_BUNDLE_SHARED_EXTERNALS,
  RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS,
} from "./bundle-shared.js";
import { buildPortableNodeBinWrapper } from "./runtime-shape.js";

// Externals and drift-guard markers are shared with the container-entrypoint
// bundler; the rationale lives on the lists in bundle-shared.ts.
const VAULT_CLI_BUNDLE_EXTERNALS = RUNNER_BUNDLE_SHARED_EXTERNALS;
const VAULT_CLI_BUNDLE_FORBIDDEN_INPUT_MARKERS =
  RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS;

const VAULT_CLI_BUNDLE_DIRECTORY_NAME = ".bundle";
const VAULT_CLI_BUNDLE_LAZY_OPTIONAL_PACKAGE_NAMES = [
  "@cfworker/json-schema",
  "@modelcontextprotocol/server",
  "yaml",
] as const;
const VAULT_CLI_BUNDLE_LAZY_OPTIONAL_INPUT_MARKERS =
  VAULT_CLI_BUNDLE_LAZY_OPTIONAL_PACKAGE_NAMES.map(
    (packageName) => `/${packageName}/`,
  );
const VAULT_CLI_JSON_IMPORT_SURFACE_PROBE = [
  "--no-config",
  "exercise",
  "facets",
  "--format",
  "json",
] as const;
const VAULT_CLI_IMPORT_SURFACE_HOOK_SOURCE = [
  "import { writeFileSync } from 'node:fs'",
  "import { registerHooks } from 'node:module'",
  "",
  "const logPath = process.env.MURPH_IMPORT_SURFACE_LOG",
  "if (typeof logPath !== 'string' || logPath.length === 0) {",
  "  throw new Error('runner vault-cli import-surface hook requires MURPH_IMPORT_SURFACE_LOG.')",
  "}",
  "",
  "const resolvedModuleUrls = new Set()",
  "registerHooks({",
  "  resolve(specifier, context, nextResolve) {",
  "    const resolution = nextResolve(specifier, context)",
  "    resolvedModuleUrls.add(resolution.url)",
  "    return resolution",
  "  },",
  "})",
  "",
  "process.on('exit', () => {",
  "  writeFileSync(logPath, [...resolvedModuleUrls].join('\\n'), 'utf8')",
  "})",
  "",
].join("\n");

// Byte budgets over the esbuild metafile, so import-graph creep in the real
// installed artifact fails the assembly instead of shipping silently (the
// June 2026 latency regression was exactly this: one static import dragged
// the whole command surface onto the hot path with nothing watching).
// Baselines measured from the real assembled bundle on 2026-06-11:
// total 7,052,933 B across all chunks, entry bin.js 15,569 B. The merged
// Health Commons, recurring-timezone, workout-card, group-challenge-card, and
// generated-image-continuity additions are intentional lazy CLI capabilities;
// no new package enters the graph. The deterministic Messages workout action
// reuses that existing graph and measured 9,111,172 B on macOS after merging
// current main on 2026-08-14. Keep the integrated graph inside the ratcheted
// 9.125MB ceiling. If a violation fires, investigate the listed largest inputs
// first; only raise the budget deliberately for understood, intended growth.
const VAULT_CLI_BUNDLE_TOTAL_BYTES_BUDGET = 9_125_000;
const VAULT_CLI_BUNDLE_ENTRY_BYTES_BUDGET = 20_000;

// Known divergence the parity battery cannot reach (it would need a live
// codex session): assistant-engine resolves two assets relative to its own
// module location, which differs inside chunks — `resolveAssistantSkillsRoot`
// and the prebuilt CLI surface contract path would land inside the bundle
// directory. In the hosted runner image both are pinned to the installed
// engine package via Dockerfile ENV (`MURPH_ASSISTANT_SKILLS_ROOT`,
// `MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH`), which covers this
// bundled vault-cli and the bundled container entrypoint alike. Outside the
// image (no env pins) the bundled CLI still degrades softly to runtime
// generation / the package fallback paths.

// Bundled and unbundled binaries must produce byte-identical output on the
// discovery surfaces and on a representative scoped command (which exercises
// command routing, the loader-backed services, and the lazy runtime imports).
// The scoped probes run without a vault on purpose: the missing-vault error is
// emitted (on stderr) after the full scoped module graph has loaded, so
// identical output still proves the bundled graph wires up correctly.
const VAULT_CLI_BUNDLE_PARITY_PROBES: ReadonlyArray<readonly string[]> = [
  ["--help"],
  ["--llms"],
  ["--llms-full", "--format", "json"],
  ["wearables", "day", "2026-01-01", "--format", "json"],
  ["meal", "totals", "--from", "2026-01-01", "--to", "2026-01-01", "--format", "json"],
  // Reads Health Commons generated artifacts through the image-pinned package
  // root; catches asset-root resolution drift inside the bundled graph.
  ["commons", "protocol", "list", "--query", "sauna", "--limit", "3", "--format", "json"],
];

export async function bundleInstalledVaultCliBinary(
  bundleDir: string,
): Promise<void> {
  const cliPackageDir = path.join(bundleDir, "node_modules", "@murphai", "murph");
  const entryPath = path.join(cliPackageDir, "dist", "bin.js");
  await access(entryPath);

  const bundleOutDir = path.join(cliPackageDir, VAULT_CLI_BUNDLE_DIRECTORY_NAME);
  await rm(bundleOutDir, { force: true, recursive: true });

  const buildResult = await build({
    banner: {
      js: "import { createRequire as __vaultCliCreateRequire } from 'node:module'; const require = __vaultCliCreateRequire(import.meta.url);",
    },
    bundle: true,
    entryPoints: [entryPath],
    external: [
      ...VAULT_CLI_BUNDLE_EXTERNALS,
      ...VAULT_CLI_BUNDLE_LAZY_OPTIONAL_PACKAGE_NAMES,
    ],
    format: "esm",
    logLevel: "error",
    metafile: true,
    minifySyntax: true,
    outdir: bundleOutDir,
    platform: "node",
    splitting: true,
    // The bundle directory sits at the package root so `../package.json`
    // resolved through createRequire(import.meta.url) inside chunks still
    // lands on the installed package manifest.
    tsconfigRaw: "{}",
  });

  assertVaultCliBundleInputsStayExternal(Object.keys(buildResult.metafile.inputs));
  assertVaultCliBundleInlinesSingleCopies(Object.keys(buildResult.metafile.inputs));
  const bundleBytes = assertVaultCliBundleWithinBudgets(buildResult.metafile);
  console.log(
    `vault-cli bundle size: total ${bundleBytes.totalBytes}B of ${VAULT_CLI_BUNDLE_TOTAL_BYTES_BUDGET}B budget, entry ${bundleBytes.entryBytes}B of ${VAULT_CLI_BUNDLE_ENTRY_BYTES_BUDGET}B budget`,
  );
  const healthCommonsPackageRoot = path.join(
    bundleDir,
    "node_modules",
    "@murphai",
    "health-commons",
  );
  assertVaultCliBundleParity({
    bundleOutDir,
    cliPackageDir,
    entryPath,
    healthCommonsPackageRoot,
  });
  await assertVaultCliJsonImportSurface({
    bundleOutDir,
    cliPackageDir,
    entryPath,
    healthCommonsPackageRoot,
  });
  await retargetVaultCliBinWrappers(bundleDir, cliPackageDir);
}

function assertVaultCliBundleInputsStayExternal(inputPaths: string[]): void {
  for (const inputPath of inputPaths) {
    if (!inputPath.includes("node_modules")) {
      continue;
    }

    for (const marker of VAULT_CLI_BUNDLE_FORBIDDEN_INPUT_MARKERS) {
      if (inputPath.includes(`node_modules${marker}`)) {
        throw new Error(
          `vault-cli bundle inlined ${inputPath}; keep ${marker.replaceAll("/", "")} external so the runtime resolves the installed copy.`,
        );
      }
    }

    for (const marker of VAULT_CLI_BUNDLE_LAZY_OPTIONAL_INPUT_MARKERS) {
      if (inputPath.includes(`node_modules${marker}`)) {
        throw new Error(
          `vault-cli bundle inlined ${inputPath}; keep ${marker.replaceAll("/", "")} lazy so JSON commands do not load optional output/MCP dependencies.`,
        );
      }
    }
  }
}

// Packages with module-level registries must be inlined from exactly one
// physical copy: two copies (for example a root install plus a nested
// node_modules copy) get bundled as two module instances whose state never
// meets. incur keys its command tree in module-level WeakMaps, so a split
// leaves command groups registered through one copy invisible to the copy
// that serves the invocation (June 2026 deploy smoke failure: `vault-cli
// --llms` threw "commands is not iterable" in the runner container).
const VAULT_CLI_BUNDLE_SINGLE_COPY_PACKAGE_NAMES = ["incur"] as const;

// Exported for direct unit testing with synthetic input paths; the production
// call site always uses the real bundle's metafile inputs.
export function assertVaultCliBundleInlinesSingleCopies(inputPaths: string[]): void {
  for (const packageName of VAULT_CLI_BUNDLE_SINGLE_COPY_PACKAGE_NAMES) {
    const marker = `node_modules/${packageName}/`;
    const packageRoots = new Set<string>();

    for (const inputPath of inputPaths) {
      const markerIndex = inputPath.lastIndexOf(marker);
      if (markerIndex !== -1) {
        packageRoots.add(inputPath.slice(0, markerIndex + marker.length));
      }
    }

    if (packageRoots.size > 1) {
      throw new Error(
        `vault-cli bundle inlined ${packageName} from multiple copies (${[...packageRoots]
          .sort()
          .join(", ")}); duplicate copies split ${packageName} module state, so command registrations through one copy are invisible to the copy serving the invocation.`,
      );
    }
  }
}

// Exported for direct unit testing with synthetic metafiles; the production
// call site always uses the default budgets above. Returns the measured
// bytes so the assembly log can report actual-vs-budget on success.
export function assertVaultCliBundleWithinBudgets(
  metafile: Metafile,
  budgets: { entryBytes: number; totalBytes: number } = {
    entryBytes: VAULT_CLI_BUNDLE_ENTRY_BYTES_BUDGET,
    totalBytes: VAULT_CLI_BUNDLE_TOTAL_BYTES_BUDGET,
  },
): { entryBytes: number; totalBytes: number } {
  const outputs = Object.entries(metafile.outputs);
  const totalBytes = outputs.reduce((sum, [, output]) => sum + output.bytes, 0);

  // With code splitting, esbuild stamps `entryPoint` on dynamic-import
  // chunks too, so entryPoint presence alone is ambiguous. The real CLI
  // entry output keeps the entry file's plain name (`bin.js`) while shared
  // and dynamic chunks carry content-hash suffixes.
  const entryOutput = outputs.find(
    ([outputPath, output]) =>
      output.entryPoint !== undefined && path.basename(outputPath) === "bin.js",
  );
  if (!entryOutput) {
    throw new Error(
      "vault-cli bundle metafile has no bin.js entry-point output; cannot enforce the entry-chunk byte budget.",
    );
  }
  const [entryPath, { bytes: entryBytes }] = entryOutput;

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

  // List the heaviest inputs so the failure is diagnosable from the build
  // log alone: the culprit of graph creep is almost always near the top.
  const largestInputs = Object.entries(metafile.inputs)
    .sort(([, left], [, right]) => right.bytes - left.bytes)
    .slice(0, 10)
    .map(([inputPath, input]) => `  ${input.bytes}B ${inputPath}`);

  throw new Error(
    [
      `vault-cli bundle exceeded its byte budget: ${violations.join("; ")}.`,
      "Investigate the largest metafile inputs below before raising the budget (see baseline comment on the budget constants):",
      ...largestInputs,
    ].join("\n"),
  );
}

function assertVaultCliBundleParity(input: {
  bundleOutDir: string;
  cliPackageDir: string;
  entryPath: string;
  healthCommonsPackageRoot: string;
}): void {
  const bundledEntryPath = path.join(input.bundleOutDir, "bin.js");

  for (const probe of VAULT_CLI_BUNDLE_PARITY_PROBES) {
    const unbundledStartedAt = performance.now();
    const expected = runVaultCliParityProbe({
      args: probe,
      cwd: input.cliPackageDir,
      entryPath: input.entryPath,
      healthCommonsPackageRoot: input.healthCommonsPackageRoot,
    });
    const unbundledDurationMs = Math.round(performance.now() - unbundledStartedAt);
    const bundledStartedAt = performance.now();
    const actual = runVaultCliParityProbe({
      args: probe,
      cwd: input.cliPackageDir,
      entryPath: bundledEntryPath,
      healthCommonsPackageRoot: input.healthCommonsPackageRoot,
    });
    const bundledDurationMs = Math.round(performance.now() - bundledStartedAt);

    // Warn-only longitudinal trend signal in the assembly log. Never turn
    // this into a hard assertion: shared CI runners make wall-time budgets
    // flake, and a budget loose enough to be stable would catch nothing.
    console.log(
      `parity probe \`${probe.join(" ")}\`: unbundled ${unbundledDurationMs}ms, bundled ${bundledDurationMs}ms`,
    );

    // Symmetric unknown-command output would otherwise "pass" parity while
    // proving nothing — a renamed command or broken CLI bootstrap must fail
    // the assembly, not slip through as matching error text.
    if (expected.stdout.includes("is not a command for")) {
      throw new Error(
        [
          `Unbundled vault-cli no longer recognizes parity probe \`${probe.join(" ")}\`.`,
          `Update VAULT_CLI_BUNDLE_PARITY_PROBES to match the current command surface.`,
          `unbundled stdout head: ${expected.stdout.slice(0, 400)}`,
        ].join("\n"),
      );
    }

    if (
      expected.stdout !== actual.stdout ||
      expected.stderr !== actual.stderr ||
      expected.status !== actual.status
    ) {
      throw new Error(
        [
          `Bundled vault-cli output diverged for \`${probe.join(" ")}\`.`,
          `unbundled status=${expected.status} stdout=${expected.stdout.length}B stderr=${expected.stderr.length}B`,
          `bundled status=${actual.status} stdout=${actual.stdout.length}B stderr=${actual.stderr.length}B`,
          `bundled stdout head: ${actual.stdout.slice(0, 200)}`,
          `bundled stderr head: ${actual.stderr.slice(0, 400)}`,
        ].join("\n"),
      );
    }
  }
}

function runVaultCliParityProbe(input: {
  args: readonly string[];
  cwd: string;
  entryPath: string;
  healthCommonsPackageRoot: string;
}): { status: number; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [input.entryPath, ...input.args], {
    cwd: input.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      // Keep probes hermetic: no operator config or vault may leak in from
      // the assembling machine.
      HOME: path.join(input.cwd, ".parity-probe-home"),
      [MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]: input.healthCommonsPackageRoot,
      VAULT: "",
    },
    // The full `--llms-full` manifest exceeds the 1MiB default; a too-small
    // buffer kills the child mid-stream and turns OS pipe chunking into
    // phantom parity divergence.
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });

  // A child that exited on its own has a numeric status and no signal;
  // anything else (spawn failure, timeout kill, buffer kill) is probe
  // infrastructure breaking and must fail the assembly loudly instead of
  // posing as a parity result.
  if (result.error || result.signal !== null || typeof result.status !== "number") {
    throw new Error(
      `vault-cli parity probe \`${input.args.join(" ")}\` did not exit cleanly (${
        result.error?.message ?? `signal ${result.signal ?? "unknown"}`
      }).`,
    );
  }

  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

async function assertVaultCliJsonImportSurface(input: {
  bundleOutDir: string;
  cliPackageDir: string;
  entryPath: string;
  healthCommonsPackageRoot: string;
}): Promise<void> {
  const probeDir = await mkdtemp(path.join(tmpdir(), "murph-runner-vault-cli-imports-"));
  const hookPath = path.join(probeDir, "import-surface-hook.mjs");
  await writeFile(hookPath, VAULT_CLI_IMPORT_SURFACE_HOOK_SOURCE, "utf8");

  try {
    await Promise.all([
      assertVaultCliJsonImportSurfaceForEntry({
        cwd: input.cliPackageDir,
        entryPath: input.entryPath,
        healthCommonsPackageRoot: input.healthCommonsPackageRoot,
        hookPath,
        label: "unbundled",
        logPath: path.join(probeDir, "unbundled-resolved-imports.log"),
      }),
      assertVaultCliJsonImportSurfaceForEntry({
        cwd: input.cliPackageDir,
        entryPath: path.join(input.bundleOutDir, "bin.js"),
        healthCommonsPackageRoot: input.healthCommonsPackageRoot,
        hookPath,
        label: "bundled",
        logPath: path.join(probeDir, "bundled-resolved-imports.log"),
      }),
    ]);
  } finally {
    await rm(probeDir, { force: true, recursive: true });
  }
}

async function assertVaultCliJsonImportSurfaceForEntry(input: {
  cwd: string;
  entryPath: string;
  healthCommonsPackageRoot: string;
  hookPath: string;
  label: string;
  logPath: string;
}): Promise<void> {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(input.hookPath).href,
      input.entryPath,
      ...VAULT_CLI_JSON_IMPORT_SURFACE_PROBE,
    ],
    {
      cwd: input.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.join(input.cwd, ".parity-probe-home"),
        MURPH_IMPORT_SURFACE_LOG: input.logPath,
        [MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]: input.healthCommonsPackageRoot,
        VAULT: "",
      },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    },
  );

  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error(
      `runner ${input.label} vault-cli JSON import-surface probe failed (${
        result.error?.message ?? `status ${result.status ?? "unknown"} signal ${result.signal ?? "none"}`
      }); stderr head: ${result.stderr.slice(0, 400)}`,
    );
  }

  const parsedOutput = JSON.parse(result.stdout) as {
    facets?: { kinds?: unknown };
  };
  if (
    !Array.isArray(parsedOutput.facets?.kinds) ||
    parsedOutput.facets.kinds[0] !== "exercise" ||
    parsedOutput.facets.kinds[1] !== "stretch"
  ) {
    throw new Error(
      `runner ${input.label} vault-cli JSON import-surface probe returned an unexpected payload.`,
    );
  }

  const resolvedModuleUrls = (await readFile(input.logPath, "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);
  const resolvedPackageNames = new Set(
    resolvedModuleUrls.flatMap((url) => {
      const packageName = normalizeResolvedNodeModulePackageName(url);
      return packageName === null ? [] : [packageName];
    }),
  );
  const eagerlyResolvedLazyPackages =
    VAULT_CLI_BUNDLE_LAZY_OPTIONAL_PACKAGE_NAMES.filter((packageName) =>
      resolvedPackageNames.has(packageName),
    );

  if (eagerlyResolvedLazyPackages.length > 0) {
    throw new Error(
      `runner ${input.label} vault-cli JSON probe resolved lazy optional dependencies: ${eagerlyResolvedLazyPackages.join(", ")}.`,
    );
  }
}

function normalizeResolvedNodeModulePackageName(url: string): string | null {
  if (!url.startsWith("file:")) {
    return null;
  }

  const filePath = fileURLToPath(url);
  const nodeModulesMarker = `${path.sep}node_modules${path.sep}`;
  const nodeModulesIndex = filePath.lastIndexOf(nodeModulesMarker);

  if (nodeModulesIndex === -1) {
    return null;
  }

  const segments = filePath
    .slice(nodeModulesIndex + nodeModulesMarker.length)
    .split(path.sep);
  const [head, scopedName] = segments;

  if (!head) {
    return null;
  }

  if (head.startsWith("@")) {
    return scopedName ? `${head}/${scopedName}` : null;
  }

  return head;
}

async function retargetVaultCliBinWrappers(
  bundleDir: string,
  cliPackageDir: string,
): Promise<void> {
  const binDir = path.join(bundleDir, "node_modules", ".bin");
  const bundledEntryPath = path.join(
    cliPackageDir,
    VAULT_CLI_BUNDLE_DIRECTORY_NAME,
    "bin.js",
  );

  // The package manifest is the single source of truth for bin names: every
  // bin that pointed at the unbundled entry is retargeted to the bundle.
  const manifest = JSON.parse(
    await readFile(path.join(cliPackageDir, "package.json"), "utf8"),
  ) as { bin?: Record<string, string> | string };
  const binMap = typeof manifest.bin === "string" ? null : manifest.bin ?? null;

  if (!binMap) {
    throw new Error(
      "Installed @murphai/murph package manifest has no bin map to retarget.",
    );
  }

  const relativeTargetPath = path
    .relative(binDir, bundledEntryPath)
    .replaceAll(path.sep, "/");
  let retargetedCount = 0;

  const unbundledEntryPath = path.resolve(cliPackageDir, "dist", "bin.js");

  for (const [binName, binTarget] of Object.entries(binMap)) {
    if (path.resolve(cliPackageDir, binTarget) !== unbundledEntryPath) {
      continue;
    }

    const wrapperPath = path.join(binDir, binName);
    await writeFile(
      wrapperPath,
      buildPortableNodeBinWrapper(relativeTargetPath),
      "utf8",
    );
    await chmod(wrapperPath, 0o755);
    retargetedCount += 1;
  }

  if (retargetedCount === 0) {
    throw new Error(
      "No @murphai/murph bin entries pointed at dist/bin.js; the bundle retarget found nothing to rewrite.",
    );
  }
}
