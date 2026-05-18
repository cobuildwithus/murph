import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R983_CURRENT_CANDIDATE_FAMILY_STATE_SCHEMA_VERSION,
  runR983CurrentCandidateFamilyState,
} from "./r983-current-candidate-family-state.ts";

describe("R983 current candidate family state", () => {
  it("builds a research-only candidate-family state from aggregate artifacts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r983-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR983CurrentCandidateFamilyState({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r983-current-candidate-family-state.latest.json");
      expect(output.schemaVersion).toBe(R983_CURRENT_CANDIDATE_FAMILY_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        currentLeadFamily: "function_disability",
        nextLocalLoop: "mhas-function-disability-fast-loop",
        productDisplayAuthorized: false,
        reviewGptUse: "high_value_result_review_only",
      });
      expect(output.modelArchitecture).toMatchObject({
        baseAnchor: "nhis_r399_frozen_research_anchor",
        displayPolicy: "no_user_facing_age_display",
        researchOnly: true,
      });
      expect(output.candidateFamilies.functionDisability).toMatchObject({
        status: "lead_sidecar_candidate_five_source_diagnostic_only",
        productPromotionAuthorized: false,
      });
      expect(output.candidateFamilies.glycemiaBody).toMatchObject({
        frozenCandidateId: "age_sex_plus_glycemia",
        status: "frozen_small_candidate_future_validation",
        productPromotionAuthorized: false,
      });
      expect(output.candidateFamilies.cognition.status).toBe("diagnostic_only_pending_nshap");
      expect(output.candidateFamilies.nhanesLabBpBody).toEqual({
        scoreBearingResearchLayer: "lab_bp_body",
        status: "research_layer_available_not_default",
      });
      expect(output.candidateFamilies.wearables).toEqual({
        productPromotionAuthorized: false,
        status: "shadow_only",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceBodies\": true");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds function/disability when MHAS aggregate support is absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r983-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const blockedR980Path = path.join(tmp, "r980-blocked.json");
      const blockedR747Path = path.join(tmp, "r747-blocked.json");
      await writeJson(blockedR980Path, {
        ...r980Fixture(),
        summary: {
          conclusion: "mhas_function_disability_hold_diagnostic_only",
        },
      });
      await writeJson(blockedR747Path, {
        ...r747Fixture(),
        status: "function_family_missing_or_not_ready",
      });

      const { output } = await runR983CurrentCandidateFamilyState({
        ...paths,
        r747FunctionFamilyPath: blockedR747Path,
        r980Path: blockedR980Path,
      });

      expect(output.summary.currentLeadFamily).toBe("none");
      expect(output.candidateFamilies.functionDisability.status).toBe("hold_diagnostic_only");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r983-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r983-current-candidate-family-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R399_LAYERING_PATH: paths.r399LayeringPath,
          MURPH_AGE_R607_GLYCEMIA_PACKET_PATH: paths.r607Path,
          MURPH_AGE_R608_FREEZE_PATH: paths.r608Path,
          MURPH_AGE_R612_NHANES_LAYERING_PATH: paths.r612Path,
          MURPH_AGE_R977_NSHAP_PROBE_PATH: paths.r977Path,
          MURPH_AGE_R978_PRIORITY_REDUCER_PATH: paths.r978Path,
          MURPH_AGE_R980_MHAS_FUNCTION_PATH: paths.r980Path,
          MURPH_AGE_R747_FUNCTION_FAMILY_PATH: paths.r747FunctionFamilyPath,
          MURPH_AGE_R981_REDUCTION_PATH: paths.r981ReductionPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r983-current-candidate-family-state.latest.json",
        currentLeadFamily: "function_disability",
        functionDisabilityStatus: "lead_sidecar_candidate_five_source_diagnostic_only",
        glycemiaBodyStatus: "frozen_small_candidate_future_validation",
        nextLocalLoop: "mhas-function-disability-fast-loop",
        packetId: "r983-current-candidate-family-state",
        productDisplayAuthorized: false,
        schemaVersion: R983_CURRENT_CANDIDATE_FAMILY_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  outputDir: string;
  r399LayeringPath: string;
  r607Path: string;
  r608Path: string;
  r612Path: string;
  r977Path: string;
  r978Path: string;
  r980Path: string;
  r747FunctionFamilyPath: string;
  r981ReductionPath: string;
}> {
  const outputDir = path.join(tmp, "out");
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r399LayeringPath: path.join(tmp, "r399.json"),
    r607Path: path.join(tmp, "r607.json"),
    r608Path: path.join(tmp, "r608.json"),
    r612Path: path.join(tmp, "r612.json"),
    r977Path: path.join(tmp, "r977.json"),
    r978Path: path.join(tmp, "r978.json"),
    r980Path: path.join(tmp, "r980.json"),
    r747FunctionFamilyPath: path.join(tmp, "r747.json"),
    r981ReductionPath: path.join(tmp, "r981.json"),
  };
  await Promise.all([
    writeJson(paths.r399LayeringPath, { packetId: "r399-layering-readiness", schemaVersion: "test-r399" }),
    writeJson(paths.r607Path, r607Fixture()),
    writeJson(paths.r608Path, r608Fixture()),
    writeJson(paths.r612Path, r612Fixture()),
    writeJson(paths.r977Path, r977Fixture()),
    writeJson(paths.r978Path, r978Fixture()),
    writeJson(paths.r980Path, r980Fixture()),
    writeJson(paths.r747FunctionFamilyPath, r747Fixture()),
    writeJson(paths.r981ReductionPath, r981Fixture()),
  ]);
  return paths;
}

