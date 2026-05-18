import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1115_LOCAL_PRIVATE_HEADER_MAPPING_INTAKE_SCHEMA_VERSION,
  runR1115LocalPrivateHeaderMappingIntake,
} from "./r1115-local-private-header-mapping-intake.ts";

describe("R1115 local private header mapping intake", () => {
  it("waits for a private mapping when the join probe says human mapping is needed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1115-wait-"));
    try {
      const r1114Path = path.join(tmp, "r1114.json");
      await writeJson(r1114Path, r1114({
        conclusion: "local_wearable_outcome_headers_need_human_mapping",
      }));

      const { output, outputPath } = await runR1115LocalPrivateHeaderMappingIntake({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1114Path,
      });

      expect(path.basename(outputPath)).toBe("r1115-local-private-header-mapping-intake.latest.json");
      expect(output.schemaVersion).toBe(R1115_LOCAL_PRIVATE_HEADER_MAPPING_INTAKE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "local_private_header_mapping_not_provided",
        nextAction: "fill_private_header_mapping_before_local_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1115: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.mappingIntake).toMatchObject({
        completedCategoryCountBand: "0",
        mappingPathConfigured: false,
        privateMappingStatus: "missing",
        semanticOnlyBooleansStored: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the mapping ready when semantic join, outcome, lab, and wearable categories are present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1115-ready-"));
    try {
      const r1114Path = path.join(tmp, "r1114.json");
      const mappingPath = path.join(tmp, "mapping.json");
      await writeJson(r1114Path, r1114({
        conclusion: "local_wearable_outcome_headers_potential_person_join",
      }));
      await writeJson(mappingPath, privateMapping({
        dateOrTimeKey: true,
        labGlycemia: true,
        outcomeEvent: true,
        personJoinKey: true,
        wearableActivity: true,
      }));

      const { output } = await runR1115LocalPrivateHeaderMappingIntake({
        outputDir: path.join(tmp, "out"),
        mappingPath,
        r1114Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_header_mapping_ready_for_local_aggregate_receipt",
        nextAction: "build_local_aggregate_receipt_from_private_mapping",
        reviewGptRequiredNow: false,
      });
      expect(output.mappingIntake).toMatchObject({
        attestationStatus: "complete",
        completedCategoryCountBand: "2-9",
        mappingPathConfigured: true,
        mappingSchemaVersion: "murph-age-local-private-header-mapping.v1",
        privateMappingStatus: "available",
      });
      expect(output.mappingIntake.semanticCoverage).toMatchObject({
        dateOrTimeKey: true,
        labGlycemia: true,
        outcomeEvent: true,
        personJoinKey: true,
        wearableActivity: true,
      });
      const encoded = JSON.stringify(output);
      expect(encoded).not.toContain(tmp);
      expect(encoded).not.toContain("steps");
      expect(encoded).not.toContain("raw_user_header_secret");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps incomplete mappings out of scoring when required semantic pieces are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1115-incomplete-"));
    try {
      const r1114Path = path.join(tmp, "r1114.json");
      const mappingPath = path.join(tmp, "mapping.json");
      await writeJson(r1114Path, r1114({
        conclusion: "local_wearable_outcome_headers_need_human_mapping",
      }));
      await writeJson(mappingPath, privateMapping({
        dateOrTimeKey: true,
        labGlycemia: true,
        personJoinKey: true,
      }));

      const { output } = await runR1115LocalPrivateHeaderMappingIntake({
        outputDir: path.join(tmp, "out"),
        mappingPath,
        r1114Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_header_mapping_incomplete",
        nextAction: "complete_required_private_mapping_categories",
      });
      expect(output.mappingIntake.semanticCoverage).toMatchObject({
        dateOrTimeKey: true,
        labGlycemia: true,
        outcomeEvent: false,
        personJoinKey: true,
        wearableActivity: false,
        wearableRecovery: false,
        wearableSleep: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the join probe is missing or stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1115-stale-"));
    try {
      const r1114Path = path.join(tmp, "r1114.json");
      const mappingPath = path.join(tmp, "mapping.json");
      await writeJson(r1114Path, {
        packetId: "r1114-local-wearable-outcome-join-probe",
        schemaVersion: "stale",
        summary: {
          conclusion: "local_wearable_outcome_headers_need_human_mapping",
        },
      });
      await writeJson(mappingPath, privateMapping({
        commonLabCore: true,
        dateOrTimeKey: true,
        outcomeEvent: true,
        personJoinKey: true,
        wearableSleep: true,
      }));

      const { output } = await runR1115LocalPrivateHeaderMappingIntake({
        outputDir: path.join(tmp, "out"),
        mappingPath,
        r1114Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_header_mapping_waiting_on_join_probe",
        nextAction: "regenerate_local_wearable_outcome_join_probe",
      });
      expect(output.inputArtifacts.r1114).toMatchObject({
        packetId: "r1114-local-wearable-outcome-join-probe",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe mappings without echoing private names", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1115-unsafe-"));
    try {
      const r1114Path = path.join(tmp, "r1114.json");
      const mappingPath = path.join(tmp, "mapping.json");
      await writeJson(r1114Path, r1114({
        conclusion: "local_wearable_outcome_headers_potential_person_join",
      }));
      await writeJson(mappingPath, {
        schemaVersion: "murph-age-local-private-header-mapping.v1",
        mappings: {
          personJoinKey: {
            headerName: "participant_id",
            present: true,
          },
          wearableActivity: {
            columnName: "steps",
            present: true,
          },
        },
      });

      await expect(runR1115LocalPrivateHeaderMappingIntake({
        outputDir: path.join(tmp, "out"),
        mappingPath,
        r1114Path,
      })).rejects.toThrow("R1115 rejected unsafe private mapping: 4 unsafe mapping shape signals.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1115-cli-"));
    try {
      const r1114Path = path.join(tmp, "r1114.json");
      const mappingPath = path.join(tmp, "mapping.json");
      await writeJson(r1114Path, r1114({
        conclusion: "local_wearable_outcome_headers_potential_person_join",
      }));
      await writeJson(mappingPath, privateMapping({
        dateOrTimeKey: true,
        outcomeEvent: true,
        personJoinKey: true,
        vitalsBody: true,
        wearableSleep: true,
      }));

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1115-local-private-header-mapping-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_LOCAL_PRIVATE_HEADER_MAPPING_PATH: mappingPath,
          MURPH_AGE_R1114_LOCAL_JOIN_PROBE_PATH: r1114Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        mappingPathConfigured: boolean;
        targetInputPriority: string;
      };
      expect(summary).toMatchObject({
        conclusion: "local_private_header_mapping_ready_for_local_aggregate_receipt",
        mappingPathConfigured: true,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("sleep");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1114(input: {
  conclusion:
    | "local_wearable_outcome_headers_need_human_mapping"
    | "local_wearable_outcome_headers_potential_person_join";
}): unknown {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1114: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1114: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r1114-local-wearable-outcome-join-probe",
    schemaVersion: "murph-age-r1114-local-wearable-outcome-join-probe.v1",
    summary: {
      conclusion: input.conclusion,
    },
  };
}

function privateMapping(categories: Partial<Record<
  | "commonLabCore"
  | "dateOrTimeKey"
  | "labGlycemia"
  | "outcomeEvent"
  | "personJoinKey"
  | "vitalsBody"
  | "wearableActivity"
  | "wearableRecovery"
  | "wearableSleep",
  boolean
>>): unknown {
  return {
    attestations: {
      localOnly: true,
      noHeaderNamesInOutput: true,
      noRowsIncluded: true,
      noSourceTextIncluded: true,
    },
    mappings: Object.fromEntries(
      Object.entries(categories).map(([key, present]) => [key, { present }]),
    ),
    schemaVersion: "murph-age-local-private-header-mapping.v1",
  };
}
