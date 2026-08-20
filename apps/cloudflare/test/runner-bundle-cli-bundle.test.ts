import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  memoryDocumentRelativePath,
  parseMemoryDocument,
  vaultMetadataSchema,
} from "@murphai/contracts";
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
import { createInitializedVaultCliMemoryFixture } from "../scripts/runner-bundle/vault-cli-memory-fixture.js";

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
const MEMORY_DIAGNOSTIC_SENTINEL = "synthetic-memory-diagnostic-tripwire";

function buildMemoryAwareFakeCliSource(
  memoryShowBranch: readonly string[],
): string {
  return [
    "import { existsSync } from 'node:fs';",
    "import { createRequire } from 'node:module';",
    "import path from 'node:path';",
    "const require = createRequire(import.meta.url);",
    "const packageJson = require('../package.json');",
    "const args = process.argv.slice(2);",
    "const vault = process.env.VAULT ?? '';",
    "const isMemoryShow = args.join('\\0') === 'memory\\0show\\0--format\\0json';",
    "const hasHermeticEnvironment = isMemoryShow",
    "  ? vault.length > 0 && process.env.HOME === path.dirname(vault)",
    "  : (process.env.HOME ?? '').endsWith('.parity-probe-home') && vault === '';",
    "if (!hasHermeticEnvironment) {",
    "  console.log(import.meta.url);",
    "}",
    "if (isMemoryShow) {",
    ...memoryShowBranch,
    "} else if (args.join('\\0') === '--no-config\\0exercise\\0facets\\0--format\\0json') {",
    "  console.log(JSON.stringify({ facets: { kinds: ['exercise', 'stretch'] } }));",
    "} else {",
    "  console.log(JSON.stringify({ args, version: packageJson.version }));",
    "}",
    "",
  ].join("\n");
}

function buildCanonicalMemoryShowBranch(input: {
  missingExitFailure?: boolean;
  missingTitleDivergence?: boolean;
  populatedDiagnostic?: boolean;
} = {}): string[] {
  const fixedTimestamp = "2026-08-01T00:00:00.000Z";
  const memoryId = "mem_0123456789ABCDEFGHJKMNPQRS";
  return [
    "  const exists = existsSync(path.join(vault, 'bank', 'memory.md'));",
    "  const location = import.meta.url.includes('/.bundle/') ? 'bundled' : 'unbundled';",
    `  const fixedTimestamp = ${JSON.stringify(fixedTimestamp)};`,
    "  const readTimestamp = exists ? fixedTimestamp : location === 'bundled' ? '2026-08-01T00:00:02.000Z' : '2026-08-01T00:00:01.000Z';",
    input.missingTitleDivergence
      ? "  const title = !exists && location === 'bundled' ? 'Archive' : 'Memory';"
      : "  const title = 'Memory';",
    "  const frontmatter = { docType: 'memory', schemaVersion: 'murph.frontmatter.memory.v1', title, updatedAt: readTimestamp };",
    input.populatedDiagnostic
      ? `  const text = ${JSON.stringify(MEMORY_DIAGNOSTIC_SENTINEL)} + '-' + location;`
      : "  const text = 'Synthetic runner memory parity record.';",
    "  const record = exists ? {",
    `    id: ${JSON.stringify(memoryId)},`,
    "    section: 'Context',",
    "    text,",
    "    createdAt: fixedTimestamp,",
    "    updatedAt: fixedTimestamp,",
    "    sourceLine: 1,",
    "    sourcePath: 'bank/memory.md',",
    "  } : null;",
    "  const recordMarker = record ? ` <!-- murph-memory:${JSON.stringify({ id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt })} -->` : '';",
    "  const markdown = [",
    "    '---',",
    "    'docType: memory',",
    "    'schemaVersion: murph.frontmatter.memory.v1',",
    "    `title: ${title}` ,",
    "    `updatedAt: ${readTimestamp}` ,",
    "    '---',",
    "    '# Memory',",
    "    '',",
    "    '## Identity',",
    "    '',",
    "    '## Preferences',",
    "    '',",
    "    '## Instructions',",
    "    '',",
    "    '## Context',",
    "    ...(record ? ['', `- ${record.text}${recordMarker}`] : []),",
    "    '',",
    "  ].join('\\n');",
    "  console.log(JSON.stringify({",
    "    document: {",
    "      exists,",
    "      frontmatter,",
    "      markdown,",
    "      records: record ? [record] : [],",
    "      sourcePath: 'bank/memory.md',",
    "      updatedAt: exists ? readTimestamp : null,",
    "    },",
    "    memory: null,",
    "    vault,",
    "  }));",
    ...(input.missingExitFailure
      ? ["  if (!exists) {", "    process.exitCode = 1;", "  }"]
      : []),
  ];
}

const FAKE_CLI_SOURCE = buildMemoryAwareFakeCliSource([
  ...buildCanonicalMemoryShowBranch(),
]);

const MISSING_MEMORY_FAILURE_CLI_SOURCE = buildMemoryAwareFakeCliSource([
  ...buildCanonicalMemoryShowBranch({ missingExitFailure: true }),
]);

const MISSING_MEMORY_DIVERGENT_CLI_SOURCE = buildMemoryAwareFakeCliSource([
  ...buildCanonicalMemoryShowBranch({ missingTitleDivergence: true }),
]);

