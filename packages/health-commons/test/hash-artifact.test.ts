import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { printArtifactMetadata } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

describe("hash artifact CLI helper", () => {
  it("prints manifest-ready metadata with stable defaults", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "health-commons-hash-"));
    const filePath = path.join(tempDir, "my sauna proof.pdf");

    try {
      await writeFile(filePath, "sauna");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      await printArtifactMetadata({
        artifactId: null,
        contentType: "application/pdf",
        file: filePath,
        kind: "pdf",
        localPath: null,
        objectKey: null,
        rightsStatus: "permission_required",
        redistributable: false,
        sourceKey: "source_artifact:sauna-proof",
        sourceUrl: "https://example.invalid/sauna-proof",
        storage: "cloudflare-r2",
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? ""));
      logSpy.mockRestore();

      expect(printed).toMatchObject({
        artifactId: "art_my_sauna_proof_pdf",
        byteSize: 5,
        contentType: "application/pdf",
        kind: "pdf",
        localPath: path.relative(repoRoot, filePath).split(path.sep).join(path.posix.sep),
        objectKey: "commons/research/sauna/my sauna proof/source.pdf",
        rightsStatus: "permission_required",
        redistributable: false,
        sourceKey: "source_artifact:sauna-proof",
        sourceUrl: "https://example.invalid/sauna-proof",
        storage: "cloudflare-r2",
      });
      expect(printed.sha256).toMatch(/^[a-f0-9]{64}$/u);
      logSpy.mockRestore();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
