import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { describe, expect, it } from "vitest";
import {
  buildHostedWranglerDeployConfig,
} from "../scripts/deploy-automation/wrangler-config.ts";
import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBuildPackageNames,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerWorkspacePackageNames,
  publishedMurphBundledExternalPackageNames,
  publishedMurphBundledWorkspacePackageNames,
  runnerBundleDirectoryName,
} from "../scripts/runner-bundle-contract.js";
import {
  hostedLocalRunnerBaseImageTag,
} from "../scripts/runner-base-image-contract.ts";

const runnerDockerSmokeFinallyCleanupBlock = `} finally {
    await rm(SMOKE_BUNDLE_DIR, { force: true, recursive: true });
    await removeHostedRunnerFinalImageBestEffort();
  }`;

const runnerPythonPathFinallyCleanupBlock = `} finally {
    if (containerId !== null) {
      await removeContainer(containerId);
    }
    await removeHostedRunnerFinalImageBestEffort();
  }`;

const hostedRunnerFlexModelSlugs = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

function createDeployEnvironment() {
  return {
    allowedRunnerSecretKeys: null,
    bundlesBucketName: "bundles",
    bundlesPreviewBucketName: "bundles-preview",
    platformEnvelopeKeyId: "v1",
    compatibilityDate: "2026-03-27",
    containerInstanceType: {
      disk_mb: 6000,
      memory_mib: 6144,
      vcpu: 2,
    },
    containerMaxInstances: 1000,
    logHeadSamplingRate: 1,
    maxEventAttempts: "3",
    retryDelayMs: "30000",
    runnerCommitTimeoutMs: "45000",
    runnerReadyTimeoutMs: "20000",
    traceHeadSamplingRate: 0.1,
    webControlTimeoutMs: "30000",
    workerName: "murph-hosted",
    workerVars: {
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bundles",
    },
  }
}

