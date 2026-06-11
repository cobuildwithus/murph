import { execFileSync } from "node:child_process";
import { access, chmod, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

import { buildPortableNodeBinWrapper } from "./runtime-shape.js";

// The interactive chat/setup UI stack stays external: ink drags react and
// yoga-layout (top-level-await WASM) into the graph, which both bloats the
// bundle and is exactly the surface the hosted runner never renders. The
// externals resolve from the installed node_modules on the rare lazy path
// (hosted chat fail-closed error) that still loads them.
const VAULT_CLI_BUNDLE_EXTERNALS = ["ink", "react-devtools-core"];

const VAULT_CLI_BUNDLE_DIRECTORY_NAME = ".bundle";
const VAULT_CLI_BUNDLE_BIN_NAMES = ["vault-cli", "murph"] as const;

// Bundled and unbundled binaries must produce byte-identical output on the
// discovery surfaces and on a representative scoped command (which exercises
// command routing, the loader-backed services, and the lazy runtime imports).
// The scoped probe runs without a vault on purpose: the missing-vault error is
// emitted after the full scoped module graph has loaded, so identical output
// still proves the bundled graph wires up correctly.
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

  await build({
    banner: {
      js: "import { createRequire as __vaultCliCreateRequire } from 'node:module'; const require = __vaultCliCreateRequire(import.meta.url);",
    },
    bundle: true,
    entryPoints: [entryPath],
    external: [...VAULT_CLI_BUNDLE_EXTERNALS],
    format: "esm",
    logLevel: "error",
    outdir: bundleOutDir,
    platform: "node",
    splitting: true,
    // The bundle directory sits at the package root so `../package.json`
    // resolved through createRequire(import.meta.url) inside chunks still
    // lands on the installed package manifest.
    tsconfigRaw: "{}",
  });

  assertVaultCliBundleParity({ bundleOutDir, cliPackageDir, entryPath });
  await retargetVaultCliBinWrappers(bundleDir, cliPackageDir);
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
    if (expected.output.includes("is not a command for")) {
      throw new Error(
        [
          `Unbundled vault-cli no longer recognizes parity probe \`${probe.join(" ")}\`.`,
          `Update VAULT_CLI_BUNDLE_PARITY_PROBES to match the current command surface.`,
          `unbundled head: ${expected.output.slice(0, 400)}`,
        ].join("\n"),
      );
    }

    if (expected.output !== actual.output || expected.status !== actual.status) {
      throw new Error(
        [
          `Bundled vault-cli output diverged for \`${probe.join(" ")}\`.`,
          `unbundled status=${expected.status} bytes=${expected.output.length}`,
          `bundled status=${actual.status} bytes=${actual.output.length}`,
          `bundled head: ${actual.output.slice(0, 400)}`,
        ].join("\n"),
      );
    }
  }
}

function runVaultCliParityProbe(
  entryPath: string,
  args: readonly string[],
  cwd: string,
): { output: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [entryPath, ...args], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        // Keep probes hermetic: no operator config or vault may leak in from
        // the assembling machine.
        HOME: path.join(cwd, ".parity-probe-home"),
        VAULT: "",
      },
      // The full `--llms-full` manifest exceeds the 1MiB execFileSync default;
      // a too-small buffer kills the child mid-stream and turns OS pipe
      // chunking into phantom parity divergence.
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { output: stdout, status: 0 };
  } catch (error) {
    const failure = error as {
      code?: string;
      status?: number | null;
      stdout?: string | Buffer;
    };

    // A child that exited on its own has a numeric status; anything else
    // (ENOBUFS, timeout kill, spawn failure) is probe infrastructure breaking
    // and must fail the assembly loudly instead of posing as a parity result.
    if (typeof failure.status !== "number") {
      throw new Error(
        `vault-cli parity probe \`${args.join(" ")}\` did not exit cleanly (${failure.code ?? "unknown"}).`,
      );
    }

    const stdout = failure.stdout?.toString() ?? "";
    return { output: stdout, status: failure.status };
  }
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

  for (const binName of VAULT_CLI_BUNDLE_BIN_NAMES) {
    const wrapperPath = path.join(binDir, binName);
    const relativeTargetPath = path
      .relative(binDir, bundledEntryPath)
      .replaceAll(path.sep, "/");

    await writeFile(
      wrapperPath,
      buildPortableNodeBinWrapper(relativeTargetPath),
      "utf8",
    );
    await chmod(wrapperPath, 0o755);
  }
}
