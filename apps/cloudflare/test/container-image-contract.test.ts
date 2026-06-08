import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  buildHostedWranglerDeployConfig,
} from "../scripts/deploy-automation/wrangler-config.ts";
import {
  buildHostedRunnerRuntimeArtifactPackageJson,
  hostedRunnerBuildPackageNames,
  hostedRunnerBundleOnlyDependencyNames,
  hostedRunnerWorkspacePackageNames,
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

function createDeployEnvironment() {
  return {
    allowedRunnerSecretKeys: null,
    bundlesBucketName: "bundles",
    bundlesPreviewBucketName: "bundles-preview",
    platformEnvelopeKeyId: "v1",
    compatibilityDate: "2026-03-27",
    containerInstanceType: {
      disk_mb: 6000,
      memory_mib: 3072,
      vcpu: 1,
    },
    containerMaxInstances: 1000,
    containerSshKey: null,
    hostedEmailSendBindingEnabled: true,
    logHeadSamplingRate: 1,
    maxEventAttempts: "3",
    retryDelayMs: "30000",
    runnerCommitTimeoutMs: "30000",
    runnerReadyTimeoutMs: "20000",
    traceHeadSamplingRate: 0.1,
    webControlTimeoutMs: "30000",
    workerName: "murph-hosted",
    workerVars: {},
  }
}

function readDockerArg(contents: string, name: string): string {
  const match = contents.match(new RegExp(`^ARG ${name}=(.+)$`, "mu"));
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
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
      'import {\n  pruneRunnerBundle,\n  rewriteRuntimeBinWrappers,\n  rewriteRuntimePackageManifest,\n} from "./runner-bundle/runtime-shape.js";',
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

    expect(murphPackageJson.bundleDependencies).toEqual(
      publishedMurphBundledWorkspacePackageNames,
    );

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
    const whisperModelDockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-whisper-model", import.meta.url),
      "utf8",
    );
    const runnerBasePublishWorkflow = await readFile(
      new URL("../../../.github/workflows/cloudflare-runner-base-image.yml", import.meta.url),
      "utf8",
    );
    const deployDocs = await readFile(new URL("../DEPLOY.md", import.meta.url), "utf8");
    const hostedLocalHarnessDocs = await readFile(
      new URL("../../../packages/hosted-local-harness/README.md", import.meta.url),
      "utf8",
    );

    const whisperModelImage = readDockerArg(baseDockerfile, "WHISPER_MODEL_IMAGE");
    const whisperModelSha256 = readDockerArg(baseDockerfile, "WHISPER_MODEL_SHA256");

    expect(baseDockerfile).toContain("ARG WHISPER_CPP_VERSION=v1.8.1");
    expect(baseDockerfile).toContain("ARG WHISPER_MODEL_FILE=ggml-base.en.bin");
    expect(whisperModelSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(whisperModelImage).toBe(
      `ghcr.io/cobuildwithus/murph-whisper-model:ggml-base-en-sha256-${whisperModelSha256}`,
    );
    expect(baseDockerfile).toContain("ARG CODEX_CLI_VERSION=0.135.0");
    expect(baseDockerfile).toContain("ARG NODE_VERSION=24.14.1");
    expect(baseDockerfile).toContain(
      "ARG NODE_IMAGE_DIGEST=sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c",
    );
    expect(baseDockerfile).toContain(
      "ARG WHISPER_CPP_SHA256=b7c6b05635e5fda85cbcc5a012d29b3a4ca1cc22d9fa54d5b6c33e4ac271e5e0",
    );
    expect(baseDockerfile).toContain("ARG WHISPER_CPP_BUILD_JOBS=1");
    expect(baseDockerfile).toContain(
      "ARG WHISPER_MODEL_SHA256=a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    );
    expect(baseDockerfile).toContain(
      "FROM ${WHISPER_MODEL_IMAGE} AS whisper-model",
    );
    expect(baseDockerfile).toContain(
      "FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS whisper-builder",
    );
    expect(baseDockerfile).toContain(
      "FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST}\n\nARG NODE_VERSION",
    );
    expect(baseDockerfile).toContain(
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_VERSION}.tar.gz",
    );
    expect(baseDockerfile).toContain(
      "printf '%s  %s\\n' \"${WHISPER_CPP_SHA256}\" /tmp/whisper.cpp.tar.gz | sha256sum -c -",
    );
    expect(baseDockerfile).toContain("-DBUILD_SHARED_LIBS=ON");
    expect(baseDockerfile).toContain("-DGGML_BACKEND_DL=ON");
    expect(baseDockerfile).toContain("-DGGML_CPU_ALL_VARIANTS=ON");
    expect(baseDockerfile).toContain("-DGGML_NATIVE=OFF");
    expect(baseDockerfile).not.toContain("GGML_CPU_ARM_ARCH");
    expect(baseDockerfile).toContain(
      "cmake --build build -j\"${WHISPER_CPP_BUILD_JOBS}\" --config Release --target whisper-cli",
    );
    expect(baseDockerfile).toContain("cp -a build/bin/libggml-cpu*.so /opt/whisper/bin/");
    expect(baseDockerfile).toContain("COPY --from=whisper-builder /opt/whisper/bin/whisper-cli /usr/local/bin/whisper-cli");
    expect(baseDockerfile).toContain("COPY --from=whisper-builder /opt/whisper/bin/libggml-cpu*.so /usr/local/bin/");
    expect(baseDockerfile).toContain("COPY --from=whisper-builder /opt/whisper/lib/ /usr/local/lib/");
    expect(baseDockerfile).toContain(
      "COPY --from=whisper-model /model.bin /opt/whisper/${WHISPER_MODEL_FILE}",
    );
    expect(baseDockerfile).toContain(
      "printf '%s  %s\\n' \"${WHISPER_MODEL_SHA256}\" \"/opt/whisper/${WHISPER_MODEL_FILE}\" | sha256sum -c -",
    );
    expect(baseDockerfile).not.toContain(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}",
    );
    expect(whisperModelDockerfile).toContain(`ADD --checksum=sha256:${whisperModelSha256}`);
    expect(whisperModelDockerfile).toContain(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    );
    expect(runnerBasePublishWorkflow).toContain("s/^ARG WHISPER_MODEL_IMAGE=//p");
    expect(runnerBasePublishWorkflow).toContain(
      'docker buildx imagetools inspect "${whisper_model_image}"',
    );
    expect(runnerBasePublishWorkflow).toContain(
      'echo "Whisper model image already exists: ${whisper_model_image}"',
    );
    expect(runnerBasePublishWorkflow).toContain('--tag "${whisper_model_image}"');
    expect(runnerBasePublishWorkflow).toContain("permissions:\n  contents: read\n  packages: write");
    expect(runnerBasePublishWorkflow).toContain(
      "if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}",
    );
    expect(runnerBasePublishWorkflow).not.toContain("pull_request:");
    expect(runnerBasePublishWorkflow).toContain(
      "run: pnpm --dir apps/cloudflare runner:docker:base -- --push",
    );
    expect(deployDocs).toContain(
      "Pull-request hosted-local E2E does not authenticate to GHCR",
    );
    expect(deployDocs).toContain(
      "For Whisper model bumps, publish the new pinned GHCR model tag before opening or",
    );
    expect(hostedLocalHarnessDocs).toContain(
      "prepublish that new model tag from the branch's",
    );
    expect(baseDockerfile).toContain(
      "COPY --from=whisper-builder --chown=runner:runner /opt/whisper/${WHISPER_MODEL_FILE} /home/runner/.murph/models/whisper/model.bin",
    );
    expect(baseDockerfile).not.toContain("/home/runner/.murph/models/whisper/${WHISPER_MODEL_FILE}");
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
    expect(baseDockerfile).toContain("npm cache clean --force");
    expect(baseDockerfile).toContain("PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(baseDockerfile).not.toContain("/etc/profile.d/murph-runner-path.sh");
    expect(baseDockerfile).not.toContain("export PATH=");
    expect(baseDockerfile).not.toContain("WHISPER_COMMAND=");
    expect(baseDockerfile).not.toContain("WHISPER_MODEL_PATH=");
    expect(baseDockerfile).not.toContain("FFMPEG_COMMAND=");
    expect(baseDockerfile).not.toContain("PDFTOTEXT_COMMAND=");
    expect(baseDockerfile).toContain("file \\");
    expect(baseDockerfile).toContain("jq \\");
    expect(baseDockerfile).toContain("mupdf-tools \\");
    expect(baseDockerfile).toContain("poppler-utils \\");
    expect(baseDockerfile).toContain("python-is-python3 \\");
    expect(baseDockerfile).toContain("python3 \\");
    expect(baseDockerfile).toContain("qpdf \\");
    expect(baseDockerfile).toContain("zstd \\");
    expect(baseDockerfile).toContain("RUN ldconfig");
    expect(baseDockerfile).toContain("python3 --version");
    expect(baseDockerfile).toContain("python --version");
    expect(baseDockerfile).toContain("jq --version");
    expect(baseDockerfile).toContain("zstd --version");
    expect(baseDockerfile).toContain("codex --version");
    expect(baseDockerfile).toContain("codex app-server --help >/dev/null");
    expect(baseDockerfile).toContain("codex doctor --help >/dev/null");
    expect(baseDockerfile).toContain("tini");
    expect(baseDockerfile).not.toContain('CMD ["node", "dist/container-entrypoint.js"]');
    expect(finalDockerfile).toContain(`ARG HOSTED_RUNNER_BASE_IMAGE=${hostedLocalRunnerBaseImageTag}`);
    expect(finalDockerfile).toContain("FROM ${HOSTED_RUNNER_BASE_IMAGE}");
    const finalRunnerBundleCopyIndex = finalDockerfile.indexOf(
      "COPY --chown=root:root ${HOSTED_RUNNER_BUNDLE_DIR}/ /app/",
    );
    const finalRootUserIndex = finalDockerfile.indexOf("USER root");
    const finalRunnerBundleDirArgIndex = finalDockerfile.indexOf(
      "ARG HOSTED_RUNNER_BUNDLE_DIR=.deploy/runner-bundle",
    );
    const finalChmodIndex = finalDockerfile.indexOf("RUN chmod -R a-w /app");
    const finalRunnerUserIndex = finalDockerfile.indexOf("USER runner");
    const finalLocalBuildIdArgIndex = finalDockerfile.indexOf(
      "ARG HOSTED_RUNNER_LOCAL_BUILD_ID=local",
    );
    const finalLocalBuildIdLabelIndex = finalDockerfile.indexOf(
      'LABEL murph.hosted.local-build-id="${HOSTED_RUNNER_LOCAL_BUILD_ID}"',
    );
    expect(finalRootUserIndex).toBeGreaterThan(-1);
    expect(finalRunnerBundleDirArgIndex).toBeGreaterThan(finalRootUserIndex);
    expect(finalRunnerBundleCopyIndex).toBeGreaterThan(-1);
    expect(finalRunnerBundleCopyIndex).toBeGreaterThan(finalRunnerBundleDirArgIndex);
    expect(finalChmodIndex).toBeGreaterThan(finalRunnerBundleCopyIndex);
    expect(finalRunnerUserIndex).toBeGreaterThan(finalChmodIndex);
    expect(finalLocalBuildIdArgIndex).toBeGreaterThan(finalRunnerUserIndex);
    expect(finalLocalBuildIdArgIndex).toBeGreaterThan(finalRunnerBundleCopyIndex);
    expect(finalLocalBuildIdLabelIndex).toBeGreaterThan(finalLocalBuildIdArgIndex);
    expect(finalDockerfile).toContain("ARG HOSTED_RUNNER_LOCAL_BUILD_ID=local");
    expect(finalDockerfile).toContain("ARG HOSTED_RUNNER_BUNDLE_DIR=.deploy/runner-bundle");
    expect(finalDockerfile).toContain(
      'LABEL murph.hosted.local-build-id="${HOSTED_RUNNER_LOCAL_BUILD_ID}"',
    );
    expect(finalDockerfile).toContain(
      "COPY --chown=root:root ${HOSTED_RUNNER_BUNDLE_DIR}/ /app/",
    );
    expect(finalDockerfile).toContain("RUN chmod -R a-w /app");
    expect(finalDockerfile).toContain("  && chmod -R a+rX /app");
    expect(readLastDockerUser(baseDockerfile)).toBe("runner");
    expect(readDockerUsers(finalDockerfile)).toEqual(["root", "runner"]);
    expect(finalDockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "-s", "--"]');
    expect(finalDockerfile).toContain('CMD ["node", "dist/container-entrypoint.js"]');
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
      "COPY --chown=root:root ${HOSTED_RUNNER_BUNDLE_DIR}/ /app/",
    );
    const appBundleIsMadeNonWritable =
      finalDockerfile.includes("RUN chmod -R a-w /app")
      && finalDockerfile.includes("  && chmod -R a+rX /app");
    const containerReturnsToRuntimeUser =
      readLastDockerUser(baseDockerfile) === "runner"
      && readDockerUsers(finalDockerfile).at(-1) === "runner";

    expect(appBundleIsOwnedByRoot).toBe(true);
    expect(appBundleIsMadeNonWritable).toBe(true);
    expect(containerReturnsToRuntimeUser).toBe(true);
    expect(appBundleIsOwnedByRoot && appBundleIsMadeNonWritable && containerReturnsToRuntimeUser).toBe(true);
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
    const runnerDockerSmokeScript = await readFile(
      new URL("../scripts/runner-docker-smoke.ts", import.meta.url),
      "utf8",
    );
    const runnerPythonPathScript = await readFile(
      new URL("../scripts/runner-python-path-e2e.ts", import.meta.url),
      "utf8",
    );
    const hostedRunnerSmokeChild = await readFile(
      new URL("../src/hosted-runner-smoke-child.ts", import.meta.url),
      "utf8",
    );
    const rendered = buildHostedWranglerDeployConfig(createDeployEnvironment());
    const [container] = rendered.containers as Array<Record<string, unknown>>;

    expect(wranglerConfig).toContain('"image": "../../Dockerfile.cloudflare-hosted-runner"');
    expect(wranglerConfig).toContain('"image_build_context": "."');
    expect(packageJson.scripts?.["deploy:worker"]).toBe(
      "pnpm deploy:artifacts && pnpm runner:docker:base -- --force && pnpm deploy:worker:apply",
    );
    expect(packageJson.scripts?.["deploy:artifacts"]).toContain("pnpm deploy:artifacts:validate");
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
    expect(packageJson.scripts?.["worker:deploy"]).toBe(
      "pnpm deploy:worker",
    );
    expect(packageJson.scripts?.["worker:deploy:apply"]).toBe("pnpm deploy:worker:apply");
    expect(packageJson.scripts?.["worker:deploy:apply"]).not.toContain("wrangler deploy");
    expect(packageJson.scripts?.["worker:dev"]).toBe(
      "pnpm runner:docker:base && pnpm exec wrangler dev",
    );
    expect(packageJson.scripts?.["runner:bundle:assemble-only"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/assemble-runner-bundle.ts --skip-build",
    );
    expect(packageJson.scripts?.["runner:bundle:hosted-local"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/assemble-runner-bundle.ts",
    );
    expect(packageJson.scripts?.["runner:bundle:manifest:refresh"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/refresh-runner-bundle-manifest.ts",
    );
    expect(packageJson.scripts?.["runner:bundle:manifest:validate"]).toBe(
      "pnpm --dir ../.. exec tsx --tsconfig apps/cloudflare/tsconfig.scripts.json apps/cloudflare/scripts/validate-runner-bundle-manifest.ts",
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
    expect(runnerDockerSmokeScript).toContain("codexHostedShellVaultCliLlmsBytes=");
    expect(runnerDockerSmokeScript).toContain("codexHostedShellMurphPathBytes=");
    expect(runnerDockerSmokeScript).toContain("codexHostedShellPythonVersion=");
    expect(runnerDockerSmokeScript).toContain("codexHostedCliSchemaVaultOptionHidden=");
    expect(runnerDockerSmokeScript).toContain("codexHostedCliVaultCommandProofCount=");
    expect(runnerDockerSmokeScript).toContain("codexHostedCliVaultWriteProofCount=");
    expect(runnerDockerSmokeScript).toContain("pythonVersion=");
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
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("python3", ["--version"])');
    expect(hostedRunnerSmokeChild).toContain("buildCodexEnvironmentProbeScript");
    expect(hostedRunnerSmokeChild).toContain('model = "gpt-5.5"');
    expect(hostedRunnerSmokeChild).toContain('model_reasoning_effort = "low"');
    expect(hostedRunnerSmokeChild).toContain("model_auto_compact_token_limit = 233000");
    expect(hostedRunnerSmokeChild).toContain("runCodexVaultCliProof");
    expect(hostedRunnerSmokeChild).toContain('"vault-show-default"');
    expect(hostedRunnerSmokeChild).toContain('"vault-show-explicit"');
    expect(hostedRunnerSmokeChild).toContain('"measurement-add"');
    expect(hostedRunnerSmokeChild).toContain('"scheduled-log-save"');
    expect(hostedRunnerSmokeChild).toContain("codexHostedCliVaultCommandProofCount");
    expect(hostedRunnerSmokeChild).toContain("codexHostedCliVaultWriteProofCount");
    expect(hostedRunnerSmokeChild).toContain("codexHostedShellPythonVersion");
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("mutool")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("pdfinfo")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("pdftotext")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("pdftoppm")');
    expect(hostedRunnerSmokeChild).toContain('resolveCommandPath("qpdf")');
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("qpdf", ["--check", input.pdfPath])');
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("mutool", ["info", input.pdfPath])');
    expect(hostedRunnerSmokeChild).toContain('expectedProviderId: "poppler.pdf"');
    expect(hostedRunnerSmokeChild).toContain("pdfParserProviderId: pdfParse.providerId");
    expect(hostedRunnerSmokeChild).toContain('runTextCommand("/bin/sh", ["-c"');
    expect(hostedRunnerSmokeChild).not.toContain('runTextCommand("/bin/sh", ["-lc"');
    expect(packageJson.scripts?.["test:e2e:local"]).toBe(
      "pnpm test:e2e:hosted-local && pnpm test:e2e:workers:local",
    );
    expect(packageJson.scripts?.["test:e2e:full-stack:local"]).toBe(
      "pnpm test:e2e:hosted-local",
    );
    expect(packageJson.scripts?.["test:e2e:smoke:local"]).toBe(
      "pnpm test:e2e:workers:local",
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
      memory_mib: 3072,
      vcpu: 1,
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
