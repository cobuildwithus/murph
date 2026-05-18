import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1041Safe,
  R1041_MINIMAL_GLYCEMIA_TRANSPORT_SCHEMA_VERSION,
  runR1041MinimalGlycemiaTransportLoop,
} from "./r1041-minimal-glycemia-transport-loop.ts";

const FORBIDDEN_SENTINELS = [
  "M0001",
  "C0001",
  "M2ID",
  "IDSUJETO",
  "TRACK_W3",
  "DOD_Y",
  "B4BHA1C",
  "HBAC1",
  "coefficients\":",
  "predictions\":",
] as const;

const MIDUS2_SURVEY_ENTRY = "ICPSR_04652/DS0001/04652-0001-Data.tsv";
const MIDUS2_BIOMARKER_ENTRY = "ICPSR_29282/DS0001/29282-0001-Data.tsv";
const MIDUS2_MORTALITY_ENTRY = "ICPSR_37237/DS0001/37237-0001-Data.tsv";
const CRELES_WAVE1_RECODED_ENTRY = "ICPSR_26681/DS0010/26681-0010-Data.tsv";
const CRELES_WAVE1_BIOMARKER_ENTRY = "ICPSR_26681/DS0002/26681-0002-Data.tsv";
const CRELES_WAVE3_FOLLOWUP_ENTRY = "ICPSR_35250/DS0013/35250-0013-Data.tsv";

