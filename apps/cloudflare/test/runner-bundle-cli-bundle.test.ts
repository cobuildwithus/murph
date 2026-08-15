import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Metafile } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertVaultCliBundleInlinesSingleCopies,
  assertVaultCliBundleWithinBudgets,
  bundleInstalledVaultCliBinary,
} from "../scripts/runner-bundle/bundle-cli.js";
import {
  RUNNER_BUNDLE_SHARED_EXTERNALS,
  RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS,
} from "../scripts/runner-bundle/bundle-shared.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

// A miniature installed CLI that exercises the two bundle hazards the real
// vault-cli has: createRequire(import.meta.url) + require('../package.json'),
// and a deterministic response for every parity probe. The hermeticity
// tripwire emits a location-dependent line whenever a probe inherits operator
// config (HOME or VAULT) from the assembling machine, so a regression in the
// probes' env overrides surfaces as parity divergence.
const FAKE_CLI_SOURCE = [
  "import { createRequire } from 'node:module';",
  "const require = createRequire(import.meta.url);",
  "const packageJson = require('../package.json');",
  "const args = process.argv.slice(2);",
  "if (!(process.env.HOME ?? '').endsWith('.parity-probe-home') || process.env.VAULT !== '') {",
  "  console.log(import.meta.url);",
  "}",
  "if (args.join('\\0') === '--no-config\\0exercise\\0facets\\0--format\\0json') {",
  "  console.log(JSON.stringify({ facets: { kinds: ['exercise', 'stretch'] } }));",
  "} else {",
  "  console.log(JSON.stringify({ args, version: packageJson.version }));",
  "}",
  "",
].join("\n");

// Output that depends on the executing file's location diverges between the
// bundled and unbundled binaries, which the parity battery must reject.
const DIVERGENT_CLI_SOURCE = [
  "import { createRequire } from 'node:module';",
  "const require = createRequire(import.meta.url);",
  "require('../package.json');",
  "console.log(import.meta.url);",
  "",
].join("\n");

// Same divergence, but on stderr with empty stdout and a nonzero exit — the
// exact shape of the scoped no-vault probes.
const STDERR_DIVERGENT_CLI_SOURCE = [
  "import { createRequire } from 'node:module';",
  "const require = createRequire(import.meta.url);",
  "require('../package.json');",
  "console.error(import.meta.url);",
  "process.exitCode = 1;",
  "",
].join("\n");

async function stageFakeInstalledCli(cliSource: string): Promise<string> {
  const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-cli-bundle-"));
  temporaryDirectories.push(bundleDir);

  const cliPackageDir = path.join(bundleDir, "node_modules", "@murphai", "murph");
  await mkdir(path.join(cliPackageDir, "dist"), { recursive: true });
  await mkdir(path.join(bundleDir, "node_modules", ".bin"), { recursive: true });
  await writeFile(
    path.join(cliPackageDir, "package.json"),
    JSON.stringify({
      bin: { murph: "dist/bin.js", "vault-cli": "dist/bin.js" },
      name: "@murphai/murph",
      type: "module",
      version: "9.9.9",
    }),
    "utf8",
  );
  await writeFile(path.join(cliPackageDir, "dist", "bin.js"), cliSource, "utf8");

  return bundleDir;
}

