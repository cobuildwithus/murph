import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  decodeXptNumeric,
  R1064_NHANES_WRIST_PRIVATE_MATERIALIZER_SCHEMA_VERSION,
  readXptRows,
  runR1064NhanesWristPrivateMaterializer,
} from "./r1064-nhanes-wrist-private-materializer.ts";

describe("R1064 NHANES wrist private materializer", () => {
  it("decodes SAS XPORT numeric values used by public NHANES files", () => {
    expect(decodeXptNumeric(encodeIbmDouble(0))).toBe(0);
    expect(decodeXptNumeric(encodeIbmDouble(12345))).toBeCloseTo(12345, 4);
    expect(decodeXptNumeric(encodeIbmDouble(-12.5))).toBeCloseTo(-12.5, 6);
    expect(decodeXptNumeric(Buffer.from([0x2e, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("reads selected XPORT row values into the private materialization path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1064-xpt-"));
    try {
      const xptPath = path.join(tmp, "tiny.xpt");
      await writeFile(xptPath, syntheticXptRows([
        numericVariable("SEQN"),
        numericVariable("RIDAGEYR"),
        numericVariable("WTMEC2YR"),
      ], [
        { RIDAGEYR: 42, SEQN: 11111, WTMEC2YR: 1234.5 },
        { RIDAGEYR: 77, SEQN: 22222, WTMEC2YR: 2345.5 },
      ]));

      const table = await readXptRows(xptPath, ["SEQN", "RIDAGEYR"]);
      expect(table.rows).toEqual([
        { RIDAGEYR: 42, SEQN: 11111 },
        { RIDAGEYR: 77, SEQN: 22222 },
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("writes local row cache while keeping the external artifact aggregate-only", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1064-run-"));
    try {
      await writeSyntheticCache(tmp);
      const analyticCachePath = path.join(tmp, "private-cache", "analytic.csv.gz");
      const { output, outputPath } = await runR1064NhanesWristPrivateMaterializer({
        analyticCachePath,
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        sourceCacheRoot: tmp,
      });

      expect(output.schemaVersion).toBe(R1064_NHANES_WRIST_PRIVATE_MATERIALIZER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        analyticCacheMaterialized: true,
        eligibleFiveYearCountBand: "1-9",
        eligibleFiveYearEventCountBand: "1-9",
        productDisplayAuthorized: false,
        rowValuesInExternalArtifact: false,
        totalMaterializedRowCountBand: "1-9",
        usableAsConsumerWearableValidation: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nhanes_wrist_private_cache_materialized_but_sparse",
        nextLocalAction: "inspect_private_cache_coverage_before_scoring",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.endpointPolicy).toMatchObject({
        primaryExecutableEndpoint: "5y_all_cause_mortality",
        tenYearEndpointReady: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = await readFile(outputPath, "utf8");
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("participant_key");
      expect(serialized).not.toContain("SEQN");
      expect(serialized).not.toContain("primary_5y_event");

      const privateCsv = gunzipSync(await readFile(analyticCachePath)).toString("utf8");
      expect(privateCsv).toContain("participant_key");
      expect(privateCsv).toContain("primary_5y_event");
      expect(privateCsv).toContain("wrist_2011_2014_mims_daily_summary_v0");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticCache(root: string): Promise<void> {
  for (const cycle of [
    { mortality: "NHANES_2011_2012_MORT_2019_PUBLIC.dat", suffix: "G", year: "2011" },
    { mortality: "NHANES_2013_2014_MORT_2019_PUBLIC.dat", suffix: "H", year: "2013" },
  ]) {
    const xptDir = path.join(root, "raw", "nhanes-public-xpt", cycle.year);
    const mortalityDir = path.join(root, "raw", "linked-mortality-2019");
    await mkdir(xptDir, { recursive: true });
    await mkdir(mortalityDir, { recursive: true });

    const participants = [
      { age: 55, deceased: false, followupMonths: 72, sex: 1, seqn: 11111 },
      { age: 63, deceased: true, followupMonths: 36, sex: 2, seqn: 22222 },
      { age: 70, deceased: false, followupMonths: 48, sex: 1, seqn: 33333 },
    ];
    await writeFile(path.join(mortalityDir, cycle.mortality), participants.map(mortalityLine).join("\n"));
    await writeFile(path.join(xptDir, `PAXDAY_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("PAXTMD"),
      numericVariable("PAXVMD"),
      numericVariable("PAXMTSD"),
      numericVariable("PAXWWMD"),
      numericVariable("PAXSWMD"),
      numericVariable("PAXNWMD"),
    ], participants.flatMap((participant) => [
      activityDay(participant.seqn, 300 + participant.age),
      activityDay(participant.seqn, 320 + participant.age),
    ])));
    await writeFile(path.join(xptDir, `BMX_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("BMXBMI"),
      numericVariable("BMXWAIST"),
    ], participants.map((participant) => ({ BMXBMI: 25, BMXWAIST: 90, SEQN: participant.seqn }))));
    await writeFile(path.join(xptDir, `BPX_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("BPXSY1"),
      numericVariable("BPXDI1"),
    ], participants.map((participant) => ({ BPXDI1: 80, BPXSY1: 120, SEQN: participant.seqn }))));
    await writeFile(path.join(xptDir, `CBC_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("LBXWBCSI"),
      numericVariable("LBXLYPCT"),
      numericVariable("LBXRDW"),
    ], participants.map((participant) => ({
      LBXLYPCT: 32,
      LBXRDW: 13,
      LBXWBCSI: 6,
      SEQN: participant.seqn,
    }))));
    await writeFile(path.join(xptDir, `BIOPRO_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("LBXSAL"),
      numericVariable("LBXSCR"),
      numericVariable("LBXSAPSI"),
    ], participants.map((participant) => ({
      LBXSAL: 4.3,
      LBXSAPSI: 70,
      LBXSCR: 0.9,
      SEQN: participant.seqn,
    }))));
    await writeFile(path.join(xptDir, `DEMO_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("RIDAGEYR"),
      numericVariable("RIAGENDR"),
      numericVariable("WTMEC2YR"),
    ], participants.map((participant) => ({
      RIAGENDR: participant.sex,
      RIDAGEYR: participant.age,
      SEQN: participant.seqn,
      WTMEC2YR: 1000,
    }))));
    await writeFile(path.join(xptDir, `GHB_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("LBXGH"),
    ], participants.map((participant) => ({ LBXGH: 5.4, SEQN: participant.seqn }))));
    await writeFile(path.join(xptDir, `HDL_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("LBDHDD"),
    ], participants.map((participant) => ({ LBDHDD: 55, SEQN: participant.seqn }))));
    await writeFile(path.join(xptDir, `TRIGLY_${cycle.suffix}.XPT`), syntheticXptRows([
      numericVariable("SEQN"),
      numericVariable("LBXTR"),
    ], participants.map((participant) => ({ LBXTR: 110, SEQN: participant.seqn }))));
  }
}

function activityDay(seqn: number, totalActivity: number): Record<string, number> {
  return {
    PAXMTSD: totalActivity,
    PAXNWMD: 60,
    PAXSWMD: 500,
    PAXTMD: 1440,
    PAXVMD: 1380,
    PAXWWMD: 880,
    SEQN: seqn,
  };
}

function mortalityLine(row: { deceased: boolean; followupMonths: number; seqn: number }): string {
  const chars = new Array(54).fill(" ");
  writeAt(chars, 0, String(row.seqn).padStart(5, " "));
  writeAt(chars, 14, "1");
  writeAt(chars, 15, row.deceased ? "1" : "0");
  writeAt(chars, 42, String(row.followupMonths).padStart(3, " "));
  writeAt(chars, 45, String(row.followupMonths).padStart(3, " "));
  return chars.join("");
}

function writeAt(chars: string[], start: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    chars[start + index] = value[index]!;
  }
}

interface VariableSpec {
  length: number;
  name: string;
  typeCode: 1 | 2;
}

function numericVariable(name: string): VariableSpec {
  return { length: 8, name, typeCode: 1 };
}

function syntheticXptRows(variables: VariableSpec[], rows: readonly Record<string, number | null>[]): Buffer {
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
  for (const row of rows) {
    for (const variable of variables) {
      const value = row[variable.name];
      chunks.push(value === null || value === undefined ? Buffer.from([0x2e, 0, 0, 0, 0, 0, 0, 0]) : encodeIbmDouble(value));
    }
  }
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

function encodeIbmDouble(value: number): Buffer {
  if (value === 0) return Buffer.alloc(8, 0);
  const buffer = Buffer.alloc(8, 0);
  const sign = value < 0 ? 0x80 : 0;
  let absolute = Math.abs(value);
  let exponent = 0;
  while (absolute < 1 / 16) {
    absolute *= 16;
    exponent -= 1;
  }
  while (absolute >= 1) {
    absolute /= 16;
    exponent += 1;
  }
  buffer[0] = sign | ((exponent + 64) & 0x7f);
  for (let index = 1; index < 8; index += 1) {
    absolute *= 256;
    const byte = Math.floor(absolute);
    buffer[index] = byte;
    absolute -= byte;
  }
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
