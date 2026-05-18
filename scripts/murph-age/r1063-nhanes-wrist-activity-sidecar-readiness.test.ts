import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1063_NHANES_WRIST_ACTIVITY_SIDECAR_READINESS_SCHEMA_VERSION,
  readXptMetadata,
  runR1063NhanesWristActivitySidecarReadiness,
} from "./r1063-nhanes-wrist-activity-sidecar-readiness.ts";

describe("R1063 NHANES wrist activity sidecar readiness", () => {
  it("reads SAS XPORT variable metadata without row value egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1063-xpt-"));
    try {
      const xptPath = path.join(tmp, "tiny.xpt");
      await writeFile(xptPath, syntheticXpt([
        numericVariable("SEQN"),
        characterVariable("PAXSENID", 13),
      ], 12));

      const metadata = await readXptMetadata(xptPath);
      expect(metadata.variableCount).toBe(2);
      expect(metadata.rowCountBand).toBe("10-99");
      expect(metadata.variables).toEqual([
        { length: 8, name: "SEQN", type: "numeric" },
        { length: 13, name: "PAXSENID", type: "character" },
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks both cycles ready when all required local source metadata is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1063-ready-"));
    try {
      await writeSyntheticCache(tmp);
      const { output, outputPath } = await runR1063NhanesWristActivitySidecarReadiness({
        cacheRoot: tmp,
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1063-nhanes-wrist-activity-sidecar-readiness.latest.json");
      expect(output.schemaVersion).toBe(R1063_NHANES_WRIST_ACTIVITY_SIDECAR_READINESS_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        readyCycleCount: 2,
        rowParsingPerformedByR1063: false,
        usableAsConsumerWearableValidation: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nhanes_wrist_activity_sidecar_ready_for_private_materializer",
        nextLocalAction: "build_private_wrist_activity_materializer",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.cycles.every((cycle) => cycle.ready)).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      const serialized = await readFile(outputPath, "utf8");
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("Respondent sequence number");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks when a required wrist variable is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1063-missing-"));
    try {
      await writeSyntheticCache(tmp, { omitActivityVariable: "PAXMTSD" });
      const { output } = await runR1063NhanesWristActivitySidecarReadiness({
        cacheRoot: tmp,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.nextStep.conclusion).toBe("nhanes_wrist_activity_sidecar_sources_missing_or_unreadable");
      expect(output.cycles[0]?.files.find((file) => file.group === "activityDay")?.missingRequiredVariables).toContain("PAXMTSD");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1063-cli-"));
    try {
      await writeSyntheticCache(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1063-nhanes-wrist-activity-sidecar-readiness.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NHANES_BENCH_CACHE_ROOT: tmp,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        readyCycleCount: number;
      };
      expect(summary).toMatchObject({
        conclusion: "nhanes_wrist_activity_sidecar_ready_for_private_materializer",
        packetId: "r1063-nhanes-wrist-activity-sidecar-readiness",
        productDisplayAuthorized: false,
        readyCycleCount: 2,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("SEQN");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticCache(
  root: string,
  options: { omitActivityVariable?: string } = {},
): Promise<void> {
  for (const cycle of [
    { mortality: "NHANES_2011_2012_MORT_2019_PUBLIC.dat", suffix: "G", year: "2011" },
    { mortality: "NHANES_2013_2014_MORT_2019_PUBLIC.dat", suffix: "H", year: "2013" },
  ]) {
    const xptDir = path.join(root, "raw", "nhanes-public-xpt", cycle.year);
    const mortalityDir = path.join(root, "raw", "linked-mortality-2019");
    await mkdir(xptDir, { recursive: true });
    await mkdir(mortalityDir, { recursive: true });
    await writeFile(path.join(mortalityDir, cycle.mortality), "aggregate-test-only\n");
    await writeXpt(path.join(xptDir, `PAXDAY_${cycle.suffix}.XPT`), requiredVariables("activityDay", options.omitActivityVariable));
    await writeXpt(path.join(xptDir, `PAXHD_${cycle.suffix}.XPT`), requiredVariables("activityHeader"));
    await writeXpt(path.join(xptDir, `BMX_${cycle.suffix}.XPT`), requiredVariables("body"));
    await writeXpt(path.join(xptDir, `BPX_${cycle.suffix}.XPT`), requiredVariables("bp"));
    await writeXpt(path.join(xptDir, `CBC_${cycle.suffix}.XPT`), requiredVariables("cbc"));
    await writeXpt(path.join(xptDir, `BIOPRO_${cycle.suffix}.XPT`), requiredVariables("chemistry"));
    await writeXpt(path.join(xptDir, `DEMO_${cycle.suffix}.XPT`), requiredVariables("demographics"));
    await writeXpt(path.join(xptDir, `GHB_${cycle.suffix}.XPT`), requiredVariables("glycemia"));
    await writeXpt(path.join(xptDir, `HDL_${cycle.suffix}.XPT`), requiredVariables("hdl"));
    await writeXpt(path.join(xptDir, `TRIGLY_${cycle.suffix}.XPT`), requiredVariables("triglycerides"));
  }
}

async function writeXpt(filePath: string, variables: VariableSpec[]): Promise<void> {
  await writeFile(filePath, syntheticXpt(variables, 24));
}

function requiredVariables(group: string, omit?: string): VariableSpec[] {
  const byGroup: Record<string, string[]> = {
    activityDay: ["SEQN", "PAXDAYD", "PAXTMD", "PAXVMD", "PAXMTSD", "PAXWWMD", "PAXSWMD", "PAXNWMD", "PAXQFD"],
    activityHeader: ["SEQN", "PAXSTS", "PAXHAND", "PAXORENT"],
    body: ["SEQN", "BMXBMI", "BMXWAIST"],
    bp: ["SEQN", "BPXSY1", "BPXDI1"],
    cbc: ["SEQN", "LBXWBCSI", "LBXLYPCT", "LBXRDW"],
    chemistry: ["SEQN", "LBXSAL", "LBXSCR", "LBXSAPSI"],
    demographics: ["SEQN", "RIDAGEYR", "RIAGENDR", "WTMEC2YR"],
    glycemia: ["SEQN", "LBXGH"],
    hdl: ["SEQN", "LBDHDD"],
    triglycerides: ["SEQN", "LBXTR"],
  };
  return (byGroup[group] ?? [])
    .filter((name) => name !== omit)
    .map((name) => numericVariable(name));
}

interface VariableSpec {
  length: number;
  name: string;
  typeCode: 1 | 2;
}

function numericVariable(name: string): VariableSpec {
  return { length: 8, name, typeCode: 1 };
}

function characterVariable(name: string, length: number): VariableSpec {
  return { length, name, typeCode: 2 };
}

function syntheticXpt(variables: VariableSpec[], rowCount: number): Buffer {
  const chunks: Buffer[] = [
    record("HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000  "),
    record("HEADER RECORD*******MEMBER  HEADER RECORD!!!!!!!000000000000000001600000000140  "),
    record("HEADER RECORD*******DSCRPTR HEADER RECORD!!!!!!!000000000000000000000000000000  "),
    record(`HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!00${String(variables.length).padStart(8, "0")}00000000000000000000  `),
  ];
  for (let index = 0; index < variables.length; index += 1) {
    chunks.push(descriptor(variables[index]!, index + 1));
  }
  chunks.push(paddingFor(chunks));
  chunks.push(record("HEADER RECORD*******OBS     HEADER RECORD!!!!!!!000000000000000000000000000000  "));
  const rowLength = variables.reduce((sum, variable) => sum + variable.length, 0);
  chunks.push(Buffer.alloc(rowLength * rowCount, 0));
  chunks.push(paddingFor(chunks));
  return Buffer.concat(chunks);
}

function descriptor(variable: VariableSpec, position: number): Buffer {
  const buffer = Buffer.alloc(140, 0);
  buffer.writeUInt16BE(variable.typeCode, 0);
  buffer.writeUInt16BE(variable.length, 4);
  buffer.writeUInt16BE(position, 6);
  buffer.write(variable.name.padEnd(8, " ").slice(0, 8), 8, "ascii");
  return buffer;
}

function record(value: string): Buffer {
  return Buffer.from(value.padEnd(80, " ").slice(0, 80), "ascii");
}

function paddingFor(chunks: Buffer[]): Buffer {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const padLength = (80 - (length % 80)) % 80;
  return Buffer.alloc(padLength, 32);
}
