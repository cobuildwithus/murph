import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1044Safe,
  R1044_HAALSI_EXTERNAL_BIOMARKER_SCHEMA_VERSION,
  runR1044HaalsiExternalBiomarkerLoop,
} from "./r1044-haalsi-external-biomarker-loop.ts";

const FORBIDDEN_SENTINELS = [
  "P0001",
  "PRIM_KEY",
  "W3STATUS",
  "W1C_BS_GLUCOSE",
  "W1C_BS_BMI",
  "coefficients\":",
  "predictions\":",
] as const;

describe("R1044 HAALSI external biomarker loop", () => {
  it("runs an external aggregate-only glucose biomarker benchmark", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1044-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "out");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticHaalsiDownload(downloadsDir);

      const { output, outputPath } = await runR1044HaalsiExternalBiomarkerLoop({
        createdAt: "2026-05-13T00:00:00.000Z",
        downloadsDir,
        iterations: 35,
        outputDir,
      });

      expect(output.schemaVersion).toBe(R1044_HAALSI_EXTERNAL_BIOMARKER_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.packetId).toBe("r1044-haalsi-external-biomarker-loop");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.rowValuesStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.modelParametersStored).toBe(false);
      expect(output.localPathsStored).toBe(false);
      expect(output.benchmarkCard.wearableClaim).toContain("none");
      expect(output.decision.physiologyExpansionStatus).toBe("shadow_only");
      expect(output.models.A1_glucose).toBeDefined();
      expect(output.models.F1_walk_difficulty_shadow.candidateRole).toBe("function_activity_shadow");
      expect(output.models.I1_glucose_body_pulse_walk_shadow.candidateRole).toBe("integrated_shadow");
      expect(output.models.NC6_missingness_quality_only.candidateRole).toBe("negative_control");
      expect(output.models.NC5_noise_feature.candidateRole).toBe("negative_control");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(() => assertR1044Safe(output)).not.toThrow();

      for (const counts of Object.values(output.dataShape.splitCounts)) {
        expect(counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
        expect(counts.n - counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
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
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1044-mutated-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticHaalsiDownload(downloadsDir);
      const { output } = await runR1044HaalsiExternalBiomarkerLoop({
        downloadsDir,
        iterations: 20,
        outputDir: path.join(tmp, "out"),
      });
      const unsafe: Record<string, unknown> = { ...output, productDisplayAuthorized: true };
      expect(() => assertR1044Safe(unsafe as never)).toThrow("R1044 HAALSI external biomarker loop failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1044-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticHaalsiDownload(downloadsDir);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1044-haalsi-external-biomarker-loop.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_R1044_ITERATIONS: "25",
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        packetId: string;
        productDisplayAuthorized: boolean;
        rowValuesStored: boolean;
        status: string;
      };
      expect(summary.packetId).toBe("r1044-haalsi-external-biomarker-loop");
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

async function writeSyntheticHaalsiDownload(downloadsDir: string): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1044-haalsi-stage-"));
  try {
    const entry = "ICPSR_36633/DS0001/36633-0001-Data.tsv";
    await mkdir(path.join(staging, path.dirname(entry)), { recursive: true });
    const header = [
      "PRIM_KEY",
      "W1C_RAGE_CALC",
      "W2C_RSEX",
      "W1C_BS_BMI",
      "W1C_BS_GLUCOSE",
      "W1C_BS_HEMOGLOBIN",
      "W1C_BS_CHOL",
      "W1C_BS_HDL",
      "W1C_BS_LDL",
      "W1C_BS_TRIG",
      "W1C_BS_MEAN_PULSE",
      "W1C_PF_DIFF_WALK",
      "W3STATUS",
    ];
    const rows = [header.join("\t")];
    for (let index = 0; index < 900; index += 1) {
      const id = `P${String(index).padStart(4, "0")}`;
      const age = 43 + (index % 38);
      const male = index % 2 === 0 ? 1 : 2;
      const event = index % 5 === 0 || (age > 70 && index % 3 === 0);
      const glucose = 4.8 + (event ? 1.5 : 0) + (index % 8) / 10;
      rows.push([
        id,
        String(age),
        String(male),
        String(22 + (index % 16) / 2),
        String(glucose),
        String(12 + (event ? -1 : 0) + (index % 5) / 10),
        String(4.1 + (index % 9) / 10),
        String(1.1 + (index % 5) / 10),
        String(2.2 + (index % 7) / 10),
        String(1.2 + (event ? 0.5 : 0) + (index % 7) / 10),
        String(65 + (event ? 8 : 0) + (index % 16)),
        String(event ? 3 : index % 2),
        event ? "0" : "1",
      ].join("\t"));
    }
    await writeFile(path.join(staging, entry), `${rows.join("\n")}\n`);
    execFileSync("zip", ["-qr", path.join(downloadsDir, "ICPSR_36633-V4.zip"), "ICPSR_36633"], {
      cwd: staging,
    });
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}
