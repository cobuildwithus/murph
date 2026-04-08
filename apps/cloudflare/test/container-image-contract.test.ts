import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import {
  buildRunnerVaultCliArtifactPackageJson,
  hostedRunnerWorkerDependencyNames,
  runnerVaultCliArtifactDependencyNames,
  runnerVaultCliArtifactPackageName,
} from "../src/runner-bundle-contract.js";

describe("hosted runner container image contract", () => {
  it("keeps runner bundle assembly app-owned and free of workspace repair steps", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );

    expect(bundleAssemblyScript).toContain("const runnerBundleDeployRoot = path.join(");
    expect(bundleAssemblyScript).toContain(
      'resolveCloudflareDeployPaths().deployDir,',
    );
    expect(bundleAssemblyScript).toContain('"runner-bundle",');
    expect(bundleAssemblyScript).toContain(
      'const stagingBundleDir = path.join(stagingRoot, "runner-bundle");',
    );
    expect(bundleAssemblyScript).toContain(
      "await materializeFinalRunnerBundle(",
    );
    expect(bundleAssemblyScript).toContain("runnerBundleDeployRoot,");
    expect(bundleAssemblyScript).toContain(
      "await stageRunnerVaultCliArtifact(",
    );
    expect(bundleAssemblyScript).toContain(
      "await packWorkspaceRuntimePackages(",
    );
    expect(bundleAssemblyScript).toContain(
      "await installPackedRunnerDependencies(",
    );
    expect(bundleAssemblyScript).toContain(
      'await runCommand(["install", "--prod", "--lockfile-only"], {',
    );
    expect(bundleAssemblyScript).toContain(
      'await runCommand(["install", "--prod", "--frozen-lockfile"], {',
    );
    expect(bundleAssemblyScript).toContain("await pruneNonRuntimeFiles(bundleDir);");
    expect(bundleAssemblyScript).not.toContain('"--legacy"');
    expect(bundleAssemblyScript).not.toContain('"deploy",');
  });

  it("keeps apps/cloudflare free of a direct @murphai/murph dependency and limits root deps to the worker runtime closure", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    )) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("@murphai/murph");
    expect(packageJson.dependencies).not.toHaveProperty(
      runnerVaultCliArtifactPackageName,
    );

    for (const dependencyName of hostedRunnerWorkerDependencyNames) {
      expect(packageJson.dependencies).toHaveProperty(dependencyName);
    }

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual(
      [...hostedRunnerWorkerDependencyNames].sort(),
    );
  });

  it("stages a self-described vault-cli artifact with its own runtime closure", async () => {
    const artifactDependencies = Object.fromEntries(
      runnerVaultCliArtifactDependencyNames.map((dependencyName) => [
        dependencyName,
        "1.2.3",
      ]),
    ) as Record<(typeof runnerVaultCliArtifactDependencyNames)[number], string>;
    const artifactPackageJson = buildRunnerVaultCliArtifactPackageJson({
      dependencies: artifactDependencies,
      license: "Apache-2.0",
      version: "0.0.0",
    });

    expect(Object.keys(artifactDependencies).sort()).toEqual(
      [...runnerVaultCliArtifactDependencyNames].sort(),
    );
    expect(artifactPackageJson.name).toBe(runnerVaultCliArtifactPackageName);
    expect(artifactPackageJson.exports).toEqual({
      ".": "./dist/runner-vault-cli.js",
      "./package.json": "./package.json",
    });
    expect(artifactPackageJson.bin).toEqual({
      "vault-cli": "./dist/runner-vault-cli-bin.js",
    });
    expect(artifactPackageJson.dependencies).toEqual(artifactDependencies);
  });

  it("pins whisper.cpp provisioning and default parser env in the image", async () => {
    const dockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("ARG WHISPER_CPP_VERSION=v1.8.1");
    expect(dockerfile).toContain("ARG WHISPER_MODEL_FILE=ggml-base.en.bin");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS whisper-builder");
    expect(dockerfile).toContain(
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_VERSION}.tar.gz",
    );
    expect(dockerfile).toContain(
      "cmake --build build -j\"$(nproc)\" --config Release --target whisper-cli",
    );
    expect(dockerfile).toContain("COPY --from=whisper-builder /opt/whisper/whisper-cli /usr/local/bin/whisper-cli");
    expect(dockerfile).toContain(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}",
    );
    expect(dockerfile).toContain(
      "COPY --chown=runner:runner apps/cloudflare/.deploy/runner-bundle/ /app/",
    );
    expect(dockerfile).not.toContain("runner-bundle-builder");
    expect(dockerfile).not.toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(dockerfile).toContain("PDFTOTEXT_COMMAND=/usr/bin/pdftotext");
    expect(dockerfile).toContain("WHISPER_COMMAND=/usr/local/bin/whisper-cli");
    expect(dockerfile).toContain(
      "WHISPER_MODEL_PATH=/home/runner/.murph/models/whisper/ggml-base.en.bin",
    );
    expect(dockerfile).toContain('CMD ["node", "dist/container-entrypoint.js"]');
  });

  it("keeps only the prepared runner bundle from .deploy in Docker context", async () => {
    const dockerignore = await readFile(
      new URL("../../../.dockerignore", import.meta.url),
      "utf8",
    );

    expect(dockerignore).toContain("apps/cloudflare/.deploy");
    expect(dockerignore).toContain("!apps/cloudflare/.deploy/");
    expect(dockerignore).toContain("apps/cloudflare/.deploy/*");
    expect(dockerignore).toContain("!apps/cloudflare/.deploy/runner-bundle/");
    expect(dockerignore).toContain("!apps/cloudflare/.deploy/runner-bundle/**");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/wrangler.generated.jsonc");
    expect(dockerignore).not.toContain("!apps/cloudflare/.deploy/worker-secrets.json");
  });
});
