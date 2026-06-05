import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  printArtifactMetadata,
} from "@murphai/health-commons";
import { parseCliOptions as parseBuildCliOptions } from "../src/build.ts";
import { sha256Buffer } from "../src/normalize.ts";
import { parseCliOptions as parseHashCliOptions } from "../src/hash-artifact.ts";
import { parseCliOptions as parseSyncCliOptions } from "../src/sync-cloudflare-r2.ts";
import { syncHealthCommonsArtifactsToCloudflareR2 } from "../src/sync-cloudflare-r2.ts";
import { writeHealthCommonsGeneratedArtifacts } from "../src/build.ts";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createTempDir(prefix: string): Promise<string> {
  return await fsMkdtemp(path.isAbsolute(prefix) ? prefix : path.join(os.tmpdir(), prefix));
}

async function fsMkdtemp(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return await mkdtemp(prefix);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("@murphai/health-commons coverage scaffolding", () => {
  it("writes generated artifacts and checks them again through the build CLI", async () => {
    const contentRoot = await createTempDir("health-commons-content-");
    const generatedRoot = await createTempDir("health-commons-generated-");

    try {
      await writeFile(
        path.join(contentRoot, "example.md"),
        `---\nschemaVersion: murph.commons.page.v1\nentityType: biomarker\nkey: biomarker:example\nslug: biomarkers/example\ntitle: Example biomarker\n---\n\nExample biomarker.\n`,
        "utf8",
      );
      await writeHealthCommonsGeneratedArtifacts({
        check: false,
        contentRoot,
        generatedRoot,
      });

      const protocolIndexJson = await readFile(path.join(generatedRoot, "protocol-index.json"), "utf8");
      expect(protocolIndexJson).toContain("\"catalogHash\"");

      await writeHealthCommonsGeneratedArtifacts({
        check: true,
        contentRoot,
        generatedRoot,
      });

      expect(
        parseBuildCliOptions([
          "--check",
          "--content-root",
          contentRoot,
          "--generated-root",
          generatedRoot,
        ]),
      ).toEqual({
        check: true,
        contentRoot,
        generatedRoot,
      });
      expect(() => parseBuildCliOptions(["--content-root"])).toThrow(
        "--content-root requires a value.",
      );
      expect(() => parseBuildCliOptions(["--bogus"])).toThrow(
        "Unknown health-commons build argument: --bogus",
      );
    } finally {
      await rm(contentRoot, { recursive: true, force: true });
      await rm(generatedRoot, { recursive: true, force: true });
    }
  });

  it("rejects check mode when generated files are missing", async () => {
    const contentRoot = await createTempDir("health-commons-content-");
    const generatedRoot = path.join(contentRoot, "missing-generated");

    try {
      await writeFile(
        path.join(contentRoot, "example.md"),
        `---\nschemaVersion: murph.commons.page.v1\nentityType: biomarker\nkey: biomarker:example\nslug: biomarkers/example\ntitle: Example biomarker\n---\n\nExample biomarker.\n`,
        "utf8",
      );
      await expect(
        writeHealthCommonsGeneratedArtifacts({
          check: true,
          contentRoot,
          generatedRoot,
        }),
      ).rejects.toThrow("Health Commons generated artifacts are out of date");

      await expect(
        readFile(path.join(generatedRoot, "protocol-index.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(contentRoot, { recursive: true, force: true });
    }
  });

  it("keeps package typecheck behind generated artifact refresh", async () => {
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.typecheck).toBe("pnpm generate && tsc -p tsconfig.typecheck.json --pretty false");
    expect(packageJson.scripts?.verify).toContain("pnpm typecheck");
  });

  it("prints normalized artifact metadata for in-repo files and rejects external defaults", async () => {
    const repoTempRoot = await createTempDir(path.join(packageRoot, ".tmp-health-commons-inrepo-"));
    const repoFile = path.join(repoTempRoot, "pmid-29849692.pdf");
    const externalRoot = await createTempDir("murph-health-commons-external-");
    const externalFile = path.join(externalRoot, "pmid-29849692.pdf");

    try {
      await writeFile(repoFile, "sauna", "utf8");
      await writeFile(externalFile, "sauna", "utf8");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      await printArtifactMetadata({
        artifactId: null,
        contentType: "application/pdf",
        file: repoFile,
        kind: "pdf",
        localPath: null,
        objectKey: null,
        rightsStatus: "permission_required",
        redistributable: false,
        sourceKey: "source_artifact:pmid-29849692",
        sourceUrl: "https://example.invalid/pmid-29849692",
        storage: "cloudflare-r2",
      });

      const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? "")) as {
        artifactId: string;
        localPath: string;
        objectKey: string;
        sha256: string;
      };
      expect(printed.artifactId).toBe("art_pmid_29849692_pdf");
      expect(printed.localPath).toMatch(/pmid-29849692\.pdf$/u);
      expect(printed.objectKey).toBe("commons/research/sauna/pmid_29849692/source.pdf");
      expect(printed.sha256).toBe(sha256Buffer(Buffer.from("sauna")));

      await expect(
        printArtifactMetadata({
          artifactId: null,
          contentType: "application/pdf",
          file: externalFile,
          kind: "pdf",
          localPath: null,
          objectKey: null,
          rightsStatus: "permission_required",
          redistributable: false,
          sourceKey: "source_artifact:pmid-29849692",
          sourceUrl: "https://example.invalid/pmid-29849692",
          storage: "cloudflare-r2",
        }),
      ).rejects.toThrow(
          "Default localPath only works for files inside the repo. Pass --local-path for external files.",
      );

      expect(
        parseHashCliOptions([
          "--artifact-id",
          "art_custom_pdf",
          "--content-type",
          "application/pdf",
          "--file",
          repoFile,
          "--kind",
          "pdf",
          "--local-path",
          "research-artifacts/sauna/custom.pdf",
          "--object-key",
          "commons/research/sauna/custom/source.pdf",
          "--rights-status",
          "open_access",
          "--redistributable",
          "--source-key",
          "source_artifact:pmid-29849692",
          "--source-url",
          "https://example.invalid/pmid-29849692",
          "--storage",
          "external",
        ]),
      ).toEqual({
        artifactId: "art_custom_pdf",
        contentType: "application/pdf",
        file: repoFile,
        kind: "pdf",
        localPath: "research-artifacts/sauna/custom.pdf",
        objectKey: "commons/research/sauna/custom/source.pdf",
        rightsStatus: "open_access",
        redistributable: true,
        sourceKey: "source_artifact:pmid-29849692",
        sourceUrl: "https://example.invalid/pmid-29849692",
        storage: "external",
      });
      expect(
        parseHashCliOptions(["--file", repoFile]),
      ).toMatchObject({
        file: repoFile,
      });
      expect(() => parseHashCliOptions(["--file"])).toThrow("--file requires a value.");
      expect(() => parseHashCliOptions(["--bogus"])).toThrow(
        "Unknown hash-artifact argument: --bogus",
      );
      logSpy.mockRestore();
    } finally {
      await rm(repoTempRoot, { recursive: true, force: true });
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("syncs Cloudflare R2 candidates in dry-run and upload mode", async () => {
    const contentRoot = await createTempDir("health-commons-content-");
    const artifactRoot = await createTempDir("health-commons-artifacts-");
    const artifactRelativePath = "research-artifacts/sauna/pmid-29849692.pdf";
    const artifactAbsolutePath = path.join(artifactRoot, artifactRelativePath);
    const artifactDir = path.dirname(artifactAbsolutePath);
    const artifactBytes = Buffer.from("sauna");
    const artifactSha256 = sha256Buffer(artifactBytes);

    try {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(artifactAbsolutePath, artifactBytes);
      await mkdir(path.join(contentRoot, "artifacts", "sauna"), { recursive: true });
      await writeFile(
        path.join(contentRoot, "artifacts", "sauna", "research-artifacts.json"),
        JSON.stringify(
          {
            schemaVersion: "murph.commons.artifact-manifest.v1",
            manifestKey: "source_artifact:pmid-29849692/research-artifacts",
            artifacts: [
              {
                artifactId: "art_pmid_29849692_pdf",
                kind: "pdf",
                storage: "cloudflare-r2",
                objectKey: "commons/research/sauna/pmid_29849692/source.pdf",
                localPath: artifactRelativePath,
                rightsStatus: "permission_required",
                redistributable: false,
                sha256: artifactSha256,
                byteSize: artifactBytes.byteLength,
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );
      await writeFile(
        path.join(contentRoot, "source.md"),
        `---\nschemaVersion: murph.commons.page.v1\nentityType: source_artifact\nkey: source_artifact:pmid-29849692\nslug: sources/pmid-29849692\ntitle: PMID 29849692\nsource:\n  kind: web_page\n  url: https://example.com/pmid-29849692\nartifacts:\n  -\n    artifactId: art_pmid_29849692_pdf\n    kind: pdf\n    storage: cloudflare-r2\n    objectKey: commons/research/sauna/pmid_29849692/source.pdf\n    localPath: ${artifactRelativePath}\n    rightsStatus: permission_required\n    redistributable: false\n    sha256: ${artifactSha256}\n    byteSize: ${artifactBytes.byteLength}\n---\n\nSource page.\n`,
        "utf8",
      );

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await syncHealthCommonsArtifactsToCloudflareR2({
        allowUnclearedRights: false,
        artifactRoot,
        bucket: "health-commons",
        contentRoot,
        dryRun: true,
        remote: false,
      });
      expect(logSpy.mock.calls[0]?.[0]).toContain("DRY RUN BLOCKED art_pmid_29849692_pdf");

      logSpy.mockClear();
      await syncHealthCommonsArtifactsToCloudflareR2({
        allowUnclearedRights: true,
        artifactRoot,
        bucket: "health-commons",
        contentRoot,
        dryRun: true,
        remote: false,
      });
      expect(logSpy.mock.calls[0]?.[0]).toContain("DRY RUN pnpm --dir apps/cloudflare exec wrangler r2 object put");

      await syncHealthCommonsArtifactsToCloudflareR2({
        allowUnclearedRights: true,
        artifactRoot,
        bucket: "health-commons",
        contentRoot,
        dryRun: false,
        remote: false,
      });

      expect(
        parseSyncCliOptions([
          "--content-root",
          contentRoot,
          "--artifact-root",
          artifactRoot,
          "--bucket",
          "health-commons",
          "--allow-uncleared-rights",
          "--dry-run",
          "--local",
        ]),
      ).toMatchObject({
        allowUnclearedRights: true,
        artifactRoot,
        bucket: "health-commons",
        contentRoot,
        dryRun: true,
        remote: false,
      });
      expect(() => parseSyncCliOptions(["--bucket"])).toThrow("--bucket requires a value.");
      expect(() => parseSyncCliOptions(["--bogus"])).toThrow(
        "Unknown health-commons artifact sync argument: --bogus",
      );
    } finally {
      await rm(contentRoot, { recursive: true, force: true });
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});
