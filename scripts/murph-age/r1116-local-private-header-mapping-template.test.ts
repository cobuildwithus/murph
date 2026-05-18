import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1115LocalPrivateHeaderMappingIntake } from "./r1115-local-private-header-mapping-intake.ts";
import {
  R1116_LOCAL_PRIVATE_HEADER_MAPPING_TEMPLATE_SCHEMA_VERSION,
  runR1116LocalPrivateHeaderMappingTemplate,
} from "./r1116-local-private-header-mapping-template.ts";

describe("R1116 local private header mapping template", () => {
  it("writes a semantic-only fillable template for R1115", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1116-"));
    try {
      const r1115Path = path.join(tmp, "r1115.json");
      await writeJson(r1115Path, r1115NotProvided());

      const { output, outputPath, templatePath } = await runR1116LocalPrivateHeaderMappingTemplate({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1115Path,
      });

      expect(path.basename(outputPath)).toBe("r1116-local-private-header-mapping-template.latest.json");
      expect(path.basename(templatePath)).toBe("r1116-fillable-private-header-mapping-template.json");
      expect(output.schemaVersion).toBe(R1116_LOCAL_PRIVATE_HEADER_MAPPING_TEMPLATE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "local_private_header_mapping_template_ready",
        nextAction: "fill_semantic_boolean_template_then_run_r1115",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1116: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.mappingTemplate).toMatchObject({
        initialPresentValues: "all_false",
        r1115TemplateValidationConclusion: "local_private_header_mapping_incomplete",
        semanticOnlyBooleansStored: true,
        templateArtifact: "r1116-fillable-private-header-mapping-template.json",
      });
      expect(output.mappingTemplate.categoriesToFill).toEqual([
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
        "wearableSleep",
        "wearableRecovery",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("produces a fillable template that R1115 accepts as incomplete until categories are selected", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1116-r1115-"));
    try {
      const { templatePath } = await runR1116LocalPrivateHeaderMappingTemplate({
        outputDir: path.join(tmp, "out"),
      });
      const r1114Path = path.join(tmp, "r1114.json");
      await writeJson(r1114Path, r1114ReadyForMapping());

      const { output } = await runR1115LocalPrivateHeaderMappingIntake({
        mappingPath: templatePath,
        outputDir: path.join(tmp, "validate"),
        r1114Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_private_header_mapping_incomplete",
        nextAction: "complete_required_private_mapping_categories",
      });
      expect(output.mappingIntake).toMatchObject({
        attestationStatus: "complete",
        completedCategoryCountBand: "0",
        mappingSchemaVersion: "murph-age-local-private-header-mapping.v1",
      });
      const template = JSON.parse(await readFile(templatePath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream R1115 artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1116-unsafe-"));
    try {
      const r1115Path = path.join(tmp, "r1115.json");
      await writeJson(r1115Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1115-local-private-header-mapping-intake",
        schemaVersion: "murph-age-r1115-local-private-header-mapping-intake.v1",
      });

      await expect(runR1116LocalPrivateHeaderMappingTemplate({
        outputDir: path.join(tmp, "out"),
        r1115Path,
      })).rejects.toThrow("R1116 rejected unsafe r1115 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1116-cli-"));
    try {
      const r1115Path = path.join(tmp, "r1115.json");
      await writeJson(r1115Path, r1115NotProvided());

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1116-local-private-header-mapping-template.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1115_LOCAL_PRIVATE_MAPPING_INTAKE_PATH: r1115Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        categoriesToFill: string[];
        conclusion: string;
        templateArtifact: string;
      };
      expect(summary).toMatchObject({
        conclusion: "local_private_header_mapping_template_ready",
        templateArtifact: "r1116-fillable-private-header-mapping-template.json",
      });
      expect(summary.categoriesToFill).toContain("wearableActivity");
      expect(summary.categoriesToFill).toContain("labGlycemia");
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("steps");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1115NotProvided(): unknown {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      mappingPathStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1115: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1115: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r1115-local-private-header-mapping-intake",
    schemaVersion: "murph-age-r1115-local-private-header-mapping-intake.v1",
    summary: {
      conclusion: "local_private_header_mapping_not_provided",
    },
  };
}

function r1114ReadyForMapping(): unknown {
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
      conclusion: "local_wearable_outcome_headers_need_human_mapping",
    },
  };
}