describe("R1041 minimal glycemia transport loop", () => {
  it("runs MIDUS and CRELES minimal glycemia transport with aggregate-only output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1041-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "out");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidusDownloads(downloadsDir);
      await writeSyntheticCrelesDownloads(downloadsDir);

      const { output, outputPath } = await runR1041MinimalGlycemiaTransportLoop({
        createdAt: "2026-05-13T00:00:00.000Z",
        downloadsDir,
        iterations: 35,
        outputDir,
      });

      expect(output.schemaVersion).toBe(R1041_MINIMAL_GLYCEMIA_TRANSPORT_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.packetId).toBe("r1041-minimal-glycemia-transport-loop");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.rowValuesStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.modelParametersStored).toBe(false);
      expect(output.localPathsStored).toBe(false);
      expect(output.decision.reviewGptRequiredBeforeNextLocalRun).toBe(false);
      expect(output.featureAvailability.unharmonizedCandidateIds).toContain("A3_glycemia_body_bp");
      expect(output.localModels.creles.A3_glycemia_body_bp).toBeDefined();
      expect(output.localModels.midus2.A3_glycemia_body_bp).toBeUndefined();
      expect(output.transportViews.midus2_to_creles.candidates.A1_glycemia).toBeDefined();
      expect(output.transportViews.creles_to_midus2.candidates.A2_glycemia_body).toBeDefined();
      expect(output.transportViews.midus2_to_creles.candidates.A3_glycemia_body_bp).toBeUndefined();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(() => assertR1041Safe(output)).not.toThrow();

      for (const shape of Object.values(output.dataShape)) {
        for (const counts of Object.values(shape.splitCounts)) {
          expect(counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
          expect(counts.n - counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
        }
      }

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      for (const sentinel of FORBIDDEN_SENTINELS) {
        expect(serialized).not.toContain(sentinel);
      }

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if product display is switched on", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1041-mutated-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidusDownloads(downloadsDir);
      await writeSyntheticCrelesDownloads(downloadsDir);
      const { output } = await runR1041MinimalGlycemiaTransportLoop({
        downloadsDir,
        iterations: 20,
        outputDir: path.join(tmp, "out"),
      });

      const unsafe: Record<string, unknown> = {
        ...output,
        productDisplayAuthorized: true,
      };
      expect(() => assertR1041Safe(unsafe as never)).toThrow("R1041 minimal glycemia transport loop failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1041-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidusDownloads(downloadsDir);
      await writeSyntheticCrelesDownloads(downloadsDir);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1041-minimal-glycemia-transport-loop.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_R1041_ITERATIONS: "25",
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        packetId: string;
        productDisplayAuthorized: boolean;
        rowValuesStored: boolean;
        status: string;
      };
      expect(summary.packetId).toBe("r1041-minimal-glycemia-transport-loop");
      expect(summary.productDisplayAuthorized).toBe(false);
      expect(summary.rowValuesStored).toBe(false);
      expect(summary.status).toBe("research-local-aggregate-only");
      expect(stdout).not.toContain(tmp);
      for (const sentinel of FORBIDDEN_SENTINELS) {
        expect(stdout).not.toContain(sentinel);
      }
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticMidusDownloads(downloadsDir: string): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1041-midus-stage-"));
  try {
    await mkdir(path.join(staging, "ICPSR_04652/DS0001"), { recursive: true });
    await mkdir(path.join(staging, "ICPSR_29282/DS0001"), { recursive: true });
    await mkdir(path.join(staging, "ICPSR_37237/DS0001"), { recursive: true });

    const surveyRows = [["M2ID", "B1PIDATE_YR"].join("\t")];
    const biomarkerRows = [["M2ID", "B4ZAGE", "B1PRSEX", "B4PBMI", "B4BHA1C", "B4BTRIGL", "B4BHDL"].join("\t")];
    const mortalityRows = [["M2ID", "DOD_Y"].join("\t")];
    for (let index = 0; index < 720; index += 1) {
      const id = `M${String(index).padStart(4, "0")}`;
      const age = 42 + (index % 32);
      const male = index % 2 === 0 ? 1 : 2;
      const bmi = 23 + (index % 15) / 2;
      const highRisk = age > 64 || index % 7 === 0;
      const event = index % 5 === 0 || (highRisk && index % 3 === 0);
      const hba1c = 5.1 + (event ? 1 : 0) + (index % 6) / 10;
      surveyRows.push([id, "2005"].join("\t"));
      biomarkerRows.push([
        id,
        String(age),
        String(male),
        String(bmi),
        String(hba1c),
        String(95 + (event ? 55 : 0) + (index % 70)),
        String(44 + (event ? -4 : 4) + (index % 12)),
      ].join("\t"));
      mortalityRows.push([id, event ? "2010" : ""].join("\t"));
    }

    await writeFile(path.join(staging, MIDUS2_SURVEY_ENTRY), `${surveyRows.join("\n")}\n`);
    await writeFile(path.join(staging, MIDUS2_BIOMARKER_ENTRY), `${biomarkerRows.join("\n")}\n`);
    await writeFile(path.join(staging, MIDUS2_MORTALITY_ENTRY), `${mortalityRows.join("\n")}\n`);
    zipDirectory(staging, downloadsDir, "ICPSR_04652-V8.zip", "ICPSR_04652");
    zipDirectory(staging, downloadsDir, "ICPSR_29282-V11.zip", "ICPSR_29282");
    zipDirectory(staging, downloadsDir, "ICPSR_37237-V6.zip", "ICPSR_37237");
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

async function writeSyntheticCrelesDownloads(downloadsDir: string): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1041-creles-stage-"));
  try {
    await mkdir(path.join(staging, "ICPSR_26681/DS0010"), { recursive: true });
    await mkdir(path.join(staging, "ICPSR_26681/DS0002"), { recursive: true });
    await mkdir(path.join(staging, "ICPSR_35250/DS0013"), { recursive: true });

    const recodedRows = [["IDSUJETO", "AGE", "SEX"].join("\t")];
    const biomarkerRows = [
      ["IDSUJETO", "IMC", "HBAC1", "TGS", "HDL", "SISTOLICA", "DIASTOLICA"].join("\t"),
    ];
    const followupRows = [["IDSUJETO", "TRACK_W3"].join("\t")];
    for (let index = 0; index < 720; index += 1) {
      const id = `C${String(index).padStart(4, "0")}`;
      const age = 61 + (index % 28);
      const male = index % 2 === 0 ? 1 : 2;
      const bmi = 22 + (index % 18) / 2;
      const event = index % 4 === 0 || (age > 78 && index % 3 === 0);
      const hba1c = 5.3 + (event ? 0.8 : 0) + (index % 8) / 10;
      recodedRows.push([id, String(age), String(male)].join("\t"));
      biomarkerRows.push([
        id,
        String(bmi),
        String(hba1c),
        String(100 + (event ? 45 : 0) + (index % 60)),
        String(43 + (event ? -3 : 5) + (index % 10)),
        String(116 + (event ? 12 : 0) + (index % 14)),
        String(70 + (event ? 6 : 0) + (index % 8)),
      ].join("\t"));
      followupRows.push([id, event ? "2" : "1"].join("\t"));
    }

    await writeFile(path.join(staging, CRELES_WAVE1_RECODED_ENTRY), `${recodedRows.join("\n")}\n`);
    await writeFile(path.join(staging, CRELES_WAVE1_BIOMARKER_ENTRY), `${biomarkerRows.join("\n")}\n`);
    await writeFile(path.join(staging, CRELES_WAVE3_FOLLOWUP_ENTRY), `${followupRows.join("\n")}\n`);
    zipDirectory(staging, downloadsDir, "ICPSR_26681-V3.zip", "ICPSR_26681");
    zipDirectory(staging, downloadsDir, "ICPSR_35250-V2.zip", "ICPSR_35250");
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

function zipDirectory(stagingDir: string, downloadsDir: string, zipName: string, topLevelDir: string): void {
  execFileSync("zip", ["-qr", path.join(downloadsDir, zipName), topLevelDir], { cwd: stagingDir });
}