describe("hosted runner container image contract", () => {
  it("keeps runner bundle assembly app-owned and materializes a runtime-only leaf artifact", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );
    const workspaceArtifactsScript = await readFile(
      new URL("../scripts/runner-bundle/workspace-artifacts.ts", import.meta.url),
      "utf8",
    );
    const runtimeShapeScript = await readFile(
      new URL("../scripts/runner-bundle/runtime-shape.ts", import.meta.url),
      "utf8",
    );
    const finalBundleScript = await readFile(
      new URL("../scripts/runner-bundle/final-bundle.ts", import.meta.url),
      "utf8",
    );

    expect(bundleAssemblyScript).toContain("const runnerBundleDeployRoot = path.join(");
    expect(bundleAssemblyScript).toContain("const workspaceArtifactLockHeldEnv = ");
    expect(bundleAssemblyScript).toContain("rerunUnderWorkspaceArtifactLockIfNeeded();");
    expect(bundleAssemblyScript).toContain("run-with-workspace-artifact-lock.mjs");
    expect(bundleAssemblyScript).toContain('const shouldSkipBuild = process.argv.includes("--skip-build");');
    expect(bundleAssemblyScript).toContain(
      'import { resolveCloudflareDeployPaths } from "./deploy-automation.js";',
    );
    expect(bundleAssemblyScript).toContain(
      '} from "./runner-bundle-contract.js";',
    );
    expect(bundleAssemblyScript).toContain(
      'import {\n  assertInstalledRunnerHealthCommonsRuntimeImport,\n  installPackedRunnerDependencies,\n} from "./runner-bundle/dependency-install.js";',
    );
    expect(bundleAssemblyScript).toContain(
      'import { materializeFinalRunnerBundle } from "./runner-bundle/final-bundle.js";',
    );
    expect(bundleAssemblyScript).not.toContain(
      'import { runPnpmCommand } from "./runner-bundle/process.js";',
    );
    expect(bundleAssemblyScript).toContain(
      'import {\n  pruneBundledRunnerDependencies,\n  pruneRunnerBundle,\n  rewriteRuntimeBinWrappers,\n  rewriteRuntimePackageManifest,\n} from "./runner-bundle/runtime-shape.js";',
    );
    expect(bundleAssemblyScript).toContain(
      'import {\n  buildHostedRunnerWorkspaceArtifacts,\n  packWorkspacePackageArtifacts,\n  stageHostedRunnerRuntimeArtifact,\n} from "./runner-bundle/workspace-artifacts.js";',
    );
    expect(bundleAssemblyScript).toContain("hostedRunnerRuntimePackageName,");
    expect(bundleAssemblyScript).toContain("runnerBundleDirectoryName,");
    expect(bundleAssemblyScript).toContain("if (!shouldSkipBuild) {");
    expect(bundleAssemblyScript).toContain(
      "await buildHostedRunnerWorkspaceArtifacts(\n        [...hostedRunnerBuildPackageNames, hostedRunnerRuntimePackageName],\n        { repoRoot },\n      );",
    );
    expect(bundleAssemblyScript).not.toContain(
      "await runPnpmCommand([\"build\"], { cwd: appDir });",
    );
    expect(bundleAssemblyScript).toContain(
      "await stageHostedRunnerRuntimeArtifact(stagingBundleDir, {",
    );
    expect(bundleAssemblyScript).toContain("appDir,");
    expect(bundleAssemblyScript).toContain(
      "bundleOnlyDependencyNames: includeBundleOnlyDependencies",
    );
    expect(bundleAssemblyScript).toContain(
      "await packWorkspacePackageArtifacts(",
    );
    expect(bundleAssemblyScript).toContain(
      "await installPackedRunnerDependencies(",
    );
    expect(bundleAssemblyScript).toContain(
      "await assertInstalledRunnerHealthCommonsRuntimeImport(stagingBundleDir);",
    );
    expect(workspaceArtifactsScript).toContain(
      "const sortedPackageNames = await topologicallySortWorkspacePackageNames(",
    );
    expect(workspaceArtifactsScript).toContain(
      "buildHostedRunnerWorkspaceBuildArgs(sortedPackageNames)",
    );
    expect(workspaceArtifactsScript).toContain(
      "`--workspace-concurrency=${resolvePositiveIntegerEnv(",
    );
    expect(workspaceArtifactsScript).toContain(
      '...packageNames.flatMap((packageName) => ["--filter", packageName]),',
    );
    expect(workspaceArtifactsScript).toContain(
      '"MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY"',
    );
    expect(workspaceArtifactsScript).toContain(
      "await mapWithConcurrency(",
    );
    expect(workspaceArtifactsScript).toContain(
      "await runWorkspacePackagePackPreflights(packageNames, input);",
    );
    expect(workspaceArtifactsScript).toContain(
      '"MURPH_RUNNER_BUNDLE_PACK_CONCURRENCY"',
    );
    expect(workspaceArtifactsScript).toContain(
      '"--silent"',
    );
    expect(workspaceArtifactsScript).toContain(
      "function listWorkspaceDependencyNames(",
    );
    expect(workspaceArtifactsScript).toContain(
      "Detected a cycle while ordering runner bundle builds",
    );
    expect(bundleAssemblyScript).toContain("hostedRunnerBuildPackageNames");
    expect(bundleAssemblyScript).toContain("hostedRunnerWorkspacePackageNames,");
    expect(bundleAssemblyScript).toContain(
      "await materializeFinalRunnerBundle(",
    );
    expect(finalBundleScript).toContain(
      "await mkdir(finalParentDir, { recursive: true });",
    );
    expect(bundleAssemblyScript).toContain(
      "await pruneRunnerBundle(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      "await rewriteRuntimePackageManifest(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      "await rewriteRuntimeBinWrappers(stagingBundleDir);",
    );
    expect(bundleAssemblyScript).toContain(
      'import { bundleInstalledVaultCliBinary } from "./runner-bundle/bundle-cli.js";',
    );
    // The vault-cli esbuild step retargets the freshly rewritten bin wrappers
    // at the bundle, so it must run after rewriteRuntimeBinWrappers and before
    // the staging dir is materialized into the final bundle.
    const rewriteBinWrappersCallIndex = bundleAssemblyScript.indexOf(
      "await rewriteRuntimeBinWrappers(stagingBundleDir);",
    );
    const bundleVaultCliCallIndex = bundleAssemblyScript.indexOf(
      "await bundleInstalledVaultCliBinary(stagingBundleDir);",
    );
    const bundleEntrypointCallIndex = bundleAssemblyScript.indexOf(
      "await bundleRunnerContainerEntrypoint(stagingBundleDir);",
    );
    const pruneBundledDependenciesCallIndex = bundleAssemblyScript.indexOf(
      "await pruneBundledRunnerDependencies(stagingBundleDir);",
    );
    const materializeFinalBundleCallIndex = bundleAssemblyScript.indexOf(
      "await materializeFinalRunnerBundle(",
    );
    expect(rewriteBinWrappersCallIndex).toBeGreaterThan(-1);
    expect(bundleVaultCliCallIndex).toBeGreaterThan(rewriteBinWrappersCallIndex);
    expect(bundleEntrypointCallIndex).toBeGreaterThan(bundleVaultCliCallIndex);
    expect(pruneBundledDependenciesCallIndex).toBeGreaterThan(
      bundleEntrypointCallIndex,
    );
    expect(materializeFinalBundleCallIndex).toBeGreaterThan(
      pruneBundledDependenciesCallIndex,
    );
    expect(runtimeShapeScript).toContain(
      'removeBundlePathIfPresent(path.join(bundleDir, "README.md"))',
    );
    expect(runtimeShapeScript).toContain(
      'removeBundlePathIfPresent(path.join(bundleDir, "DEPLOY.md"))',
    );
    expect(runtimeShapeScript).toContain(
      'removeBundlePathIfPresent(path.join(bundleDir, "LICENSE"))',
    );
    expect(runtimeShapeScript).toContain(
      'entryName === ".pnpm-workspace-state-v1.json"',
    );
    expect(runtimeShapeScript).toContain('entryName === ".modules.yaml"');
    expect(runtimeShapeScript).toContain('entryName === "pnpm-lock.yaml"');
    expect(runtimeShapeScript).toContain('entryPath.endsWith(".d.ts")');
    expect(runtimeShapeScript).toContain('entryPath.endsWith(".map")');
    expect(runtimeShapeScript).toContain('entryPath.endsWith(".tsbuildinfo")');
    expect(bundleAssemblyScript).not.toContain("loadWorkspacePackageIndex");
    expect(bundleAssemblyScript).not.toContain("collectWorkspaceRuntimeClosure");
    expect(bundleAssemblyScript).not.toContain("collectWorkspacePackageNamesFromRoots");
    expect(bundleAssemblyScript).not.toContain("workspaceRootDirs");
    expect(bundleAssemblyScript).not.toContain("extractTarball(");
    expect(bundleAssemblyScript).not.toContain("build:workspace:incremental");
    expect(bundleAssemblyScript).not.toContain("stageRunnerVaultCliArtifact(");
    expect(bundleAssemblyScript).not.toContain("buildRunnerVaultCliArtifactPackageJson(");
    expect(bundleAssemblyScript).not.toContain("runnerVaultCliArtifact");
    expect(bundleAssemblyScript).not.toContain('../src/deploy-automation.js');
    expect(bundleAssemblyScript).not.toContain('../src/runner-bundle-contract.js');
    expect(bundleAssemblyScript).not.toContain('"--legacy"');
    expect(bundleAssemblyScript).not.toContain('"deploy",');

    await expect(
      access(new URL("../src/deploy-automation.ts", import.meta.url)),
    ).rejects.toThrow();
    await expect(
      access(new URL("../src/deploy-preflight.ts", import.meta.url)),
    ).rejects.toThrow();
    await expect(
      access(new URL("../src/r2-lifecycle.ts", import.meta.url)),
    ).rejects.toThrow();
    await expect(
      access(new URL("../src/runner-bundle-contract.ts", import.meta.url)),
    ).rejects.toThrow();
  });

  it("ships the hosted-local e2e ffmpeg stub behind the bundle test flag without whisper stubs", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );

    // The shared CI bundle job sets MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN=1
    // so the linq-webhook media E2E can drain fixture audio through the ffmpeg
    // stub; the whisper-cli/ggml stub lane is deleted (Worker-mediated
    // Workers AI transcription replaces it).
    expect(bundleAssemblyScript).toContain(
      'if (process.env.MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN === "1") {',
    );
    expect(bundleAssemblyScript).toContain(
      "await writeHostedLocalE2eParserToolchain(runnerBundleDeployRoot);",
    );
    expect(bundleAssemblyScript).toContain(
      'path.join(bundleRoot, "test-parser-toolchain")',
    );
    expect(bundleAssemblyScript).toContain(
      'await writeExecutable(path.join(toolchainRoot, "ffmpeg"), [',
    );
    expect(bundleAssemblyScript.toLowerCase()).not.toContain("whisper");
    expect(bundleAssemblyScript).not.toContain("ggml");
  });

  it("excludes build-only workspace packages from the runtime package manifest", async () => {
    const packageJson = await readRunnerPackageManifest();
    const runtimeDependencyNames = Object.keys(packageJson.dependencies ?? {});
    const buildOnlyWorkspacePackageNames = hostedRunnerBuildPackageNames.filter(
      (packageName) => !hostedRunnerWorkspacePackageNames.includes(packageName),
    );

    for (const dependencyName of buildOnlyWorkspacePackageNames) {
      expect(runtimeDependencyNames).not.toContain(dependencyName);
    }

    const runtimeWorkspacePackageNameSet = new Set(hostedRunnerWorkspacePackageNames);
    for (const dependencyName of hostedRunnerBundleOnlyDependencyNames.filter(
      (name) => !runtimeWorkspacePackageNameSet.has(name),
    )) {
      expect(runtimeDependencyNames).not.toContain(dependencyName);
    }
  });

  it("prunes pnpm workspace metadata recursively from the staged runner bundle", async () => {
    const runtimeShapeScript = await readFile(
      new URL("../scripts/runner-bundle/runtime-shape.ts", import.meta.url),
      "utf8",
    );

    expect(runtimeShapeScript).toContain("await pruneNonRuntimeFiles(bundleDir);");
    expect(runtimeShapeScript).toContain("await walkBundleFiles(rootDir, async (entryPath) => {");
    expect(runtimeShapeScript).toContain(
      'entryName === ".pnpm-workspace-state-v1.json"',
    );
  });

  it("describes the runtime artifact and explicit build/runtime closures", () => {
    const hostedRunnerWorkspacePackageNameSet = new Set<string>(
      hostedRunnerWorkspacePackageNames,
    );
    const runtimeDependencyNames = [...new Set([
      ...Object.keys(readRunnerPackageManifestSync().dependencies ?? {}),
      ...hostedRunnerBundleOnlyDependencyNames,
    ])];
    const runtimeDependencies = Object.fromEntries(
      runtimeDependencyNames.map((dependencyName) => [dependencyName, "1.2.3"]),
    ) as Record<string, string>;
    const runtimePackageJson = buildHostedRunnerRuntimeArtifactPackageJson({
      dependencies: runtimeDependencies,
      engines: {
        node: ">=24.14.1",
      },
      exports: {
        ".": "./dist/index.js",
      },
      license: "Apache-2.0",
      main: "./dist/index.js",
      version: "0.0.0",
    });

    expect(runnerBundleDirectoryName).toBe("runner-bundle");
    expect(Object.keys(runtimeDependencies).sort()).toEqual(
      runtimeDependencyNames.sort(),
    );
    expect(hostedRunnerWorkspacePackageNames).toEqual([
      "@murphai/assistant-cli",
      "@murphai/assistant-engine",
      "@murphai/assistant-runtime",
      "@murphai/assistantd",
      "@murphai/clinical-records",
      "@murphai/cloudflare-hosted-control",
      "@murphai/contracts",
      "@murphai/core",
      "@murphai/device-syncd",
      "@murphai/exercise-library",
      "@murphai/gateway-core",
      "@murphai/health-commons",
      "@murphai/health-metrics",
      "@murphai/hosted-execution",
      "@murphai/importers",
      "@murphai/inbox-services",
      "@murphai/inboxd",
      "@murphai/messaging-ingress",
      "@murphai/murph",
      "@murphai/operator-config",
      "@murphai/parsers",
      "@murphai/query",
      "@murphai/runtime-state",
      "@murphai/setup-cli",
      "@murphai/vault-usecases",
    ]);
    expect(hostedRunnerBuildPackageNames).toEqual([
      ...hostedRunnerWorkspacePackageNames,
      ...publishedMurphBundledWorkspacePackageNames.filter(
        (packageName) => !hostedRunnerWorkspacePackageNameSet.has(packageName),
      ),
    ].sort());
    expect(new Set(hostedRunnerBuildPackageNames)).toEqual(
      new Set([
        ...hostedRunnerWorkspacePackageNames,
        ...publishedMurphBundledWorkspacePackageNames,
      ]),
    );
    expect(runtimePackageJson).toEqual({
      name: "@murphai/cloudflare-runner",
      private: true,
      type: "module",
      version: "0.0.0",
      license: "Apache-2.0",
      main: "./dist/index.js",
      exports: {
        ".": "./dist/index.js",
      },
      engines: {
        node: ">=24.14.1",
      },
      dependencies: runtimeDependencies,
    });
  });

  it("builds every bundled private workspace dependency that the published murph package packs", async () => {
    const murphPackageJson = JSON.parse(await readFile(
      new URL("../../../packages/cli/package.json", import.meta.url),
      "utf8",
    )) as {
      bundleDependencies?: string[];
    };

    expect(murphPackageJson.bundleDependencies).toEqual([
      ...publishedMurphBundledWorkspacePackageNames,
      ...publishedMurphBundledExternalPackageNames,
    ].sort());
    expect(publishedMurphBundledExternalPackageNames).toEqual(["incur", "ink"]);
    expect(hostedRunnerBuildPackageNames).not.toContain("incur");
    expect(hostedRunnerBuildPackageNames).not.toContain("ink");

    for (const dependencyName of publishedMurphBundledWorkspacePackageNames) {
      expect(hostedRunnerBuildPackageNames).toContain(dependencyName);
    }
  });

  it("pins native and Codex CLI provisioning in the base image and keeps the final image app-only", async () => {
    const finalDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );
    const baseDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner-base", import.meta.url),
      "utf8",
    );
    const runnerBasePublishWorkflow = await readFile(
      new URL("../../../.github/workflows/cloudflare-runner-base-image.yml", import.meta.url),
      "utf8",
    );
    const runnerPermissionSandboxWorkflow = await readFile(
      new URL("../../../.github/workflows/cloudflare-runner-permission-sandbox.yml", import.meta.url),
      "utf8",
    );

    expect(baseDockerfile).toContain("ARG CODEX_CLI_VERSION=0.147.0");
    expect(baseDockerfile).toContain("ARG NODE_VERSION=24.14.1");
    expect(baseDockerfile).toContain(
      "ARG NODE_IMAGE_DIGEST=sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c",
    );
    expect(baseDockerfile).toContain(
      "FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST}\n\nARG NODE_VERSION",
    );
    // Hosted transcription is Worker-mediated Workers AI; the runner image
    // must not ship whisper.cpp binaries or model layers anymore.
    expect(baseDockerfile.toLowerCase()).not.toContain("whisper");
    expect(baseDockerfile).not.toContain("ggml");
    expect(baseDockerfile).not.toContain("huggingface.co");
    expect(runnerBasePublishWorkflow.toLowerCase()).not.toContain("whisper");
    expect(runnerBasePublishWorkflow).toContain("permissions:\n  contents: read\n  packages: write");
    expect(runnerBasePublishWorkflow).toContain(
      "if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}",
    );
    expect(runnerBasePublishWorkflow).not.toContain("pull_request:");
    expect(runnerBasePublishWorkflow).toContain(
      "run: pnpm --dir apps/cloudflare runner:docker:base -- --push",
    );
    expect(runnerPermissionSandboxWorkflow).toContain(
      "sudo sysctl --write kernel.apparmor_restrict_unprivileged_userns=0",
    );
    expect(runnerPermissionSandboxWorkflow).toContain(
      'test "$(sysctl --values kernel.apparmor_restrict_unprivileged_userns)" = "0"',
    );
    expect(runnerPermissionSandboxWorkflow).toContain(
      "run: pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base",
    );
    await expect(
      access(new URL("../../../Dockerfile.cloudflare-whisper-model", import.meta.url)),
    ).rejects.toThrow();
    expect(baseDockerfile).not.toContain(
      "COPY --chown=root:root .deploy/runner-bundle/ /app/",
    );
    expect(baseDockerfile).not.toContain("wrangler.generated.jsonc");
    expect(baseDockerfile).not.toContain("worker-secrets.json");
    expect(baseDockerfile).not.toContain("runner-bundle-builder");
    expect(baseDockerfile).not.toContain("pnpm install --frozen-lockfile");
    expect(baseDockerfile).toContain(
      'npm install --global --omit=dev --no-audit --no-fund --ignore-scripts "@openai/codex@${CODEX_CLI_VERSION}"',
    );
    expect(baseDockerfile).toContain(
      'native_codex="$(find "$(npm root -g)/@openai" -path \'*/vendor/*/bin/codex\' -type f -perm /111 -print -quit)"',
    );
    expect(baseDockerfile).toContain(
      'native_bwrap="$(find "$(npm root -g)/@openai" -path \'*/vendor/*/codex-resources/bwrap\' -type f -perm /111 -print -quit)"',
    );
    expect(baseDockerfile).toContain('test -n "${native_bwrap}"');
    expect(baseDockerfile).toContain(
      '"${native_bwrap}" --help | grep -Fq -- \'--argv0\'',
    );
    expect(baseDockerfile).toContain('ln -sfn "${native_codex}" /usr/local/bin/codex');
    expect(baseDockerfile).toContain("npm cache clean --force");
    expect(baseDockerfile).toContain("PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(baseDockerfile).not.toContain("/etc/profile.d/murph-runner-path.sh");
    expect(baseDockerfile).not.toContain("export PATH=");
    expect(baseDockerfile).not.toContain("FFMPEG_COMMAND=");
    expect(baseDockerfile).not.toContain("PDFTOTEXT_COMMAND=");
    expect(baseDockerfile).not.toContain("bubblewrap \\");
    expect(baseDockerfile).toContain("file \\");
    expect(baseDockerfile).toContain("jq \\");
    expect(baseDockerfile).not.toContain("mupdf-tools");
    expect(baseDockerfile).toContain("poppler-utils \\");
    expect(baseDockerfile).toContain("python-is-python3 \\");
    expect(baseDockerfile).toContain("python3 \\");
    expect(baseDockerfile).toContain("qpdf \\");
    expect(baseDockerfile).toContain("zstd \\");
    expect(baseDockerfile).toContain("python3 --version");
    expect(baseDockerfile).toContain("python --version");
    expect(baseDockerfile).toContain("jq --version");
    expect(baseDockerfile).toContain("zstd --version");
    expect(baseDockerfile).toContain(
      "ffmpeg -hide_banner -loglevel error -f lavfi -i anullsrc=channel_layout=mono:sample_rate=16000 -t 0.1 -codec:a libmp3lame -b:a 64k /tmp/murph-libmp3lame-smoke.mp3",
    );
    expect(baseDockerfile).toContain("test -s /tmp/murph-libmp3lame-smoke.mp3");
    expect(baseDockerfile).toContain("rm -f /tmp/murph-libmp3lame-smoke.mp3");
    expect(baseDockerfile).toContain("codex --version");
    expect(baseDockerfile).toContain("codex app-server --help >/dev/null");
    expect(baseDockerfile).toContain("codex doctor --help >/dev/null");
    expect(baseDockerfile).toContain("tini");
    // The base image must declare no runtime CMD at all; the final image owns it.
    expect(baseDockerfile).not.toMatch(/^CMD\b/m);
    expect(finalDockerfile).toContain(`ARG HOSTED_RUNNER_BASE_IMAGE=${hostedLocalRunnerBaseImageTag}`);
    expect(finalDockerfile).toContain(
      "FROM ${HOSTED_RUNNER_BASE_IMAGE} AS runner-app-permissions",
    );
    const finalStageIndex = finalDockerfile.indexOf(
      "FROM ${HOSTED_RUNNER_BASE_IMAGE}",
      finalDockerfile.indexOf("FROM ${HOSTED_RUNNER_BASE_IMAGE}") + 1,
    );
    const permissionStageBundleCopyIndex = finalDockerfile.indexOf(
      "COPY --chown=root:root ${HOSTED_RUNNER_BUNDLE_DIR}/ /app/",
    );
    const permissionStageRootUserIndex = finalDockerfile.indexOf("USER root");
    const finalRunnerBundleDirArgIndex = finalDockerfile.indexOf(
      "ARG HOSTED_RUNNER_BUNDLE_DIR=.deploy/runner-bundle",
    );
    const permissionStageChmodIndex = finalDockerfile.indexOf(
      "RUN chmod -R a-w /app",
    );
    const finalRootUserIndex = finalDockerfile.indexOf("USER root", finalStageIndex);
    const finalCodexCatalogEnvIndex = finalDockerfile.indexOf(
      'ENV MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON="/usr/local/share/murph/codex-model-catalog.openai-flex.json"',
    );
    const finalCodexCatalogPatchIndex = finalDockerfile.indexOf(
      "codex debug models --bundled",
    );
    const finalRunnerBundleCopyIndex = finalDockerfile.indexOf(
      "COPY --from=runner-app-permissions --chown=root:root /app/ /app/",
    );
    const finalRunnerUserIndex = finalDockerfile.indexOf("USER runner");
    const finalLocalBuildIdArgIndex = finalDockerfile.indexOf(
      "ARG HOSTED_RUNNER_LOCAL_BUILD_ID=local",
    );
    const finalLocalBuildIdLabelIndex = finalDockerfile.indexOf(
      'LABEL murph.hosted.local-build-id="${HOSTED_RUNNER_LOCAL_BUILD_ID}"',
    );
    expect(permissionStageRootUserIndex).toBeGreaterThan(-1);
    expect(finalRunnerBundleDirArgIndex).toBeGreaterThan(permissionStageRootUserIndex);
    expect(permissionStageBundleCopyIndex).toBeGreaterThan(finalRunnerBundleDirArgIndex);
    expect(permissionStageChmodIndex).toBeGreaterThan(permissionStageBundleCopyIndex);
    expect(finalStageIndex).toBeGreaterThan(permissionStageChmodIndex);
    expect(finalRootUserIndex).toBeGreaterThan(finalStageIndex);
    expect(finalCodexCatalogEnvIndex).toBeGreaterThan(finalRootUserIndex);
    expect(finalCodexCatalogPatchIndex).toBeGreaterThan(finalCodexCatalogEnvIndex);
    expect(finalRunnerBundleCopyIndex).toBeGreaterThan(finalCodexCatalogPatchIndex);
    expect(finalRunnerUserIndex).toBeGreaterThan(finalRunnerBundleCopyIndex);
    expect(finalLocalBuildIdArgIndex).toBeGreaterThan(finalRunnerUserIndex);
    expect(finalLocalBuildIdArgIndex).toBeGreaterThan(finalRunnerBundleCopyIndex);
    expect(finalLocalBuildIdLabelIndex).toBeGreaterThan(finalLocalBuildIdArgIndex);
    expect(finalDockerfile).toContain("ARG HOSTED_RUNNER_LOCAL_BUILD_ID=local");
    expect(finalDockerfile).toContain("ARG HOSTED_RUNNER_BUNDLE_DIR=.deploy/runner-bundle");
    for (const slug of hostedRunnerFlexModelSlugs) {
      expect(finalDockerfile).toContain(`"${slug}"`);
    }
    expect(finalDockerfile).not.toContain("ensure_future_gpt_model");
    expect(finalDockerfile).not.toContain("future_gpt_model_from");
    expect(finalDockerfile).toContain('"id":"flex"');
    expect(finalDockerfile).toContain(
      'jq -s -e \'length == 1 and (.[0] as $catalog | all(["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna"][]; . as $slug | ($catalog | any(.models[]?; .slug == $slug and any(.service_tiers[]?; .id == "flex")))))\'',
    );
    expect(finalDockerfile).toContain(
      'LABEL murph.hosted.local-build-id="${HOSTED_RUNNER_LOCAL_BUILD_ID}"',
    );
    expect(finalDockerfile).toContain(
      "COPY --from=runner-app-permissions --chown=root:root /app/ /app/",
    );
    expect(finalDockerfile).toContain("RUN chmod -R a-w /app");
    expect(finalDockerfile).toContain("  && chmod -R a+rX /app");
    expect(finalDockerfile.slice(finalStageIndex)).not.toContain(
      "RUN chmod -R",
    );
    expect(finalDockerfile.slice(finalStageIndex)).toContain("  && chmod a-w /app");
    expect(finalDockerfile.slice(finalStageIndex)).toContain("  && chmod a+rX /app");
    // Measured 2026-06-10: a baked NODE_COMPILE_CACHE was a no-op for this
    // bundle (real-bundle module eval ~0.8s even under qemu; cache hits gave
    // no speedup), so the image intentionally ships no compile-cache warm step.
    expect(finalDockerfile).not.toContain("NODE_COMPILE_CACHE");
    expect(readLastDockerUser(baseDockerfile)).toBe("runner");
    expect(readDockerUsers(finalDockerfile)).toEqual(["root", "root", "runner"]);
    expect(finalDockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "-s", "--"]');
    // The CMD runs the esbuild-bundled entrypoint: boot evaluates ~27 chunk
    // files instead of the unbundled graph's ~960 module files, which was the
    // dominant cold-start nodeStartupMs cost on lazily pulled image layers.
    // Package resolvers that derive asset paths from their own module
    // location are pinned to the installed package copies via env.
    expect(finalDockerfile).toContain('CMD ["node", "dist-bundled/container-entrypoint.js"]');
    expect(finalDockerfile).toContain(
      'ENV MURPH_ASSISTANT_SKILLS_ROOT="/app/node_modules/@murphai/assistant-engine/skills"',
    );
    expect(finalDockerfile).toContain(
      'ENV MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH="/app/node_modules/@murphai/assistant-engine/dist/assistant/cli-surface-contract.generated.json"',
    );
    expect(finalDockerfile).toContain(
      'ENV MURPH_HEALTH_COMMONS_PACKAGE_ROOT="/app/node_modules/@murphai/health-commons"',
    );
    expect(finalDockerfile).not.toContain("apt-get install");
    expect(finalDockerfile).not.toContain("@openai/codex");
    expect(finalDockerfile).not.toContain("whisper.cpp");
    expect(finalDockerfile).not.toContain("huggingface.co");
    expect(finalDockerfile).not.toContain("worker-secrets.json");
    await expect(
      access(new URL("../../../Dockerfile.cloudflare-hosted-runner-smoke", import.meta.url)),
    ).rejects.toThrow();
  });

  it("keeps the shared app bundle immutable to the runtime user across warm container reuse", async () => {
    const finalDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );
    const baseDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner-base", import.meta.url),
      "utf8",
    );

    const appBundleIsOwnedByRoot = finalDockerfile.includes(
      "COPY --from=runner-app-permissions --chown=root:root /app/ /app/",
    );
    const appBundleIsMadeNonWritable =
      finalDockerfile.includes(
        "FROM ${HOSTED_RUNNER_BASE_IMAGE} AS runner-app-permissions",
      )
      && finalDockerfile.includes(
        "COPY --chown=root:root ${HOSTED_RUNNER_BUNDLE_DIR}/ /app/",
      )
      && finalDockerfile.includes("RUN chmod -R a-w /app")
      && finalDockerfile.includes("  && chmod -R a+rX /app")
      && finalDockerfile.includes("  && chmod a-w /app")
      && finalDockerfile.includes("  && chmod a+rX /app");
    const containerReturnsToRuntimeUser =
      readLastDockerUser(baseDockerfile) === "runner"
      && readDockerUsers(finalDockerfile).at(-1) === "runner";

    expect(appBundleIsOwnedByRoot).toBe(true);
    expect(appBundleIsMadeNonWritable).toBe(true);
    expect(containerReturnsToRuntimeUser).toBe(true);
    expect(appBundleIsOwnedByRoot && appBundleIsMadeNonWritable && containerReturnsToRuntimeUser).toBe(true);
  });

  it("adds Flex to native Codex GPT-5.6 models without replacing their metadata", async () => {
    const finalDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );
    const { patchFilter, validationFilter } = readFinalImageCodexModelCatalogJqFilters(finalDockerfile);
    const stockCatalogWithoutFlex: CodexModelCatalog = {
      models: [
        {
          slug: "gpt-5.5",
          service_tiers: [{ id: "priority", name: "Priority" }],
        },
        {
          slug: "gpt-5.4-mini",
          service_tiers: [{ id: "auto", name: "Auto" }],
        },
        {
          description: "Flagship agentic coding model for complex professional work.",
          display_name: "GPT-5.6-Sol",
          slug: "gpt-5.6-sol",
          service_tiers: [{ id: "priority", name: "Priority" }],
        },
        {
          description: "Balanced agentic coding model for everyday work.",
          display_name: "GPT-5.6-Terra",
          slug: "gpt-5.6-terra",
          service_tiers: [{ id: "priority", name: "Priority" }],
        },
        {
          description: "Fast, cost-efficient agentic coding model.",
          display_name: "GPT-5.6-Luna",
          slug: "gpt-5.6-luna",
          service_tiers: [{ id: "priority", name: "Priority" }],
        },
      ],
    };

    const patchedCatalogJson = runJqFilter(patchFilter, stockCatalogWithoutFlex);
    const patchedCatalog = parseCodexModelCatalogJson(patchedCatalogJson);

    expect(readCodexModelSlugs(patchedCatalog)).toEqual([
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    for (const slug of hostedRunnerFlexModelSlugs) {
      expect(readCodexModelServiceTierIds(patchedCatalog, slug)).toEqual(["priority", "flex"]);
    }
    expect(readCodexModelServiceTierIds(patchedCatalog, "gpt-5.4-mini")).toEqual(["auto"]);
    expect(readCodexModelServiceTierIds(patchedCatalog, "gpt-5.5")).toEqual(["priority"]);
    expect(readCodexModel(patchedCatalog, "gpt-5.6-sol")).toMatchObject({
      description: "Flagship agentic coding model for complex professional work.",
      display_name: "GPT-5.6-Sol",
    });
    expect(readCodexModel(patchedCatalog, "gpt-5.6-terra")).toMatchObject({
      description: "Balanced agentic coding model for everyday work.",
      display_name: "GPT-5.6-Terra",
    });
    expect(readCodexModel(patchedCatalog, "gpt-5.6-luna")).toMatchObject({
      description: "Fast, cost-efficient agentic coding model.",
      display_name: "GPT-5.6-Luna",
    });
    expect(runJqFilter(validationFilter, patchedCatalog, { slurp: true }).trim()).toBe("true");

    expect(runJqFilter(
      validationFilter,
      `${patchedCatalogJson}\n${patchedCatalogJson}`,
      { slurp: true },
    ).trim()).toBe("false");

    const repatchedCatalog = parseCodexModelCatalogJson(
      runJqFilter(patchFilter, patchedCatalog),
    );
    const repatchedTargetTierIds = readCodexModelServiceTierIds(repatchedCatalog, "gpt-5.6-terra");
    const twicePatchedCatalog = parseCodexModelCatalogJson(
      runJqFilter(patchFilter, repatchedCatalog),
    );

    expect(repatchedTargetTierIds.filter((tierId) => tierId === "flex")).toHaveLength(1);
    for (const slug of hostedRunnerFlexModelSlugs) {
      expect(readCodexModelServiceTierIds(twicePatchedCatalog, slug).filter((tierId) => tierId === "flex"))
        .toHaveLength(1);
    }
    expect(runJqFilter(validationFilter, repatchedCatalog, { slurp: true }).trim()).toBe("true");
    expect(runJqFilter(validationFilter, {
      models: patchedCatalog.models.filter((model) => model.slug !== "gpt-5.6-terra"),
    }, { slurp: true }).trim()).toBe("false");
  });

  it("pins the checked-in and rendered Wrangler config to an app-local build context", async () => {
    const wranglerConfig = await readFile(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    const deployGuide = await readFile(
      new URL("../DEPLOY.md", import.meta.url),
      "utf8",
    );
    const runnerDockerSmokeScript = await readFile(
      new URL("../scripts/runner-docker-smoke.ts", import.meta.url),
      "utf8",
    );
    const runnerPythonPathScript = await readFile(
      new URL("../scripts/runner-python-path-e2e.ts", import.meta.url),
      "utf8",
    );
    const demoVaultMetadata = JSON.parse(
      await readFile(new URL("../../../fixtures/demo-web-vault/vault.json", import.meta.url), "utf8"),
    ) as {
      formatVersion?: unknown;
    };
    const hostedRunnerSmokeChild = await readFile(
      new URL("../src/hosted-runner-smoke-child.ts", import.meta.url),
      "utf8",
    );
    const rendered = buildHostedWranglerDeployConfig(createDeployEnvironment());
    const [container] = rendered.containers as Array<Record<string, unknown>>;

    expect(wranglerConfig).toContain('"image": "../../Dockerfile.cloudflare-hosted-runner"');
    expect(wranglerConfig).toContain('"image_build_context": "."');
    expect(wranglerConfig).toContain(
      '"compatibility_flags": ["nodejs_compat", "containers_pid_namespace"]',
    );
    expect(wranglerConfig).toContain('"ssh": { "enabled": false }');
    expect(wranglerConfig).not.toContain('"authorized_keys"');
    expect(container.ssh).toEqual({ enabled: false });
    expect(container).not.toHaveProperty("authorized_keys");
    expect(packageJson.scripts?.["deploy:worker"]).toBe(
      "pnpm deploy:artifacts && pnpm runner:docker:base -- --force && pnpm deploy:worker:apply",
    );
    expect(packageJson.scripts?.["deploy:artifacts"]).toContain("pnpm deploy:artifacts:validate");
    expect(deployGuide).toContain([
      "pnpm --dir apps/cloudflare deploy:preflight",
      "pnpm --dir apps/cloudflare deploy:artifacts",
    ].join("\n"));
    expect(deployGuide).toContain([
      "pnpm --dir apps/cloudflare runner:bundle",
      "pnpm --dir apps/cloudflare deploy:config:render",
    ].join("\n"));
    expect(packageJson.scripts?.["runner:docker:base"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/runner-base-image.ts",
    );
    expect(packageJson.scripts?.["runner:docker:build"]).toBe(
      "pnpm runner:bundle && pnpm runner:docker:base && docker build --platform linux/amd64 -f ../../Dockerfile.cloudflare-hosted-runner -t murph-cloudflare-runner .",
    );
    expect(packageJson.scripts?.["runner:docker:python-path"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/runner-python-path-e2e.ts",
    );
    expect(packageJson.scripts?.["runner:docker:smoke"]).toBe(
      "pnpm runner:bundle && pnpm runner:docker:base && pnpm runner:docker:smoke:prepare && pnpm runner:docker:smoke:image && pnpm runner:docker:smoke:built",
    );
    expect(packageJson.scripts?.["runner:docker:smoke:prepared-base"]).toBe(
      "pnpm runner:docker:smoke:prepare && pnpm runner:docker:smoke:image && pnpm runner:docker:smoke:built",
    );
    expect(demoVaultMetadata.formatVersion).toBe(CURRENT_VAULT_FORMAT_VERSION);
    expect(packageJson.scripts?.["worker:dev"]).toBe(
      "pnpm runner:docker:base && pnpm exec wrangler dev",
    );
    expect(packageJson.scripts?.["runner:bundle:assemble-only"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/assemble-runner-bundle.ts --skip-build",
    );
    expect(packageJson.scripts?.["runner:bundle:hosted-local"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/assemble-runner-bundle.ts",
    );
    expect(packageJson.scripts?.["runner:bundle:hosted-local"]).not.toContain(
      "--skip-bundle-only-dependencies",
    );
    expect(packageJson.scripts?.["runner:docker:smoke:prepare"]).not.toContain("runner:bundle:assemble-only");
    expect(packageJson.scripts?.["runner:docker:smoke:prepare"]).toContain(".deploy/runner-smoke-bundle");
    expect(packageJson.scripts?.["runner:docker:smoke:image"]).toBe(
      "docker build --platform linux/amd64 -f ../../Dockerfile.cloudflare-hosted-runner --build-arg HOSTED_RUNNER_BUNDLE_DIR=.deploy/runner-smoke-bundle -t murph-cloudflare-runner .",
    );
    expect(runnerDockerSmokeScript).toContain('"--platform",\n      "linux/amd64"');
    expect(runnerDockerSmokeScript).toContain(
      '"--security-opt",\n      "seccomp=unconfined"',
    );
    expect(runnerDockerSmokeScript).toContain(
      '"--security-opt",\n      "apparmor=unconfined"',
    );
    expect(runnerDockerSmokeScript).toContain("codexHostedShellVaultCliLlmsBytes=");
    expect(runnerDockerSmokeScript).toContain("codexHostedShellMurphPathBytes=");
    expect(runnerDockerSmokeScript).toContain("codexHostedShellPythonVersion=");
    expect(runnerDockerSmokeScript).toContain("codexHostedCliSchemaVaultOptionHidden=");
    expect(runnerDockerSmokeScript).toContain("codexHostedCliVaultCommandProofCount=");
    expect(runnerDockerSmokeScript).toContain("codexHostedCliVaultWriteProofCount=");
    expect(runnerDockerSmokeScript).toContain("pythonVersion=");
    expect(runnerDockerSmokeScript).toContain("ripgrepVersion=");
    expect(runnerPythonPathScript).toContain('const IMAGE_TAG = "murph-cloudflare-runner"');
    expect(runnerDockerSmokeScript).toContain(runnerDockerSmokeFinallyCleanupBlock);
    expect(runnerPythonPathScript).toContain(runnerPythonPathFinallyCleanupBlock);
    expect(runnerPythonPathScript).toContain('"--detach"');
    expect(runnerPythonPathScript).toContain('"--platform",\n      "linux/amd64"');
    expect(runnerPythonPathScript).toContain('"--network",\n      "none"');
    expect(runnerPythonPathScript).not.toContain("--entrypoint");
    expect(runnerPythonPathScript).toContain('"exec",\n      containerId,\n      "node"');
    expect(runnerPythonPathScript).toContain("cloudflare-hosted-runner-node");
    expect(runnerPythonPathScript).toContain("await removeContainer(containerId)");
    expect(runnerPythonPathScript).toContain('test "$(pwd)" = "/app"');
    expect(runnerPythonPathScript).toContain('test "$(id -un)" = "runner"');
    expect(runnerPythonPathScript).toContain('test "$HOME" = "/home/runner"');
    expect(runnerPythonPathScript).toContain('test "$NODE_ENV" = "production"');
    expect(runnerPythonPathScript).toContain('test "$PORT" = "8080"');
    expect(runnerPythonPathScript).toContain('test "$HOSTED_HOME" = "/home/runner/.murph"');
    expect(runnerPythonPathScript).toContain('test "$HOSTED_MODELS_ROOT" = "/home/runner/.murph/models"');
    expect(runnerPythonPathScript).toContain('case "$PATH" in /app/node_modules/.bin:*');
    expect(runnerPythonPathScript).toContain("test ! -w /app");
    expect(runnerPythonPathScript).toContain("command -v python >/dev/null");
    expect(runnerPythonPathScript).toContain("command -v python3 >/dev/null");
    expect(runnerPythonPathScript).toContain("python -c");
    expect(runnerPythonPathScript).toContain("python3 -c");
    expect(runnerPythonPathScript).not.toContain("console.log(output)");
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("file")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("python")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("python3")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("rg")');
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("python3", ["--version"])');
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("rg", ["--version"])');
    expect(hostedRunnerSmokeChild).toContain("buildCodexEnvironmentProbeScript");
    expect(hostedRunnerSmokeChild).toContain("cwd: input.vaultRoot");
    expect(hostedRunnerSmokeChild).toContain("cwdRebound: process.cwd() === expectedVaultRoot");
    expect(hostedRunnerSmokeChild).toContain('model = "gpt-5.6-terra"');
    expect(hostedRunnerSmokeChild).toContain('model_reasoning_effort = "low"');
    expect(hostedRunnerSmokeChild).toContain("model_auto_compact_token_limit = 132000");
    expect(hostedRunnerSmokeChild).toContain("runCodexVaultCliProof");
    expect(hostedRunnerSmokeChild).toContain('"vault-show-default"');
    expect(hostedRunnerSmokeChild).toContain('"vault-show-explicit"');
    expect(hostedRunnerSmokeChild).toContain('"measurement-add"');
    expect(hostedRunnerSmokeChild).toContain("measurement-add.eventId");
    expect(hostedRunnerSmokeChild).toContain('"--occurred-at"');
    expect(hostedRunnerSmokeChild).toContain('"measurement-list"');
    expect(hostedRunnerSmokeChild).toContain('"--from"');
    expect(hostedRunnerSmokeChild).toContain('"--to"');
    expect(hostedRunnerSmokeChild).toContain('"scheduled-log-save"');
    expect(hostedRunnerSmokeChild).toContain('"scheduled-log-list"');
    expect(hostedRunnerSmokeChild).toContain("codexHostedCliVaultCommandProofCount");
    expect(hostedRunnerSmokeChild).toContain("codexHostedCliVaultWriteProofCount");
    expect(hostedRunnerSmokeChild).toContain("codexHostedShellPythonVersion");
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("pdfinfo")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("pdftotext")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("pdftoppm")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("qpdf")');
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("qpdf", ["--check", input.pdfPath])');
    expect(hostedRunnerSmokeChild).not.toContain('runTextCommand("mutool"');
    expect(hostedRunnerSmokeChild).toContain('expectedProviderId: "poppler.pdf"');
    expect(hostedRunnerSmokeChild).toContain("pdfParserProviderId: pdfParse.providerId");
    expect(hostedRunnerSmokeChild).toContain('"libmp3lame",\n    "-b:a",\n    "64k"');
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("/bin/sh", ["-c"');
    expect(hostedRunnerSmokeChild).not.toContain('runTextCommand("/bin/sh", ["-lc"');
    expect(packageJson.scripts?.["test:e2e:local"]).toBe(
      "pnpm test:e2e:hosted-local && pnpm test:e2e:workers:local",
    );
    expect(packageJson.scripts?.["test:e2e:workers:local"]).toBe("pnpm test:workers");
    expect(packageJson.scripts?.["test:e2e:hosted-local"]).toBe(
      "pnpm --dir ../.. hosted-local e2e",
    );
    expect(packageJson.scripts?.["test:e2e:linq-delivery:local"]).toBeUndefined();
    expect(packageJson.scripts?.["test:e2e:telegram:local"]).toBeUndefined();
    expect(packageJson.scripts?.["test:e2e:device-connect:local"]).toBeUndefined();
    expect(packageJson.scripts?.["test:e2e:linq-webhook:local"]).toBeUndefined();
    expect(packageJson.scripts?.["test:e2e:mailbox-platform-env:local"]).toBeUndefined();
    expect(packageJson.scripts?.["test:e2e:first-contact:local"]).toBeUndefined();
    expect(packageJson.scripts?.["test:e2e:runner-python:local"]).toBe(
      "pnpm runner:docker:build && pnpm runner:docker:python-path",
    );
    expect(container.image).toBe("../../../Dockerfile.cloudflare-hosted-runner");
    expect(container.image_build_context).toBe("..");
    expect(container.instance_type).toEqual({
      disk_mb: 6000,
      memory_mib: 6144,
      vcpu: 2,
    });
    expect(container.max_instances).toBe(1000);
  });

  it("keeps only runner bundle artifacts from .deploy in the app-local Docker context", async () => {
    const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");

    expect(dockerignore).toContain("**");
    expect(dockerignore).toContain("!.deploy/");
    expect(dockerignore).toContain("!.deploy/runner-bundle/");
    expect(dockerignore).toContain("!.deploy/runner-bundle/**");
    expect(dockerignore).toContain("!.deploy/runner-smoke-bundle/");
    expect(dockerignore).toContain("!.deploy/runner-smoke-bundle/**");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/wrangler.generated.jsonc");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/worker-secrets.json");
  });
});

async function readRunnerPackageManifest(): Promise<{
  dependencies?: Record<string, string>;
}> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
  };
}

function readRunnerPackageManifestSync(): {
  dependencies?: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
  };
}

function readDockerUsers(dockerfile: string): string[] {
  return dockerfile
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => /^USER\s+(.+)$/iu.exec(line)?.[1]?.trim() ?? null)
    .filter((user): user is string => user !== null);
}

function readLastDockerUser(dockerfile: string): string | null {
  return readDockerUsers(dockerfile).at(-1) ?? null;
}

type CodexModelCatalog = {
  models: Array<Record<string, unknown> & {
    slug: string;
    service_tiers?: Array<{
      id: string;
      name?: string;
      description?: string;
    }>;
  }>;
};

function readFinalImageCodexModelCatalogJqFilters(dockerfile: string): {
  patchFilter: string;
  validationFilter: string;
} {
  const patchMatch = new RegExp(
    String.raw`\|\s+jq '([^']+)'\s+\\\s*\n\s*> /tmp/murph-codex-model-catalog\.openai-flex\.json`,
    "u",
  ).exec(dockerfile);
  const validationMatch = new RegExp(
    String.raw`&& jq -s -e '([^']+)' /tmp/murph-codex-model-catalog\.openai-flex\.json >/dev/null`,
    "u",
  ).exec(dockerfile);

  if (patchMatch === null || validationMatch === null) {
    throw new Error("Final image Codex model catalog patch or validation jq filter is missing");
  }

  return {
    patchFilter: patchMatch[1],
    validationFilter: validationMatch[1],
  };
}

function runJqFilter(
  filter: string,
  input: CodexModelCatalog | string,
  options: { slurp?: boolean } = {},
): string {
  return execFileSync("jq", [
    ...(options.slurp === true ? ["-s"] : []),
    filter,
  ], {
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
}

function parseCodexModelCatalogJson(catalogJson: string): CodexModelCatalog {
  const catalog = JSON.parse(catalogJson) as CodexModelCatalog;

  if (!Array.isArray(catalog.models)) {
    throw new Error("Codex model catalog JSON must contain a models array");
  }

  return catalog;
}

function readCodexModelServiceTierIds(catalog: CodexModelCatalog, slug: string): string[] {
  return catalog.models.find((model) => model.slug === slug)?.service_tiers?.map((tier) => tier.id) ?? [];
}

function readCodexModel(catalog: CodexModelCatalog, slug: string): Record<string, unknown> {
  const model = catalog.models.find((candidate) => candidate.slug === slug);
  if (!model) {
    throw new Error(`Codex model catalog is missing ${slug}`);
  }
  return model;
}

function readCodexModelSlugs(catalog: CodexModelCatalog): string[] {
  return catalog.models.map((model) => model.slug);
}
