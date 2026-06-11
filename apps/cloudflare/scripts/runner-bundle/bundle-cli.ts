import { spawnSync } from "node:child_process";
import { access, chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

import { buildPortableNodeBinWrapper } from "./runtime-shape.js";

// Externals resolve from the installed node_modules at runtime instead of
// being inlined into the bundle:
// - ink/react/react-devtools-core: the interactive chat/setup UI stack. ink
//   drags yoga-layout (top-level-await WASM) into the graph, and react must
//   stay external alongside it so the lazy UI path never sees two React
//   instances (external ink resolving installed react while murph UI code
//   uses a bundled copy would break hooks dispatch).
// - sharp/zxing-wasm: native binaries and WASM assets resolved relative to
//   their own package directories; bundling their JS would detach it from
//   those assets.
const VAULT_CLI_BUNDLE_EXTERNALS = [
  "ink",
  "react",
  "react/*",
  "react-devtools-core",
  "sharp",
  "zxing-wasm",
];

// Source-path markers that must never appear in the bundle's inputs. Guards
// the externals list against drift: a newly added import path that drags one
// of these packages into the bundle fails the assembly instead of shipping a
// duplicate runtime copy.
const VAULT_CLI_BUNDLE_FORBIDDEN_INPUT_MARKERS = [
  "/ink/",
  "/react/",
  "/react-devtools-core/",
  "/sharp/",
  "/yoga-layout/",
  "/zxing-wasm/",
];

const VAULT_CLI_BUNDLE_DIRECTORY_NAME = ".bundle";

// Known divergence the parity battery cannot reach (it would need a live
// codex session): assistant-engine resolves two assets relative to its own
// module location, which differs inside chunks — `resolveAssistantSkillsRoot`
// lands on `@murphai/murph/skills` (absent) instead of
// `@murphai/assistant-engine/skills`, and the prebuilt CLI surface contract
// path misses, silently falling back to runtime generation. Hosted production
// is unaffected (the runtime runs the engine unbundled via
// `dist/container-entrypoint.js`); only an in-container `vault-cli assistant
// run` through the bundled wrapper would hit these, degrading softly. If that
// path ever becomes load-bearing, make those resolvers honor env overrides
// before relying on the bundle.

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
    external: [...VAULT_CLI_BUNDLE_EXTERNALS],
    format: "esm",
    logLevel: "error",
    metafile: true,
    outdir: bundleOutDir,
    platform: "node",
    splitting: true,
    // The bundle directory sits at the package root so `../package.json`
    // resolved through createRequire(import.meta.url) inside chunks still
    // lands on the installed package manifest.
    tsconfigRaw: "{}",
  });

  assertVaultCliBundleInputsStayExternal(Object.keys(buildResult.metafile.inputs));
  assertVaultCliBundleParity({ bundleOutDir, cliPackageDir, entryPath });
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
  }
}

function assertVaultCliBundleParity(input: {
  bundleOutDir: string;
  cliPackageDir: string;
  entryPath: string;
}): void {
  const bundledEntryPath = path.join(input.bundleOutDir, "bin.js");

  for (const probe of VAULT_CLI_BUNDLE_PARITY_PROBES) {
    const expected = runVaultCliParityProbe(input.entryPath, probe, input.cliPackageDir);
    const actual = runVaultCliParityProbe(bundledEntryPath, probe, input.cliPackageDir);

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

function runVaultCliParityProbe(
  entryPath: string,
  args: readonly string[],
  cwd: string,
): { status: number; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [entryPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      // Keep probes hermetic: no operator config or vault may leak in from
      // the assembling machine.
      HOME: path.join(cwd, ".parity-probe-home"),
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
      `vault-cli parity probe \`${args.join(" ")}\` did not exit cleanly (${
        result.error?.message ?? `signal ${result.signal ?? "unknown"}`
      }).`,
    );
  }

  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
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
