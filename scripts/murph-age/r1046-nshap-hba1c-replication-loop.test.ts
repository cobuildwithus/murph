import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1046Safe,
  R1046_NSHAP_HBA1C_REPLICATION_SCHEMA_VERSION,
  runR1046NshapHba1cReplicationLoop,
} from "./r1046-nshap-hba1c-replication-loop.ts";

const FORBIDDEN_SENTINELS = [
  "A1C_WHBL",
  "DECEASED",
  "HBA1C",
  "PULSE_MEAN",
  "coefficients\":",
  "predictions\":",
] as const;

describe("R1046 NSHAP HbA1c replication loop", () => {
  it("runs an aggregate-only HbA1c replication diagnostic", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1046-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "out");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticNshapDownloads(downloadsDir);

      const { output, outputPath } = await runR1046NshapHba1cReplicationLoop({
        createdAt: "2026-05-13T00:00:00.000Z",
        downloadsDir,
        iterations: 35,
        outputDir,
      });

      expect(output.schemaVersion).toBe(R1046_NSHAP_HBA1C_REPLICATION_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.rowValuesStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.modelParametersStored).toBe(false);
      expect(output.localPathsStored).toBe(false);
      expect(output.decision.pulseStatus).toBe("pulse_shadow_only");
      expect(output.decision.physiologyExpansionStatus).toBe("shadow_only");
      expect(output.sources.nshap_w1_to_w3.models.A1_hba1c).toBeDefined();
      expect(output.sources.nshap_w1_to_w3.models.S1_sleep_problem_shadow.candidateRole).toBe("sleep_shadow");
      expect(output.sources.nshap_w2_to_w3.models.F1_walking_function_shadow.candidateRole).toBe("function_activity_shadow");
      expect(output.sources.nshap_w2_to_w3.models.I1_hba1c_body_pulse_sleep_function.candidateRole).toBe("integrated_shadow");
      expect(output.sources.nshap_w2_to_w3.models.NC4_missingness_quality_only.candidateRole).toBe("negative_control");
      expect(output.sources.nshap_w2_to_w3.models.NC5_noise_feature.candidateRole).toBe("negative_control");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(() => assertR1046Safe(output)).not.toThrow();

      for (const source of Object.values(output.sources)) {
        for (const counts of Object.values(source.dataShape.splitCounts)) {
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
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1046-mutated-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticNshapDownloads(downloadsDir);
      const { output } = await runR1046NshapHba1cReplicationLoop({
        downloadsDir,
        iterations: 20,
        outputDir: path.join(tmp, "out"),
      });
      const unsafe: Record<string, unknown> = { ...output, productDisplayAuthorized: true };
      expect(() => assertR1046Safe(unsafe as never)).toThrow("R1046 NSHAP HbA1c replication loop failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1046-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticNshapDownloads(downloadsDir);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1046-nshap-hba1c-replication-loop.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_R1046_ITERATIONS: "25",
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        packetId: string;
        productDisplayAuthorized: boolean;
        rowValuesStored: boolean;
        status: string;
      };
      expect(summary.packetId).toBe("r1046-nshap-hba1c-replication-loop");
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

async function writeSyntheticNshapDownloads(downloadsDir: string): Promise<void> {
  await writeZip(downloadsDir, "ICPSR_20541-V10.zip", {
    "ICPSR_20541/DS0001/20541-0001-Data.tsv": buildWave1Baseline(),
  });
  await writeZip(downloadsDir, "ICPSR_34921-V5.zip", {
    "ICPSR_34921/DS0001/34921-0001-Data.tsv": buildWave2Baseline(),
    "ICPSR_34921/DS0003/34921-0003-Data.tsv": buildTracking(2),
  });
  await writeZip(downloadsDir, "ICPSR_36873-V9.zip", {
    "ICPSR_36873/DS0005/36873-0005-Data.tsv": buildTracking(3),
  });
}

function buildWave1Baseline(): string {
  const rows = [["ID", "AGE", "GENDER", "BMI", "HBA1C", "PULSE_MEAN", "NOSLEEP", "WALKBLK", "WALKROOM"].join("\t")];
  for (let index = 0; index < 900; index += 1) {
    const event = isSyntheticEvent(index);
    const age = 55 + (index % 32);
    rows.push([
      syntheticId(index),
      String(age),
      index % 2 === 0 ? "1" : "2",
      String(22 + (index % 13) / 2),
      String(5.2 + (event ? 1.1 : 0) + (index % 6) / 10),
      String(63 + (event ? 5 : 0) + (index % 12)),
      String(1 + (event ? 2 : index % 2)),
      String(event ? 3 : index % 2),
      String(event ? 1 : 0),
    ].join("\t"));
  }
  return `${rows.join("\n")}\n`;
}

function buildWave2Baseline(): string {
  const rows = [["ID", "AGE", "GENDER", "A1C_WHBL", "A1C_DBS", "WEIGHT", "HEIGHT", "PULSE_1", "PULSE_2", "NOSLEEP", "WALKBLK", "WALKROOM"].join("\t")];
  for (let index = 0; index < 900; index += 1) {
    const event = isSyntheticEvent(index);
    const height = 60 + (index % 13);
    const bmi = 23 + (index % 12) / 2;
    const weight = bmi * height * height / 703;
    rows.push([
      syntheticId(index),
      String(60 + (index % 32)),
      index % 2 === 0 ? "1" : "2",
      String(5.1 + (event ? 1.2 : 0) + (index % 6) / 10),
      String(5.2 + (event ? 1.2 : 0) + (index % 6) / 10),
      String(weight),
      String(height),
      String(61 + (event ? 5 : 0) + (index % 12)),
      String(62 + (event ? 5 : 0) + (index % 12)),
      String(1 + (event ? 2 : index % 2)),
      String(event ? 3 : index % 2),
      String(event ? 1 : 0),
    ].join("\t"));
  }
  return `${rows.join("\n")}\n`;
}

function buildTracking(wave: 2 | 3): string {
  const rows = [["ID", "DECEASED"].join("\t")];
  for (let index = 0; index < 900; index += 1) {
    const event = isSyntheticEvent(index) && (wave === 3 || index % 2 === 0);
    rows.push([syntheticId(index), event ? "1" : "0"].join("\t"));
  }
  return `${rows.join("\n")}\n`;
}

function isSyntheticEvent(index: number): boolean {
  return index % 5 === 0 || (index % 29 === 0);
}

function syntheticId(index: number): string {
  return `S${String(index).padStart(5, "0")}`;
}

async function writeZip(downloadsDir: string, zipName: string, entries: Record<string, string>): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1046-stage-"));
  try {
    for (const [entry, content] of Object.entries(entries)) {
      await mkdir(path.join(staging, path.dirname(entry)), { recursive: true });
      await writeFile(path.join(staging, entry), content);
    }
    execFileSync("zip", ["-qr", path.join(downloadsDir, zipName), "."], { cwd: staging });
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}
