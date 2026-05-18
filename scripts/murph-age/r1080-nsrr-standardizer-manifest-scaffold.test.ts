import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1078_DEFAULT_ANALYTIC_CACHE_PATH } from "./r1078-nsrr-sleep-autonomic-local-loop.ts";
import { R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION } from "./r1079-nsrr-sleep-autonomic-standardizer.ts";
import {
  R1080_NSRR_STANDARDIZER_MANIFEST_SCAFFOLD_SCHEMA_VERSION,
  runR1080NsrrStandardizerManifestScaffold,
} from "./r1080-nsrr-standardizer-manifest-scaffold.ts";

describe("R1080 NSRR standardizer manifest scaffold", () => {
  it("writes a private draft manifest from a header without source-column egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1080-run-"));
    const draftPath = runtimeDraftPath(tmp, "run");
    try {
      const sourcePath = path.join(tmp, "downloaded-source.csv");
      await writePrivateHeaderSource(sourcePath);

      const { output, outputPath } = await runR1080NsrrStandardizerManifestScaffold({
        createdAt: "2026-05-14T00:00:00.000Z",
        manifestDraftPath: draftPath,
        outputDir: path.join(tmp, "out"),
        sourceTablePath: sourcePath,
      });

      expect(path.basename(outputPath)).toBe("r1080-nsrr-standardizer-manifest-scaffold.latest.json");
      expect(output.schemaVersion).toBe(R1080_NSRR_STANDARDIZER_MANIFEST_SCAFFOLD_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        draftManifestWritten: true,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowValuesRead: false,
        rowValuesStored: false,
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_private_manifest_draft_ready_for_local_fill",
        nextLocalAction: "fill_private_manifest_column_map_then_run_r1079",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("downloaded-source.csv");
      expect(serialized).not.toContain("src_age");
      expect(serialized).not.toContain("src_event");

      const draft = JSON.parse(await readFile(draftPath, "utf8")) as {
        availableSourceColumns: string[];
        columnMap: Record<string, never>;
        endpoint: string;
        horizon: string;
        outputAnalyticCachePath: string;
        schemaVersion: string;
        sourceTablePath: string;
      };
      expect(draft.schemaVersion).toBe(R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION);
      expect(draft.availableSourceColumns).toContain("src_age");
      expect(draft.availableSourceColumns).toContain("src_event");
      expect(draft.columnMap).toEqual({});
      expect(draft.endpoint).toBe("fill_one_of_allowed_endpoint_values");
      expect(draft.horizon).toBe("fill_one_of_allowed_horizon_values");
      expect(draft.sourceTablePath).toBe(sourcePath);
      expect(draft.outputAnalyticCachePath).toBe(R1078_DEFAULT_ANALYTIC_CACHE_PATH);
    } finally {
      await rm(draftPath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects draft manifests outside the ignored private-map cache", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1080-unsafe-"));
    try {
      const sourcePath = path.join(tmp, "downloaded-source.csv");
      await writePrivateHeaderSource(sourcePath);

      await expect(runR1080NsrrStandardizerManifestScaffold({
        manifestDraftPath: path.join(tmp, "unsafe.draft.json"),
        outputDir: path.join(tmp, "out"),
        sourceTablePath: sourcePath,
      })).rejects.toThrow("ignored NSRR private-map runtime cache root");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1080-cli-"));
    const draftPath = runtimeDraftPath(tmp, "cli");
    try {
      const sourcePath = path.join(tmp, "downloaded-source.csv");
      await writePrivateHeaderSource(sourcePath);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1080-nsrr-standardizer-manifest-scaffold.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_SOURCE_TABLE_PATH: sourcePath,
          MURPH_AGE_NSRR_STANDARDIZER_DRAFT_PATH: draftPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        draftManifestWritten: boolean;
        packetId: string;
        rowValuesRead: boolean;
        sourceSpecificColumnNamesInExternalArtifact: boolean;
      };
      expect(summary).toMatchObject({
        draftManifestWritten: true,
        packetId: "r1080-nsrr-standardizer-manifest-scaffold",
        rowValuesRead: false,
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("src_age");
      expect(stdout).not.toContain("downloaded-source.csv");
    } finally {
      await rm(draftPath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writePrivateHeaderSource(sourcePath: string): Promise<void> {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, [
    [
      "src_local_id",
      "src_event",
      "src_age",
      "src_sex",
      "src_sleep_duration",
      "src_ahi",
      "src_rhr",
    ].join(","),
    [
      "local-1",
      "1",
      "72",
      "M",
      "6.5",
      "18",
      "64",
    ].join(","),
  ].join("\n") + "\n");
}

function runtimeDraftPath(tmp: string, suffix: string): string {
  return path.join(
    process.cwd(),
    ".runtime",
    "cache",
    "murph-age",
    "nsrr-sleep-autonomic",
    "private-maps",
    `${path.basename(tmp)}-${suffix}.draft.json`,
  );
}
