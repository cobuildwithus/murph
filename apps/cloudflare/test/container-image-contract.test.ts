import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("hosted runner container image contract", () => {
  it("pins whisper.cpp provisioning and default parser env in the image", async () => {
    const dockerfile = await readFile(
      new URL("../../../Dockerfile.cloudflare-hosted-runner", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("ARG WHISPER_CPP_VERSION=v1.8.1");
    expect(dockerfile).toContain("ARG WHISPER_MODEL_FILE=ggml-base.en.bin");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS whisper-builder");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS runner-bundle-builder");
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
    expect(dockerfile).toContain("corepack prepare pnpm@10.33.0 --activate");
    expect(dockerfile).toContain(
      "pnpm --filter @murphai/cloudflare-runner deploy --legacy --prod /opt/runner-bundle",
    );
    expect(dockerfile).toContain(
      "COPY --from=runner-bundle-builder --chown=runner:runner /opt/runner-bundle/ /app/",
    );
    expect(dockerfile).toContain("PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
    expect(dockerfile).toContain("PDFTOTEXT_COMMAND=/usr/bin/pdftotext");
    expect(dockerfile).toContain("WHISPER_COMMAND=/usr/local/bin/whisper-cli");
    expect(dockerfile).toContain(
      "WHISPER_MODEL_PATH=/home/runner/.murph/models/whisper/ggml-base.en.bin",
    );
    expect(dockerfile).toContain('CMD ["node", "dist/container-entrypoint.js"]');
  });
});