describe("runner bundle vault-cli esbuild step", () => {
  it("inlines Health Commons while keeping asset and generated SDK packages external", () => {
    expect(RUNNER_BUNDLE_SHARED_EXTERNALS).not.toContain("@murphai/health-commons");
    expect(RUNNER_BUNDLE_SHARED_EXTERNALS).not.toContain("@murphai/health-commons/*");
    expect(RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS).not.toContain(
      "/@murphai/health-commons/",
    );
    expect(RUNNER_BUNDLE_SHARED_EXTERNALS).toContain("@murphai/exercise-library");
    expect(RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS).toContain(
      "/@murphai/exercise-library/",
    );
    for (const packageName of [
      "@elevenlabs/elevenlabs-js",
      "@junction-api/sdk",
      "@linqapp/sdk",
      "exa-js",
      "openai",
    ]) {
      expect(RUNNER_BUNDLE_SHARED_EXTERNALS).toContain(packageName);
      expect(RUNNER_BUNDLE_SHARED_EXTERNALS).toContain(`${packageName}/*`);
      expect(RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS).toContain(
        `/${packageName}/`,
      );
    }
  });

  it("bundles the installed CLI, passes parity hermetically, and retargets both bin wrappers", async () => {
    const bundleDir = await stageFakeInstalledCli(FAKE_CLI_SOURCE);

    // Simulate an operator vault configured on the assembling machine: the
    // parity probes must not see it (the fake CLI's tripwire would otherwise
    // diverge and fail the bundle step).
    const previousVault = process.env.VAULT;
    process.env.VAULT = path.join(bundleDir, "operator-vault-must-not-leak");
    try {
      await bundleInstalledVaultCliBinary(bundleDir);
    } finally {
      if (previousVault === undefined) {
        delete process.env.VAULT;
      } else {
        process.env.VAULT = previousVault;
      }
    }

    const bundledEntry = path.join(
      bundleDir,
      "node_modules",
      "@murphai",
      "murph",
      ".bundle",
      "bin.js",
    );
    await access(bundledEntry);

    for (const binName of ["vault-cli", "murph"]) {
      const wrapperPath = path.join(bundleDir, "node_modules", ".bin", binName);
      const wrapper = await readFile(wrapperPath, "utf8");
      expect(wrapper).toContain("../@murphai/murph/.bundle/bin.js");

      // Execute the wrapper itself, exactly as the hosted runtime does via
      // PATH — this catches shebang, chmod, and relative-path regressions
      // that reading the wrapper text cannot.
      const wrapperOutput = execFileSync(wrapperPath, ["--help"], {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: path.join(bundleDir, ".parity-probe-home"),
          VAULT: "",
        },
      });
      expect(JSON.parse(wrapperOutput)).toEqual({
        args: ["--help"],
        version: "9.9.9",
      });
    }

    // The bundled binary must resolve ../package.json from its on-disk
    // location exactly like the unbundled one.
    const output = execFileSync(process.execPath, [bundledEntry, "--help"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.join(bundleDir, ".parity-probe-home"),
        VAULT: "",
      },
    });
    expect(JSON.parse(output)).toEqual({ args: ["--help"], version: "9.9.9" });
  });

  it("fails the assembly when bundled output diverges from the unbundled binary", async () => {
    const bundleDir = await stageFakeInstalledCli(DIVERGENT_CLI_SOURCE);

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow(
      /Bundled vault-cli output diverged/,
    );
  });

  // The scoped no-vault probes exit nonzero with their error on stderr and an
  // empty stdout, so stderr must participate in parity — otherwise a broken
  // bundled graph that fails differently still "matches".
  it("fails the assembly when only stderr diverges between the binaries", async () => {
    const bundleDir = await stageFakeInstalledCli(STDERR_DIVERGENT_CLI_SOURCE);

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow(
      /Bundled vault-cli output diverged/,
    );
  });

  it("fails fast when the installed CLI entry is missing", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-cli-bundle-"));
    temporaryDirectories.push(bundleDir);

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow();
  });

  // Budget enforcement is unit-tested with injected budgets against synthetic
  // metafiles; the production call site inside bundleInstalledVaultCliBinary
  // uses the real constants against the real esbuild metafile.
  it("fails the byte budgets with actual-vs-budget numbers and the largest inputs", () => {
    const metafile: Metafile = {
      inputs: {
        "node_modules/heavy-dep/index.js": { bytes: 700, imports: [] },
        "packages/cli/src/bin.ts": { bytes: 50, imports: [] },
        "packages/cli/src/scoped-command.ts": { bytes: 250, imports: [] },
      },
      outputs: {
        ".bundle/bin.js": {
          bytes: 300,
          entryPoint: "packages/cli/src/bin.ts",
          exports: [],
          imports: [],
          inputs: {},
        },
        ".bundle/chunk-AAAA.js": {
          bytes: 700,
          exports: [],
          imports: [],
          inputs: {},
        },
        // Code splitting stamps entryPoint on dynamic-import chunks too; the
        // entry budget must bind to bin.js, not whichever entry-point output
        // happens to enumerate first.
        ".bundle/scoped-command-BBBB.js": {
          bytes: 100,
          entryPoint: "packages/cli/src/scoped-command.ts",
          exports: [],
          imports: [],
          inputs: {},
        },
      },
    };

    expect(() =>
      assertVaultCliBundleWithinBudgets(metafile, { entryBytes: 200, totalBytes: 800 }),
    ).toThrow(
      new RegExp(
        [
          "total output 1100B exceeds budget 800B",
          ".*entry chunk \\.bundle/bin\\.js 300B exceeds budget 200B",
          // Largest inputs listed in descending byte order.
          "[\\s\\S]*700B node_modules/heavy-dep/index\\.js",
          "[\\s\\S]*250B packages/cli/src/scoped-command\\.ts",
          "[\\s\\S]*50B packages/cli/src/bin\\.ts",
        ].join(""),
      ),
    );

    expect(
      assertVaultCliBundleWithinBudgets(metafile, { entryBytes: 300, totalBytes: 1100 }),
    ).toEqual({ entryBytes: 300, totalBytes: 1100 });
  });

  // incur keys its command tree in module-level WeakMaps, so inlining two
  // physical copies (root install plus a nested node_modules copy) splits the
  // registry: groups registered through one copy are invisible to the copy
  // serving the invocation. June 2026 deploy smoke failure: `vault-cli --llms`
  // threw "commands is not iterable" in the runner container.
  it("rejects bundles that inline incur from more than one installed copy", () => {
    expect(() =>
      assertVaultCliBundleInlinesSingleCopies([
        "node_modules/incur/dist/Cli.js",
        "node_modules/@murphai/murph/node_modules/incur/dist/Cli.js",
        "packages/cli/src/bin.ts",
      ]),
    ).toThrow(/inlined incur from multiple copies/u);

    expect(() =>
      assertVaultCliBundleInlinesSingleCopies([
        "node_modules/incur/dist/Cli.js",
        "node_modules/incur/dist/internal/command.js",
        "packages/cli/src/bin.ts",
      ]),
    ).not.toThrow();
  });

  // The parity battery compares bundled vs unbundled output, so a probe whose
  // command was renamed away makes BOTH sides emit the same command-not-found
  // error and the battery silently stops exercising the scoped module graph.
  // Pin every scoped probe to a literal command path in the vault-cli command
  // manifest so a rename fails here instead.
  it("aims every scoped parity probe at a real vault-cli command path", async () => {
    const bundleCliSource = await readFile(
      new URL("../scripts/runner-bundle/bundle-cli.ts", import.meta.url),
      "utf8",
    );
    const probesSection = bundleCliSource
      .split("VAULT_CLI_BUNDLE_PARITY_PROBES")[1]
      ?.split("];")[0];
    expect(probesSection).toBeDefined();
    const parityProbes = [...(probesSection ?? "").matchAll(/\[([^\][]+)\]/g)]
      .map((arrayMatch) => JSON.parse(`[${arrayMatch[1]}]`) as string[])
      .filter((probe) => probe.length > 0);
    expect(parityProbes).toContainEqual(["--help"]);
    const scopedProbes = parityProbes.filter((probe) => !probe[0]?.startsWith("-"));
    expect(scopedProbes.length).toBeGreaterThan(0);

    const manifestSource = await readFile(
      new URL(
        "../../../packages/cli/src/vault-cli-command-manifest.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const manifestCommandPaths = [
      ...manifestSource.matchAll(/path: \[([^\]]+)\]/g),
    ].map((pathMatch) =>
      [...pathMatch[1].matchAll(/'([^']+)'/g)].map((segment) => segment[1]),
    );
    expect(manifestCommandPaths.length).toBeGreaterThan(50);

    for (const probe of scopedProbes) {
      const startsWithManifestCommandPath = manifestCommandPaths.some(
        (commandPath) =>
          commandPath.length > 0 &&
          commandPath.every((segment, index) => probe[index] === segment),
      );
      expect(
        startsWithManifestCommandPath,
        `parity probe \`${probe.join(" ")}\` does not start with any command path from the vault-cli command manifest`,
      ).toBe(true);
    }
  });
});
