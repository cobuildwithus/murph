import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("hosted runner container image contract", () => {
  it("keeps runner bundle assembly app-owned and free of workspace repair steps", async () => {
    const bundleAssemblyScript = await readFile(
      new URL("../scripts/assemble-runner-bundle.ts", import.meta.url),
      "utf8",
    );

    expect(bundleAssemblyScript).toContain(
      'const runnerBundleDeployRoot = path.join(resolveCloudflareDeployPaths().deployDir, "runner-bundle");',
    );
    expect(bundleAssemblyScript).toContain(
      'const stagingBundleDir = path.join(stagingRoot, "runner-bundle");',
    );
    expect(bundleAssemblyScript).toContain(
      "await materializeFinalRunnerBundle(stagingBundleDir, runnerBundleDeployRoot);",
    );
    expect(bundleAssemblyScript).not.toContain("pnpm install --frozen-lockfile");
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
