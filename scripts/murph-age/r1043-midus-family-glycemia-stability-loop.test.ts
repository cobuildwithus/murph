import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1043Safe,
  R1043_MIDUS_FAMILY_GLYCEMIA_STABILITY_SCHEMA_VERSION,
  runR1043MidusFamilyGlycemiaStabilityLoop,
} from "./r1043-midus-family-glycemia-stability-loop.ts";

const FORBIDDEN_SENTINELS = [
  "M0001",
  "R0001",
  "M2ID",
  "MRID",
  "DOD_Y",
  "B4BHA1C",
  "RA4BHA1C",
  "coefficients\":",
  "predictions\":",
] as const;

describe("R1043 MIDUS-family glycemia stability loop", () => {
  it("runs same-family MIDUS transport with aggregate-only output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1043-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "out");
      await mkdir(downloadsDir, { recursive: true });
      await writeMidusLikeDownloads(downloadsDir, "midus2");
      await writeMidusLikeDownloads(downloadsDir, "midus-refresher");

      const { output, outputPath } = await runR1043MidusFamilyGlycemiaStabilityLoop({
        createdAt: "2026-05-13T00:00:00.000Z",
        downloadsDir,
        iterations: 30,
        outputDir,
      });

      expect(output.schemaVersion).toBe(R1043_MIDUS_FAMILY_GLYCEMIA_STABILITY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.rowValuesStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.modelParametersStored).toBe(false);
      expect(output.localPathsStored).toBe(false);
      expect(output.decision.reviewGptRequiredBeforeNextLocalRun).toBe(false);
      expect(output.transportViews.midus2_to_midus_refresher.candidates.A1_glycemia).toBeDefined();
      expect(output.transportViews.midus_refresher_to_midus2.candidates.A2_glycemia_body).toBeDefined();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(() => assertR1043Safe(output)).not.toThrow();

      for (const shape of Object.values(output.dataShape)) {
        for (const counts of Object.values(shape.splitCounts)) {
          expect(counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
          expect(counts.n - counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
        }
      }

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      for (const sentinel of FORBIDDEN_SENTINELS) expect(serialized).not.toContain(sentinel);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if product display is switched on", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1043-mutated-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeMidusLikeDownloads(downloadsDir, "midus2");
      await writeMidusLikeDownloads(downloadsDir, "midus-refresher");
      const { output } = await runR1043MidusFamilyGlycemiaStabilityLoop({
        downloadsDir,
        iterations: 20,
        outputDir: path.join(tmp, "out"),
      });
      const unsafe: Record<string, unknown> = { ...output, productDisplayAuthorized: true };
      expect(() => assertR1043Safe(unsafe as never)).toThrow("R1043 MIDUS-family glycemia stability loop failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1043-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeMidusLikeDownloads(downloadsDir, "midus2");
      await writeMidusLikeDownloads(downloadsDir, "midus-refresher");
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1043-midus-family-glycemia-stability-loop.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_R1043_ITERATIONS: "25",
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        packetId: string;
        productDisplayAuthorized: boolean;
        rowValuesStored: boolean;
        status: string;
      };
      expect(summary.packetId).toBe("r1043-midus-family-glycemia-stability-loop");
      expect(summary.productDisplayAuthorized).toBe(false);
      expect(summary.rowValuesStored).toBe(false);
      expect(summary.status).toBe("research-local-aggregate-only");
      expect(stdout).not.toContain(tmp);
      for (const sentinel of FORBIDDEN_SENTINELS) expect(stdout).not.toContain(sentinel);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeMidusLikeDownloads(downloadsDir: string, cohort: "midus-refresher" | "midus2"): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), `murph-age-r1043-${cohort}-stage-`));
  try {
    const config = cohort === "midus2"
      ? {
        biomarkerEntry: "ICPSR_29282/DS0001/29282-0001-Data.tsv",
        biomarkerZip: "ICPSR_29282-V11.zip",
        columns: ["M2ID", "B4ZAGE", "B1PRSEX", "B4PBMI", "B4BHA1C", "B4BTRIGL", "B4BHDL"],
        idPrefix: "M",
        mortalityEntry: "ICPSR_37237/DS0001/37237-0001-Data.tsv",
        mortalityZip: "ICPSR_37237-V6.zip",
        surveyColumns: ["M2ID", "B1PIDATE_YR"],
        surveyEntry: "ICPSR_04652/DS0001/04652-0001-Data.tsv",
        surveyZip: "ICPSR_04652-V8.zip",
      }
      : {
        biomarkerEntry: "ICPSR_36901/DS0001/36901-0001-Data.tsv",
        biomarkerZip: "ICPSR_36901-V6.zip",
        columns: ["MRID", "RA4ZAGE", "RA1PRSEX", "RA4PBMI", "RA4BHA1C", "RA4BTRIGL", "RA4BHDL"],
        idPrefix: "R",
        mortalityEntry: "ICPSR_38024/DS0001/38024-0001-Data.tsv",
        mortalityZip: "ICPSR_38024-V3.zip",
        surveyColumns: ["MRID", "RA1PIDATE_YR"],
        surveyEntry: "ICPSR_36532/DS0001/36532-0001-Data.tsv",
        surveyZip: "ICPSR_36532-V4.zip",
      };

    await mkdir(path.join(staging, path.dirname(config.surveyEntry)), { recursive: true });
    await mkdir(path.join(staging, path.dirname(config.biomarkerEntry)), { recursive: true });
    await mkdir(path.join(staging, path.dirname(config.mortalityEntry)), { recursive: true });

    const surveyRows = [config.surveyColumns.join("\t")];
    const biomarkerRows = [config.columns.join("\t")];
    const mortalityRows = [[config.surveyColumns[0], "DOD_Y"].join("\t")];
    for (let index = 0; index < 720; index += 1) {
      const id = `${config.idPrefix}${String(index).padStart(4, "0")}`;
      const age = cohort === "midus2" ? 42 + (index % 32) : 37 + (index % 30);
      const male = index % 2 === 0 ? 1 : 2;
      const bmi = 23 + (index % 16) / 2;
      const event = index % 5 === 0 || (age > 62 && index % 3 === 0);
      const hba1c = 5.1 + (event ? 1 : 0) + (index % 6) / 10;
      surveyRows.push([id, "2005"].join("\t"));
      biomarkerRows.push([
        id,
        String(age),
        String(male),
        String(bmi),
        String(hba1c),
        String(95 + (event ? 45 : 0) + (index % 70)),
        String(44 + (event ? -3 : 4) + (index % 12)),
      ].join("\t"));
      mortalityRows.push([id, event ? "2010" : ""].join("\t"));
    }

    await writeFile(path.join(staging, config.surveyEntry), `${surveyRows.join("\n")}\n`);
    await writeFile(path.join(staging, config.biomarkerEntry), `${biomarkerRows.join("\n")}\n`);
    await writeFile(path.join(staging, config.mortalityEntry), `${mortalityRows.join("\n")}\n`);
    zipDirectory(staging, downloadsDir, config.surveyZip, config.surveyEntry.split("/")[0]!);
    zipDirectory(staging, downloadsDir, config.biomarkerZip, config.biomarkerEntry.split("/")[0]!);
    zipDirectory(staging, downloadsDir, config.mortalityZip, config.mortalityEntry.split("/")[0]!);
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

function zipDirectory(stagingDir: string, downloadsDir: string, zipName: string, topLevelDir: string): void {
  execFileSync("zip", ["-qr", path.join(downloadsDir, zipName), topLevelDir], { cwd: stagingDir });
}
