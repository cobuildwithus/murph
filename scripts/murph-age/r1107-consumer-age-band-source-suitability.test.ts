import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1107_CONSUMER_AGE_BAND_SOURCE_SUITABILITY_SCHEMA_VERSION,
  runR1107ConsumerAgeBandSourceSuitability,
} from "./r1107-consumer-age-band-source-suitability.ts";

describe("R1107 consumer age-band source suitability", () => {
  it("bins local outcome-linked lab sources and keeps older/source-mismatch evidence as shadow", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1107-"));
    try {
      await writeFixtureDownloads(tmp);

      const { output, outputPath } = await runR1107ConsumerAgeBandSourceSuitability({
        createdAt: "2026-05-15T00:00:00.000Z",
        downloadsDir: tmp,
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1107-consumer-age-band-source-suitability.latest.json");
      expect(output.schemaVersion).toBe(R1107_CONSUMER_AGE_BAND_SOURCE_SUITABILITY_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        combinedConsumer16To50EventBand: "1-9",
        combinedConsumer16To50RowBand: "1-9",
        conclusion: "current_sources_are_shadow_or_older_transport_only",
        nextAction: "keep_labs_as_shadow_seek_younger_or_consumer_outcome_source",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        wearableOutcomeLinkedRowsAvailable: false,
      });
      expect(output.sources.midus2.status).toBe("available");
      expect(output.sources.midusRefresher.status).toBe("available");
      expect(output.sources.creles.status).toBe("available");
      expect(output.sources.creles.ageBands["66_plus"].eventCountBand).toBe("1-9");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits cleanly when source packages are absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1107-missing-"));
    try {
      const { output } = await runR1107ConsumerAgeBandSourceSuitability({
        downloadsDir: tmp,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.summary.conclusion).toBe("current_sources_missing");
      expect(output.summary.nextAction).toBe("repair_or_download_source_packages");
      expect(Object.values(output.sources).every((source) => source.status === "missing_or_unreadable")).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1107-cli-"));
    try {
      await writeFixtureDownloads(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1107-consumer-age-band-source-suitability.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: tmp,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        wearableOutcomeLinkedRowsAvailable: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "current_sources_are_shadow_or_older_transport_only",
        packetId: "r1107-consumer-age-band-source-suitability",
        productDisplayAuthorized: false,
        wearableOutcomeLinkedRowsAvailable: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("IDSUJETO");
      expect(stdout).not.toContain("M2ID");
      expect(stdout).not.toContain("MRID");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureDownloads(downloadsDir: string): Promise<void> {
  await writeZip(downloadsDir, "ICPSR_04652-V8.zip", {
    "ICPSR_04652/DS0001/04652-0001-Data.tsv": toTsv([
      ["M2ID", "B1PIDATE_YR"],
      ["m2a", "2010"],
      ["m2b", "2010"],
      ["m2c", "2010"],
    ]),
  });
  await writeZip(downloadsDir, "ICPSR_29282-V11.zip", {
    "ICPSR_29282/DS0001/29282-0001-Data.tsv": toTsv([
      ["M2ID", "B4ZAGE", "B4PBMI", "B4BHA1C", "B4BTRIGL", "B4BHDL"],
      ["m2a", "30", "24", "5.4", "100", "55"],
      ["m2b", "45", "27", "5.9", "130", "48"],
      ["m2c", "61", "29", "6.1", "150", "44"],
    ]),
  });
  await writeZip(downloadsDir, "ICPSR_37237-V6.zip", {
    "ICPSR_37237/DS0001/37237-0001-Data.tsv": toTsv([
      ["M2ID", "DOD_Y"],
      ["m2a", "2015"],
      ["m2b", ""],
      ["m2c", "2016"],
    ]),
  });

  await writeZip(downloadsDir, "ICPSR_36532-V4.zip", {
    "ICPSR_36532/DS0001/36532-0001-Data.tsv": toTsv([
      ["MRID", "RA1PIDATE_YR"],
      ["mra", "2012"],
      ["mrb", "2012"],
    ]),
  });
  await writeZip(downloadsDir, "ICPSR_36901-V6.zip", {
    "ICPSR_36901/DS0001/36901-0001-Data.tsv": toTsv([
      ["MRID", "RA4ZAGE", "RA4PBMI", "RA4BHA1C", "RA4BTRIGL", "RA4BHDL"],
      ["mra", "49", "25", "5.6", "120", "58"],
      ["mrb", "67", "30", "6.3", "180", "42"],
    ]),
  });
  await writeZip(downloadsDir, "ICPSR_38024-V3.zip", {
    "ICPSR_38024/DS0001/38024-0001-Data.tsv": toTsv([
      ["MRID", "DOD_Y"],
      ["mra", ""],
      ["mrb", "2018"],
    ]),
  });

  await writeZip(downloadsDir, "ICPSR_26681-V3.zip", {
    "ICPSR_26681/DS0010/26681-0010-Data.tsv": toTsv([
      ["IDSUJETO", "AGE"],
      ["ca", "48"],
      ["cb", "70"],
    ]),
    "ICPSR_26681/DS0002/26681-0002-Data.tsv": toTsv([
      ["IDSUJETO", "IMC", "HBAC1", "TGS", "HDL", "SISTOLICA", "DIASTOLICA"],
      ["ca", "26", "5.8", "130", "50", "120", "78"],
      ["cb", "31", "6.4", "180", "38", "145", "88"],
    ]),
  });
  await writeZip(downloadsDir, "ICPSR_35250-V2.zip", {
    "ICPSR_35250/DS0013/35250-0013-Data.tsv": toTsv([
      ["IDSUJETO", "TRACK_W3"],
      ["ca", "1"],
      ["cb", "2"],
    ]),
  });
}

async function writeZip(downloadsDir: string, zipName: string, entries: Record<string, string>): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "r1107-zip-"));
  try {
    for (const [entry, content] of Object.entries(entries)) {
      const filePath = path.join(staging, entry);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
    await mkdir(downloadsDir, { recursive: true });
    execFileSync("zip", ["-qr", path.join(downloadsDir, zipName), ...Array.from(new Set(
      Object.keys(entries).map((entry) => entry.split("/")[0]!),
    ))], { cwd: staging });
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

function toTsv(rows: string[][]): string {
  return `${rows.map((row) => row.join("\t")).join("\n")}\n`;
}
