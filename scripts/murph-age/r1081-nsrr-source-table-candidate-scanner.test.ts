import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION,
  runR1081NsrrSourceTableCandidateScanner,
} from "./r1081-nsrr-source-table-candidate-scanner.ts";

describe("R1081 NSRR source table candidate scanner", () => {
  it("writes private source-table candidates while keeping external output aggregate-only", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1081-run-"));
    const draftPath = runtimeDraftPath(tmp, "run");
    try {
      const scanRoot = path.join(tmp, "scan");
      await writeFixtureTables(scanRoot);

      const { output, outputPath } = await runR1081NsrrSourceTableCandidateScanner({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        privateCandidateDraftPath: draftPath,
        scanRoots: [scanRoot],
      });

      expect(path.basename(outputPath)).toBe("r1081-nsrr-source-table-candidate-scanner.latest.json");
      expect(output.schemaVersion).toBe(R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        candidateDraftWritten: true,
        candidateTablesFound: true,
        sleepAutonomicContractCandidateFound: true,
        productDisplayAuthorized: false,
        rowValuesRead: false,
        rowValuesStored: false,
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_candidate_tables_found_private_draft_ready",
        nextLocalAction: "choose_private_candidate_then_run_r1080",
      });
      expect(output.privateDraft.sleepAutonomicContractCandidateCountBand).toBe("1-9");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("mesa-source.csv");
      expect(serialized).not.toContain("src_age");
      expect(serialized).not.toContain("src_event");

      const draft = JSON.parse(await readFile(draftPath, "utf8")) as {
        candidates: Array<{ candidateId: string; header: string[]; sourceTablePath: string }>;
        schemaVersion: string;
      };
      expect(draft.schemaVersion).toBe(R1081_NSRR_SOURCE_TABLE_CANDIDATE_SCANNER_SCHEMA_VERSION);
      expect(draft.candidates).toHaveLength(1);
      expect(draft.candidates[0]?.candidateId).toBe("candidate_0001");
      expect(draft.candidates[0]?.header).toContain("src_age");
      expect(draft.candidates[0]?.sourceTablePath).toContain("mesa-source.csv");
    } finally {
      await rm(draftPath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects private candidate drafts outside the ignored runtime cache", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1081-unsafe-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await writeFixtureTables(scanRoot);
      await expect(runR1081NsrrSourceTableCandidateScanner({
        outputDir: path.join(tmp, "out"),
        privateCandidateDraftPath: path.join(tmp, "unsafe.draft.json"),
        scanRoots: [scanRoot],
      })).rejects.toThrow("ignored NSRR private-map runtime cache root");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat generic source headers as aggregate egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1081-generic-"));
    const draftPath = runtimeDraftPath(tmp, "generic");
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "generic-source.csv"), [
        "status,age,event,sleep,activity,heart",
        "1,72,0,6.5,1200,64",
      ].join("\n") + "\n");

      const { output } = await runR1081NsrrSourceTableCandidateScanner({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        privateCandidateDraftPath: draftPath,
        scanRoots: [scanRoot],
      });

      expect(output.summary).toMatchObject({
        candidateTablesFound: true,
        sleepAutonomicContractCandidateFound: false,
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_candidate_tables_incomplete_for_sleep_autonomic_contract",
        nextLocalAction: "inspect_private_candidates_or_download_nsrr_tables",
      });
    } finally {
      await rm(draftPath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1081-cli-"));
    const draftPath = runtimeDraftPath(tmp, "cli");
    try {
      const scanRoot = path.join(tmp, "scan");
      await writeFixtureTables(scanRoot);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1081-nsrr-source-table-candidate-scanner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_SCAN_ROOTS: scanRoot,
          MURPH_AGE_NSRR_SOURCE_CANDIDATE_DRAFT_PATH: draftPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        candidateCountBand: string;
        packetId: string;
        rowValuesRead: boolean;
        sleepAutonomicContractCandidateCountBand: string;
        sourceSpecificColumnNamesInExternalArtifact: boolean;
      };
      expect(summary).toMatchObject({
        candidateCountBand: "1-9",
        packetId: "r1081-nsrr-source-table-candidate-scanner",
        rowValuesRead: false,
        sleepAutonomicContractCandidateCountBand: "1-9",
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("src_age");
      expect(stdout).not.toContain("mesa-source.csv");
    } finally {
      await rm(draftPath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureTables(scanRoot: string): Promise<void> {
  await mkdir(path.join(scanRoot, "nested"), { recursive: true });
  await writeFile(path.join(scanRoot, "notes.csv"), [
    "plain_text,other_text",
    "hello,world",
  ].join("\n") + "\n");
  await writeFile(path.join(scanRoot, "nested", "mesa-source.csv"), [
    [
      "src_event",
      "src_age",
      "src_sex",
      "src_sleep_duration",
      "src_ahi",
      "src_rhr",
      "src_activity",
    ].join(","),
    [
      "1",
      "72",
      "M",
      "6.5",
      "18",
      "64",
      "2100",
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