function r607Fixture(): Record<string, unknown> {
  return {
    packetId: "r607-glycemia-ablation-review-packet",
    schemaVersion: "murph-age-r607-glycemia-ablation-review-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "glycemia_signal_supported_but_small",
    },
  };
}

function r608Fixture(): Record<string, unknown> {
  return {
    frozenCandidateId: "age_sex_plus_glycemia",
    manifestId: "r608-freeze-glycemia-candidate",
    schemaVersion: "murph-age-r608-freeze-glycemia-candidate.v1",
    status: "candidate_family_frozen_for_future_validation",
  };
}

function r612Fixture(): Record<string, unknown> {
  return {
    packetId: "r612-nhanes-layering-map",
    schemaVersion: "murph-age-r612-nhanes-layering-map.v1",
    status: "research-local-aggregate-only",
    summary: {
      scoreBearingResearchLayer: "lab_bp_body",
    },
  };
}

function r977Fixture(): Record<string, unknown> {
  return {
    packetId: "r977-nshap-next-activation-probe",
    schemaVersion: "murph-age-r977-nshap-next-activation-probe.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels",
    },
  };
}

function r978Fixture(): Record<string, unknown> {
  return {
    packetId: "r978-fast-loop-priority-reducer",
    schemaVersion: "murph-age-r978-fast-loop-priority-reducer.v1",
    status: "research-local-aggregate-only",
    summary: {
      nextLoopId: "mhas-function-disability-fast-loop",
    },
  };
}

function r980Fixture(): Record<string, unknown> {
  return {
    packetId: "r980-mhas-function-disability-aggregate-reducer",
    schemaVersion: "murph-age-r980-mhas-function-disability-aggregate-reducer.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_function_disability_supportive_diagnostic_only",
    },
  };
}

function r747Fixture(): Record<string, unknown> {
  return {
    candidate_manifest_allowed: true,
    candidate_manifest_kind: "proposal_only_no_anchor_refit_no_product_claim",
    model_change_allowed_now: false,
    recommended_next_action: "build_source_agnostic_function_family_definition_and_compare_next_candidate_domain",
    status: "five_source_concordant_candidate_domain_ready_for_family_definition_and_comparison",
  };
}

function r981Fixture(): Record<string, unknown> {
  return {
    schema_version: "murph-age-r981-new-data-fast-direction-reduction.v1",
    status: "pending",
    consensus: {
      first_loop: "MHAS function/disability",
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