const MEMORY_DIVERGENT_CLI_SOURCE = buildMemoryAwareFakeCliSource([
  ...buildCanonicalMemoryShowBranch({ populatedDiagnostic: true }),
]);

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

  it("passes populated parity and missing-memory success hermetically before retargeting both bin wrappers", async () => {
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

  it("creates canonical populated and missing-memory fixtures with private permissions", async () => {
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), "murph-runner-memory-fixture-"),
    );
    temporaryDirectories.push(fixtureRoot);
    const vaultRoot = path.join(fixtureRoot, "home", "vault");
    const bankRoot = path.join(vaultRoot, "bank");
    const memoryPath = path.join(vaultRoot, memoryDocumentRelativePath);

    await createInitializedVaultCliMemoryFixture({
      includeMemory: true,
      vaultRoot,
    });

    expect((await stat(vaultRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(bankRoot)).mode & 0o777).toBe(0o700);
    for (const filePath of [
      path.join(vaultRoot, "CORE.md"),
      path.join(vaultRoot, "vault.json"),
      memoryPath,
    ]) {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }

    expect(
      vaultMetadataSchema.parse(
        JSON.parse(await readFile(path.join(vaultRoot, "vault.json"), "utf8")),
      ).formatVersion,
    ).toBeGreaterThan(0);

    const document = parseMemoryDocument({
      sourcePath: "bank/memory.md",
      text: await readFile(memoryPath, "utf8"),
    });
    expect(document.records.length).toBeGreaterThan(0);

    await createInitializedVaultCliMemoryFixture({
      includeMemory: false,
      vaultRoot,
    });
    await expect(access(memoryPath)).rejects.toThrow();
  });

  it("rejects a matching nonzero missing-memory result", async () => {
    const bundleDir = await stageFakeInstalledCli(
      MISSING_MEMORY_FAILURE_CLI_SOURCE,
    );

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow(
      /unbundled missing memory/u,
    );
  });

  it("rejects non-timestamp missing-memory drift", async () => {
    const bundleDir = await stageFakeInstalledCli(
      MISSING_MEMORY_DIVERGENT_CLI_SOURCE,
    );

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow(
      /Bundled vault-cli output diverged for `memory show --format json \(missing\)`/u,
    );
  });

  it("keeps populated-memory parity diagnostics content-free", async () => {
    const bundleDir = await stageFakeInstalledCli(
      MEMORY_DIVERGENT_CLI_SOURCE,
    );
    const failure = await bundleInstalledVaultCliBinary(bundleDir).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).toContain("memory show --format json (populated)");
    expect(message).toMatch(
      /unbundled status=0 stdoutBytes=\d+ stderrBytes=0/u,
    );
    expect(message).toMatch(/bundled status=0 stdoutBytes=\d+ stderrBytes=0/u);
    expect(message).not.toContain(MEMORY_DIAGNOSTIC_SENTINEL);
    expect(message).not.toContain("stdoutPreview");
    expect(message).not.toContain("stderrPreview");
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
      assertVaultCliBundleWithinBudgets(metafile, {
        entryBytes: 200,
        staticClosureBytes: 200,
        totalBytes: 800,
      }),
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
      assertVaultCliBundleWithinBudgets(metafile, {
        entryBytes: 300,
        staticClosureBytes: 300,
        totalBytes: 1100,
      }),
    ).toEqual({ entryBytes: 300, staticClosureBytes: 300, totalBytes: 1100 });
  });

  it("locks the production total-byte budget at its exact boundary", () => {
    const createMetafile = (lazyChunkBytes: number): Metafile => ({
      inputs: {},
      outputs: {
        ".bundle/bin.js": {
          bytes: 10_000,
          entryPoint: "packages/cli/src/bin.ts",
          exports: [],
          imports: [{ kind: "dynamic-import", path: "./chunk-lazy.js" }],
          inputs: {},
        },
        ".bundle/chunk-lazy.js": {
          bytes: lazyChunkBytes,
          exports: [],
          imports: [],
          inputs: {},
        },
      },
    });

    expect(
      assertVaultCliBundleWithinBudgets(createMetafile(9_387_704)),
    ).toEqual({
      entryBytes: 10_000,
      staticClosureBytes: 10_000,
      totalBytes: 9_397_704,
    });
    expect(() =>
      assertVaultCliBundleWithinBudgets(createMetafile(9_387_705)),
    ).toThrow(/total output 9397705B exceeds budget 9397704B/u);
  });

  it("rejects dynamic-to-static graph drift without relying on total size growth", () => {
    const createMetafile = (kind: "dynamic-import" | "import-statement"): Metafile => ({
      inputs: {},
      outputs: {
        ".bundle/bin.js": {
          bytes: 100,
          entryPoint: "packages/cli/src/bin.ts",
          exports: [],
          imports: [{ kind, path: "./chunk-heavy.js" }],
          inputs: {},
        },
        ".bundle/chunk-heavy.js": {
          bytes: 700,
          exports: [],
          imports: [],
          inputs: {},
        },
      },
    });
    const budgets = {
      entryBytes: 100,
      staticClosureBytes: 200,
      totalBytes: 800,
    };

    expect(assertVaultCliBundleWithinBudgets(
      createMetafile("dynamic-import"),
      budgets,
    )).toEqual({
      entryBytes: 100,
      staticClosureBytes: 100,
      totalBytes: 800,
    });
    expect(() =>
      assertVaultCliBundleWithinBudgets(
        createMetafile("import-statement"),
        budgets,
      )
    ).toThrow(/static startup closure 800B exceeds budget 200B/u);
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
