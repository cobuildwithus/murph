import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPreparedRunnerBundle,
  writeRunnerBundleManifest,
} from "../scripts/deploy-artifacts.js";
import {
  hostedRunnerRuntimePackageName,
  resolveHostedRunnerWorkspacePackageNames,
} from "../scripts/runner-bundle-contract.js";
import {
  buildHostedRunnerWorkspaceArtifacts,
  mapWithConcurrency,
  packWorkspacePackageArtifacts,
  stageHostedRunnerRuntimeArtifact,
} from "../scripts/runner-bundle/workspace-artifacts.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const temporaryDirectories: string[] = [];
const healthCommonsRuntimeArtifactNames = [
  "biomarker-desired-directions.json",
  "web/browse/goals.json",
  "knowledge.sqlite",
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  vi.unstubAllEnvs();
});

describe("runner bundle runtime artifact staging", () => {
  it("builds dependencies before CLI assembly and suppresses assembly after a failed build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-runner-build-flow-"));
    temporaryDirectories.push(root);
    for (const directory of ["apps", "bin", "scripts", "packages/murph", "packages/assistant-engine", "packages/contracts"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    for (const name of ["murph", "assistant-engine", "contracts"]) {
      await writeFile(path.join(root, "packages", name, "package.json"), JSON.stringify({
        name: `@murphai/${name}`, version: "1.0.0",
        dependencies: name === "assistant-engine" ? { "@murphai/murph": "workspace:*" } : {},
      }));
    }
    const pnpm = path.join(root, "bin", "pnpm");
    await writeFile(pnpm, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "if (fs.existsSync('fail-build')) process.exit(17);",
      "fs.writeFileSync('build.json', JSON.stringify(process.argv.slice(2)));",
    ].join("\n"));
    await chmod(pnpm, 0o755);
    await writeFile(path.join(root, "scripts", "assemble-assistant-cli-surface.mjs"), [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const args = JSON.parse(readFileSync('build.json', 'utf8'));",
      "if (!args.includes('@murphai/murph')) throw new Error('CLI was not built');",
      "writeFileSync('assembled', 'ready');",
    ].join("\n"));
    vi.stubEnv("PATH", `${path.dirname(pnpm)}${path.delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("PNPM_STORE_DIR", path.join(root, "store"));
    for (const concurrency of [undefined, "4"]) {
      vi.stubEnv("MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY", concurrency);
      await buildHostedRunnerWorkspaceArtifacts(["@murphai/assistant-engine", "@murphai/murph"], { repoRoot: root });
      expect(JSON.parse(await readFile(path.join(root, "build.json"), "utf8"))).toEqual([
        `--workspace-concurrency=${concurrency ?? "1"}`, "--filter", "@murphai/murph",
        "--filter", "@murphai/assistant-engine", "run", "build",
      ]);
      await expect(readFile(path.join(root, "assembled"), "utf8")).resolves.toBe("ready");
      await rm(path.join(root, "assembled"));
    }
    await buildHostedRunnerWorkspaceArtifacts(["@murphai/contracts"], { repoRoot: root });
    await expect(readFile(path.join(root, "assembled"))).rejects.toMatchObject({ code: "ENOENT" });
    vi.stubEnv("MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY", "0");
    await expect(buildHostedRunnerWorkspaceArtifacts(["@murphai/contracts"], { repoRoot: root }))
      .rejects.toThrow("must be a positive integer");
    vi.stubEnv("MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY", "1");
    await writeFile(path.join(root, "fail-build"), "fail");
    await expect(buildHostedRunnerWorkspaceArtifacts(["@murphai/assistant-engine", "@murphai/murph"], { repoRoot: root }))
      .rejects.toThrow("exited with code 17");
    await expect(readFile(path.join(root, "assembled"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for active bounded-concurrency work before rethrowing the first failure", async () => {
    const events: string[] = [];

    await expect(
      mapWithConcurrency(["slow", "fail", "blocked"], 2, async (item) => {
        events.push(`start:${item}`);

        if (item === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 10));
          events.push(`finish:${item}`);
          return item;
        }

        if (item === "fail") {
          events.push(`fail:${item}`);
          throw new Error("pack failed");
        }

        events.push(`finish:${item}`);
        return item;
      }),
    ).rejects.toThrow("pack failed");

    expect(events).toEqual([
      "start:slow",
      "start:fail",
      "fail:fail",
      "finish:slow",
    ]);
  });

  it("preserves the runtime package dependency groups and adds the bundled murph shell", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-stage-"));
    const appDir = path.join(rootDir, "app");
    const bundleDir = path.join(rootDir, "bundle");

    temporaryDirectories.push(rootDir);
    await mkdir(path.join(appDir, "dist"), { recursive: true });
    await writeFile(path.join(appDir, "dist", "index.js"), "export const ok = true;\n");
    await writeFile(
      path.join(appDir, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            "@murphai/runtime-state": "workspace:*",
            jose: "^6.2.2",
          },
          engines: {
            node: ">=24.22.1",
          },
          exports: {
            ".": {
              default: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
          },
          license: "Apache-2.0",
          main: "./dist/index.js",
          name: "@murphai/cloudflare-runner",
          optionalDependencies: {
            "optional-external": "^1.0.0",
          },
          private: true,
          type: "module",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await stageHostedRunnerRuntimeArtifact(bundleDir, { appDir });

    const stagedPackageJson = JSON.parse(
      await readFile(path.join(bundleDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(stagedPackageJson.dependencies).toEqual({
      "@murphai/assistant-cli": "workspace:*",
      "@murphai/assistant-engine": "workspace:*",
      "@murphai/clinical-records": "workspace:*",
      "@murphai/core": "workspace:*",
      "@murphai/device-syncd": "workspace:*",
      "@murphai/exercise-library": "workspace:*",
      "@murphai/health-commons": "workspace:*",
      "@murphai/health-metrics": "workspace:*",
      "@murphai/importers": "workspace:*",
      "@murphai/inbox-services": "workspace:*",
      "@murphai/inboxd": "workspace:*",
      "@murphai/messaging-ingress": "workspace:*",
      "@murphai/murph": "workspace:*",
      "@murphai/operator-config": "workspace:*",
      "@murphai/parsers": "workspace:*",
      "@murphai/query": "workspace:*",
      "@murphai/runtime-state": "workspace:*",
      "@murphai/setup-cli": "workspace:*",
      "@murphai/vault-usecases": "workspace:*",
      jose: "^6.2.2",
    });
    expect(stagedPackageJson.optionalDependencies).toEqual({
      "optional-external": "^1.0.0",
    });
    expect(await readFile(path.join(bundleDir, "dist", "index.js"), "utf8")).toBe(
      "export const ok = true;\n",
    );
  });

  it("can stage the runtime artifact without bundle-only workspace dependencies", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-stage-"));
    const appDir = path.join(rootDir, "app");
    const bundleDir = path.join(rootDir, "bundle");

    temporaryDirectories.push(rootDir);
    await mkdir(path.join(appDir, "dist"), { recursive: true });
    await writeFile(path.join(appDir, "dist", "index.js"), "export const ok = true;\n");
    await writeFile(
      path.join(appDir, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            "@murphai/runtime-state": "workspace:*",
            jose: "^6.2.2",
          },
          name: "@murphai/cloudflare-runner",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await stageHostedRunnerRuntimeArtifact(bundleDir, {
      appDir,
      bundleOnlyDependencyNames: [],
    });

    const stagedPackageJson = JSON.parse(
      await readFile(path.join(bundleDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(stagedPackageJson.dependencies).toEqual({
      "@murphai/runtime-state": "workspace:*",
      jose: "^6.2.2",
    });
  });

  it("skips pack preflights when explicitly requested", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-pack-skip-"));
    const appsDir = path.join(rootDir, "apps");
    const binDir = path.join(rootDir, "bin");
    const packageDir = path.join(rootDir, "packages", "contracts");
    const tarballsDir = path.join(rootDir, "tarballs");
    const npmLogPath = path.join(rootDir, "npm.log");
    const pnpmLogPath = path.join(rootDir, "pnpm.log");

    temporaryDirectories.push(rootDir);
    await mkdir(appsDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(path.join(packageDir, "dist"), { recursive: true });
    await mkdir(tarballsDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@murphai/contracts",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(path.join(packageDir, "dist", "index.js"), "export const ok = true;\n");
    await writeFile(path.join(packageDir, "dist", "schemas.js"), "export const schemas = [];\n");
    await writeFile(
      path.join(binDir, "pnpm"),
      [
        "#!/usr/bin/env node",
        "import { appendFileSync } from 'node:fs';",
        `const logPath = ${JSON.stringify(pnpmLogPath)};`,
        "appendFileSync(logPath, `${process.argv.slice(2).join(' ')}\\n`, 'utf8');",
        "if (process.argv.slice(2).join(' ') === 'store path --silent') {",
        `  console.log(${JSON.stringify(path.join(rootDir, "pnpm-store"))});`,
        "}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(binDir, "npm"),
      [
        "#!/usr/bin/env node",
        "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
        "import path from 'node:path';",
        "const args = process.argv.slice(2);",
        `const logPath = ${JSON.stringify(npmLogPath)};`,
        "appendFileSync(logPath, `${args.join(' ')}\\n`, 'utf8');",
        "const destinationIndex = args.indexOf('--pack-destination');",
        "const destination = destinationIndex >= 0 ? args[destinationIndex + 1] : null;",
        "if (!destination) process.exit(2);",
        "mkdirSync(destination, { recursive: true });",
        "writeFileSync(path.join(destination, 'fake-package.tgz'), '', 'utf8');",
      ].join("\n"),
      "utf8",
    );
    await chmod(path.join(binDir, "pnpm"), 0o755);
    await chmod(path.join(binDir, "npm"), 0o755);

    vi.stubEnv("PATH", `${binDir}${path.delimiter}${process.env.PATH ?? ""}`);

    const tarballs = await packWorkspacePackageArtifacts(
      ["@murphai/contracts"],
      tarballsDir,
      {
        repoRoot: rootDir,
        skipPreflights: true,
      },
    );
    const contractsTarball = tarballs.get("@murphai/contracts");

    if (!contractsTarball) {
      throw new Error("Contracts tarball was not packed.");
    }

    const pnpmLog = await readOptionalText(pnpmLogPath);
    expect(["", "store path --silent\n"]).toContain(pnpmLog);
    await expect(readFile(npmLogPath, "utf8")).resolves.toBe(
      "pack --ignore-scripts --silent --pack-destination "
        + `${path.join(tarballsDir, "01-_murphai_contracts")}\n`,
    );
  });

  it("includes the workspace package name when npm pack fails", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-pack-fail-"));
    const appsDir = path.join(rootDir, "apps");
    const binDir = path.join(rootDir, "bin");
    const packageDir = path.join(rootDir, "packages", "runtime-state");
    const tarballsDir = path.join(rootDir, "tarballs");

    temporaryDirectories.push(rootDir);
    await mkdir(appsDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await mkdir(tarballsDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@murphai/runtime-state",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(binDir, "npm"),
      "#!/usr/bin/env node\nprocess.exit(1);\n",
      "utf8",
    );
    await chmod(path.join(binDir, "npm"), 0o755);

    vi.stubEnv("PATH", `${binDir}${path.delimiter}${process.env.PATH ?? ""}`);

    await expect(
      packWorkspacePackageArtifacts(
        ["@murphai/runtime-state"],
        tarballsDir,
        {
          repoRoot: rootDir,
          skipPreflights: true,
        },
      ),
    ).rejects.toThrow("Failed to pack @murphai/runtime-state.");
  });

  it("packs the compact Health Commons runtime artifacts for hosted runner installs", async () => {
    const tarballsDir = await mkdtemp(path.join(tmpdir(), "murph-runner-pack-"));

    temporaryDirectories.push(tarballsDir);
    await buildHostedRunnerWorkspaceArtifacts(
      ["@murphai/health-commons"],
      { repoRoot },
    );

    const tarballs = await packWorkspacePackageArtifacts(
      [
        "@murphai/health-commons",
        "@murphai/contracts",
        "@murphai/health-metrics",
      ],
      tarballsDir,
      { repoRoot },
    );
    const healthCommonsTarball = tarballs.get("@murphai/health-commons");

    if (!healthCommonsTarball) {
      throw new Error("Health Commons tarball was not packed.");
    }

    const { stdout } = await execFileAsync("tar", [
      "-tzf",
      healthCommonsTarball,
    ]);
    const entries = stdout.split("\n");

    expect(entries).toContain("package/dist/index.js");
    expect(entries).toContain("package/dist/runtime.js");
    for (const artifactName of healthCommonsRuntimeArtifactNames) {
      expect(entries).toContain(`package/generated/${artifactName}`);
    }
    for (const retiredArtifactName of [
      "catalog.json",
      "protocol-index.json",
      "protocol-run-specs.json",
      "protocol-family-graph.json",
    ]) {
      expect(entries).not.toContain(`package/generated/${retiredArtifactName}`);
    }
    expect(entries).toContain("package/package.json");
    expect(
      entries.filter((entry) =>
        entry.startsWith("package/generated/web/") && !entry.endsWith("/")
      ),
    ).toEqual(["package/generated/web/browse/goals.json"]);
    expect(entries.some((entry) => entry.startsWith("package/content/"))).toBe(false);

    const validatorBundleDir = path.join(tarballsDir, "validator-bundle");
    const installedHealthCommonsDir = path.join(
      validatorBundleDir,
      "node_modules",
      "@murphai",
      "health-commons",
    );
    await mkdir(installedHealthCommonsDir, { recursive: true });
    await execFileAsync("tar", [
      "-xzf",
      healthCommonsTarball,
      "-C",
      installedHealthCommonsDir,
      "--strip-components=1",
    ]);
    await prepareRunnerBundleValidationFixture(validatorBundleDir);
    await expect(
      assertPreparedRunnerBundle({
        appDir: path.join(repoRoot, "apps", "cloudflare"),
        repoRoot,
        runnerBundleDir: validatorBundleDir,
      }),
    ).resolves.toMatchObject({
      buildSkipped: false,
      includeBundleOnlyDependencies: true,
    });

    const generatedWebDir = path.join(
      installedHealthCommonsDir,
      "generated",
      "web",
    );
    const obsoleteRoutesDir = path.join(generatedWebDir, "routes");
    await mkdir(obsoleteRoutesDir, { recursive: true });
    await writeFile(path.join(obsoleteRoutesDir, "index.json"), "{}\n", "utf8");
    await expect(
      assertPreparedRunnerBundle({
        appDir: path.join(repoRoot, "apps", "cloudflare"),
        repoRoot,
        runnerBundleDir: validatorBundleDir,
      }),
    ).rejects.toThrow(
      "must not ship unexpected Health Commons generated web artifact generated/web/routes",
    );

    await rm(obsoleteRoutesDir, { recursive: true });
    await writeFile(
      path.join(generatedWebDir, "browse", "experiments.json"),
      "{}\n",
      "utf8",
    );
    await expect(
      assertPreparedRunnerBundle({
        appDir: path.join(repoRoot, "apps", "cloudflare"),
        repoRoot,
        runnerBundleDir: validatorBundleDir,
      }),
    ).rejects.toThrow(
      "must not ship unexpected Health Commons generated web artifact generated/web/browse/experiments.json",
    );

    const extractDir = path.join(tarballsDir, "health-commons-extract");
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("tar", [
      "-xzf",
      healthCommonsTarball,
      "-C",
      extractDir,
      "package/generated/biomarker-desired-directions.json",
      "package/generated/web/browse/goals.json",
    ]);
    const biomarkerDesiredDirectionsRaw = await readFile(
      path.join(
        extractDir,
        "package",
        "generated",
        "biomarker-desired-directions.json",
      ),
      "utf8",
    );
    const goalIndexRaw = await readFile(
      path.join(
        extractDir,
        "package",
        "generated",
        "web",
        "browse",
        "goals.json",
      ),
      "utf8",
    );
    const biomarkerDesiredDirections: unknown = JSON.parse(
      biomarkerDesiredDirectionsRaw,
    );
    const goalIndex: unknown = JSON.parse(goalIndexRaw);

    expect(findGoalArtifactEntry(goalIndex, "goal_template:improve-deep-sleep"))
      .toMatchObject({
        revision: {
          pageRevisionId: expect.stringMatching(/^sha256:/u),
          workflowSpecRevisionId: expect.stringMatching(/^sha256:/u),
        },
        routeId: "improve-deep-sleep",
        sources: expect.arrayContaining([
          expect.objectContaining({
            label: expect.any(String),
            url: expect.stringMatching(/^https?:\/\//u),
          }),
        ]),
        startPrompt: "Hey Murph, help me improve my deep sleep.",
      });

    expect(
      findBiomarkerDesiredDirectionEntry(
        biomarkerDesiredDirections,
        "biomarker:resting-heart-rate",
      ),
    ).toEqual({
      desiredDirection: "lower_or_stable",
      key: "biomarker:resting-heart-rate",
    });
  });

  it("packs the runner CLI without its public bundled dependency payload", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-cli-pack-"));
    const packageDir = path.join(rootDir, "packages", "cli");
    const assistantEngineDir = path.join(rootDir, "packages", "assistant-engine");
    const healthCommonsDir = path.join(rootDir, "packages", "health-commons");
    const tarballsDir = path.join(rootDir, "tarballs");

    temporaryDirectories.push(rootDir);
    await mkdir(path.join(rootDir, "apps"), { recursive: true });
    await mkdir(path.join(packageDir, "dist"), { recursive: true });
    await mkdir(assistantEngineDir, { recursive: true });
    await mkdir(path.join(healthCommonsDir, "dist"), { recursive: true });
    await mkdir(path.join(healthCommonsDir, "generated"), { recursive: true });
    await mkdir(tarballsDir, { recursive: true });
    await writeFile(path.join(packageDir, "dist", "bin.js"), "#!/usr/bin/env node\n", "utf8");
    await writeFile(path.join(packageDir, "README.md"), "readme\n", "utf8");
    await writeFile(path.join(packageDir, "CHANGELOG.md"), "changelog\n", "utf8");
    await writeFile(path.join(packageDir, "config.schema.json"), "{}\n", "utf8");
    await writeFile(path.join(packageDir, "LICENSE"), "license\n", "utf8");
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@murphai/murph",
          version: "1.2.3",
          type: "module",
          bin: {
            murph: "dist/bin.js",
            "vault-cli": "dist/bin.js",
          },
          bundleDependencies: [
            "@murphai/assistant-engine",
            "@murphai/health-commons",
          ],
          dependencies: {
            "@murphai/assistant-engine": "workspace:*",
            "@murphai/health-commons": "workspace:*",
          },
          files: [
            "dist",
            "README.md",
            "CHANGELOG.md",
            "config.schema.json",
            "LICENSE",
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(assistantEngineDir, "package.json"),
      `${JSON.stringify({
        name: "@murphai/assistant-engine",
        version: "1.0.0",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(healthCommonsDir, "package.json"),
      `${JSON.stringify({
        name: "@murphai/health-commons",
        version: "1.0.0",
      })}\n`,
      "utf8",
    );
    await writeFile(path.join(healthCommonsDir, "dist", "index.js"), "export const ok = true;\n", "utf8");
    await writeFile(path.join(healthCommonsDir, "dist", "runtime.js"), "export const runtime = true;\n", "utf8");
    await writeMinimalHealthCommonsRuntimeArtifacts(path.join(healthCommonsDir, "generated"));
    await writeFile(path.join(healthCommonsDir, "README.md"), "readme\n", "utf8");
    await writeFile(path.join(healthCommonsDir, "LICENSE"), "license\n", "utf8");

    const tarballs = await packWorkspacePackageArtifacts(
      [
        "@murphai/murph",
        "@murphai/assistant-engine",
        "@murphai/health-commons",
      ],
      tarballsDir,
      {
        repoRoot: rootDir,
        skipPreflights: true,
      },
    );
    const cliTarball = tarballs.get("@murphai/murph");

    if (!cliTarball) {
      throw new Error("CLI tarball was not packed.");
    }

    const extractDir = path.join(rootDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", cliTarball, "-C", extractDir]);
    const packedPackageJson = JSON.parse(
      await readFile(path.join(extractDir, "package", "package.json"), "utf8"),
    ) as {
      bin?: Record<string, string>;
      bundleDependencies?: string[];
    };

    expect(packedPackageJson.bin).toEqual({
      murph: "dist/bin.js",
      "vault-cli": "dist/bin.js",
    });
    expect(packedPackageJson.bundleDependencies).toBeUndefined();
    await expect(
      readFile(path.join(extractDir, "package", "node_modules", "@murphai", "health-commons", "package.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rewrites transitive workspace dependency specs inside packed runner packages", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-transitive-pack-"));
    const runtimePackageDir = path.join(rootDir, "packages", "assistant-runtime");
    const enginePackageDir = path.join(rootDir, "packages", "assistant-engine");
    const gatewayPackageDir = path.join(rootDir, "packages", "gateway-core");
    const bundleDir = path.join(rootDir, "bundle");
    const tarballsDir = path.join(rootDir, "tarballs");

    temporaryDirectories.push(rootDir);
    await mkdir(path.join(rootDir, "apps"), { recursive: true });
    await mkdir(bundleDir, { recursive: true });
    await mkdir(path.join(runtimePackageDir, "dist"), { recursive: true });
    await mkdir(enginePackageDir, { recursive: true });
    await mkdir(gatewayPackageDir, { recursive: true });
    await mkdir(tarballsDir, { recursive: true });
    await writeFile(
      path.join(runtimePackageDir, "dist", "index.js"),
      "export const ok = true;\n",
      "utf8",
    );
    await writeFile(path.join(runtimePackageDir, "README.md"), "readme\n", "utf8");
    await writeFile(
      path.join(runtimePackageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@murphai/assistant-runtime",
          version: "1.0.0",
          type: "module",
          files: ["dist", "README.md"],
          dependencies: {
            "@murphai/assistant-engine": "workspace:*",
          },
          optionalDependencies: {
            "@murphai/gateway-core": "workspace:*",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(enginePackageDir, "package.json"),
      `${JSON.stringify({
        name: "@murphai/assistant-engine",
        version: "1.2.3",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(gatewayPackageDir, "package.json"),
      `${JSON.stringify({
        name: "@murphai/gateway-core",
        version: "2.3.4",
      })}\n`,
      "utf8",
    );

    const tarballs = await packWorkspacePackageArtifacts(
      [
        "@murphai/assistant-runtime",
        "@murphai/assistant-engine",
        "@murphai/gateway-core",
      ],
      tarballsDir,
      {
        dependencySpecRoot: bundleDir,
        repoRoot: rootDir,
        skipPreflights: true,
      },
    );
    const runtimeTarball = tarballs.get("@murphai/assistant-runtime");

    if (!runtimeTarball) {
      throw new Error("Assistant runtime tarball was not packed.");
    }

    const extractDir = path.join(rootDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", runtimeTarball, "-C", extractDir]);
    const packedPackageJson = JSON.parse(
      await readFile(path.join(extractDir, "package", "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(packedPackageJson.dependencies).toEqual({
      "@murphai/assistant-engine":
        "file:../tarballs/02-_murphai_assistant-engine/murphai-assistant-engine-1.2.3.tgz",
    });
    expect(packedPackageJson.optionalDependencies).toEqual({
      "@murphai/gateway-core":
        "file:../tarballs/03-_murphai_gateway-core/murphai-gateway-core-2.3.4.tgz",
    });
  });

  it("fails closed when a packed runner package depends on a workspace package without a sibling tarball", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-missing-transitive-pack-"));
    const runtimePackageDir = path.join(rootDir, "packages", "assistant-runtime");
    const enginePackageDir = path.join(rootDir, "packages", "assistant-engine");
    const bundleDir = path.join(rootDir, "bundle");
    const tarballsDir = path.join(rootDir, "tarballs");

    temporaryDirectories.push(rootDir);
    await mkdir(path.join(rootDir, "apps"), { recursive: true });
    await mkdir(bundleDir, { recursive: true });
    await mkdir(path.join(runtimePackageDir, "dist"), { recursive: true });
    await mkdir(enginePackageDir, { recursive: true });
    await mkdir(tarballsDir, { recursive: true });
    await writeFile(path.join(runtimePackageDir, "dist", "index.js"), "export const ok = true;\n");
    await writeFile(path.join(runtimePackageDir, "README.md"), "readme\n", "utf8");
    await writeFile(
      path.join(runtimePackageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@murphai/assistant-runtime",
          version: "1.0.0",
          files: ["dist", "README.md"],
          dependencies: {
            "@murphai/assistant-engine": "workspace:*",
            "@murphai/missing-private": "workspace:*",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(enginePackageDir, "package.json"),
      `${JSON.stringify({
        name: "@murphai/assistant-engine",
        version: "1.2.3",
      })}\n`,
      "utf8",
    );

    await expect(
      packWorkspacePackageArtifacts(
        ["@murphai/assistant-runtime", "@murphai/assistant-engine"],
        tarballsDir,
        {
          dependencySpecRoot: bundleDir,
          repoRoot: rootDir,
          skipPreflights: true,
        },
      ),
    ).rejects.toThrow(
      "@murphai/assistant-runtime depends on workspace package @murphai/missing-private, but no sibling runner tarball was prepared for that dependency.",
    );
  });

  it("packs the Contracts runtime entrypoint for hosted runner installs", async () => {
    const tarballsDir = await mkdtemp(path.join(tmpdir(), "murph-runner-pack-"));

    temporaryDirectories.push(tarballsDir);

    const tarballs = await packWorkspacePackageArtifacts(
      ["@murphai/contracts"],
      tarballsDir,
      { repoRoot },
    );
    const contractsTarball = tarballs.get("@murphai/contracts");

    if (!contractsTarball) {
      throw new Error("Contracts tarball was not packed.");
    }

    const { stdout } = await execFileAsync("tar", [
      "-tzf",
      contractsTarball,
      "package/dist/index.js",
      "package/dist/schemas.js",
      "package/package.json",
    ]);
    const entries = stdout.split("\n");

    expect(entries).toContain("package/dist/index.js");
    expect(entries).toContain("package/dist/schemas.js");
    expect(entries).toContain("package/package.json");
  });
});

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return "";
    }

    throw error;
  }
}

async function writeMinimalHealthCommonsRuntimeArtifacts(generatedDir: string): Promise<void> {
  await mkdir(generatedDir, { recursive: true });
  await mkdir(path.join(generatedDir, "web", "browse"), { recursive: true });
  await writeFile(
    path.join(generatedDir, "knowledge.sqlite"),
    Buffer.from("SQLite format 3\0fixture"),
  );
  await writeFile(
    path.join(generatedDir, "biomarker-desired-directions.json"),
    `${JSON.stringify({
      biomarkers: [],
      catalogHash: "sha256:test",
      schemaVersion: "murph.commons.biomarker-desired-directions.v1",
    })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "web", "browse", "goals.json"),
    `${JSON.stringify({
      catalogHash: "sha256:test",
      goals: [],
      schemaVersion: "murph.commons.web.goal-index.v2",
    })}\n`,
    "utf8",
  );
}

async function prepareRunnerBundleValidationFixture(bundleDir: string): Promise<void> {
  const nodeModulesDir = path.join(bundleDir, "node_modules");
  const workspacePackageNames = resolveHostedRunnerWorkspacePackageNames({
    includeBundleOnlyDependencies: true,
  });

  await mkdir(path.join(bundleDir, "dist"), { recursive: true });
  await mkdir(path.join(bundleDir, "dist-bundled"), { recursive: true });
  await mkdir(path.join(nodeModulesDir, ".bin"), { recursive: true });
  await writeFile(
    path.join(bundleDir, "package.json"),
    `${JSON.stringify({
      name: hostedRunnerRuntimePackageName,
      version: "1.0.0",
    })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "dist", "container-entrypoint.js"),
    "export {};\n",
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "dist-bundled", "container-entrypoint.js"),
    "export {};\n",
    "utf8",
  );
  await writeFile(
    path.join(bundleDir, "dist", "index.js"),
    "export {};\n",
    "utf8",
  );

  for (const packageName of workspacePackageNames) {
    if (
      packageName === hostedRunnerRuntimePackageName
      || packageName === "@murphai/health-commons"
    ) {
      continue;
    }

    const packageDir = path.join(nodeModulesDir, ...packageName.split("/"));
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify({ name: packageName, version: "1.0.0" })}\n`,
      "utf8",
    );
  }

  const assistantEngineDir = path.join(
    nodeModulesDir,
    "@murphai",
    "assistant-engine",
  );
  await mkdir(path.join(assistantEngineDir, "skills"), { recursive: true });
  await mkdir(path.join(assistantEngineDir, "dist", "assistant"), {
    recursive: true,
  });
  await writeFile(
    path.join(
      assistantEngineDir,
      "dist",
      "assistant",
      "cli-surface-contract.generated.json",
    ),
    "{}\n",
    "utf8",
  );
  await writeFile(path.join(nodeModulesDir, ".bin", "murph"), "#!/bin/sh\n", "utf8");
  await writeFile(
    path.join(nodeModulesDir, ".bin", "vault-cli"),
    "#!/bin/sh\n",
    "utf8",
  );

  await writeRunnerBundleManifest(bundleDir, {
    appDir: path.join(repoRoot, "apps", "cloudflare"),
    releaseSha: "0123456789abcdef0123456789abcdef01234567",
    repoRoot,
  });
}

function findGoalArtifactEntry(artifact: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(artifact) || !Array.isArray(artifact.goals)) {
    return null;
  }

  return artifact.goals.find((entity) =>
    isRecord(entity) && entity.key === key
  ) ?? null;
}

function findBiomarkerDesiredDirectionEntry(
  artifact: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!isRecord(artifact) || !Array.isArray(artifact.biomarkers)) {
    return null;
  }

  return artifact.biomarkers.find((entity) =>
    isRecord(entity) &&
      entity.key === key
  ) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
