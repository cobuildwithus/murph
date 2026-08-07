import { describe, expect, it } from "vitest";

import {
  buildExaResearchScoutRequest,
  parseExaResearchScoutRequestBody,
  researchScoutBatchPayloadSchema,
  researchScoutProfileSchema,
  resolveResearchScoutProfileKind,
} from "../src/exa-research-scout.ts";

const FOCUSED_PROFILE = {
  mode: "focused",
  topics: ["creatine", "cognitive performance"],
  conditionsOrConcerns: ["healthy adults"],
} as const;

const PARSED_FOCUSED_PROFILE = researchScoutProfileSchema.parse(
  FOCUSED_PROFILE,
);

const FOCUSED_INPUT = {
  profile: PARSED_FOCUSED_PROFILE,
  since: "2021-01-01T00:00:00.000Z",
  until: "2026-08-06T00:00:00.000Z",
  maxCandidates: 6,
} as const;

describe("focused structured Exa research", () => {
  it("synthesizes and round-trips a canonical focused request from compact categories", () => {
    const request = buildExaResearchScoutRequest(FOCUSED_INPUT);

    expect(request.type).toBe("deep-reasoning");
    expect(request.category).toBe("research paper");
    expect(request.numResults).toBe(6);
    expect(request.moderation).toBe(true);
    expect(request.query).toContain(
      "What does high-quality recent human research show for this focused structured scope?",
    );
    expect(request.query).toContain("Topics: creatine, cognitive performance");
    expect(request.query).toContain("Conditions or concerns: healthy adults");
    expect(request.query).not.toContain("Question:");
    expect(request.systemPrompt).toContain("focused structured scope");
    expect(parseExaResearchScoutRequestBody(request)).toEqual({
      numResults: 6,
      profile: PARSED_FOCUSED_PROFILE,
      since: FOCUSED_INPUT.since,
      until: FOCUSED_INPUT.until,
    });
    expect(resolveResearchScoutProfileKind(PARSED_FOCUSED_PROFILE)).toBe(
      "focused_profile",
    );
  });

  it.each([
    { topics: ["us guidelines", "creatine"] },
    { topics: ["phase i trials", "insomnia treatment"] },
    { topics: ["type i interferon signaling"] },
    { topics: ["mitochondrial complex i", "parkinsons disease"] },
    { topics: ["creatine cognition evidence 2010-2020"] },
  ])("allows useful compact focused scope: %j", (scope) => {
    expect(researchScoutProfileSchema.parse({
      mode: "focused",
      ...scope,
    })).toMatchObject({
      mode: "focused",
      ...scope,
    });
  });

  it.each([
    "What evidence applies to sampleperson's recurring migraines?",
    "What evidence applies to SAMPLEPERSON's recurring migraines?",
    "What evidence applies to SaMpLePeRsOn's recurring migraines?",
    "What evidence applies to sampleperson taking lithium?",
    "What evidence applies to s a m p l e p e r s o n with recurring migraines?",
    "What should I do about my LDL 181 mg/dL?",
    "What does the research say about the resident at 123 Main Street?",
  ])("rejects arbitrary question prose for every private-person casing: %s", (question) => {
    expect(() => researchScoutProfileSchema.parse({ question })).toThrow();
    expect(() => researchScoutProfileSchema.parse({
      mode: "focused",
      question,
      topics: ["migraine treatment"],
    })).toThrow();
  });

  it("requires at least one compact category for focused mode", () => {
    expect(() => researchScoutProfileSchema.parse({
      mode: "focused",
    })).toThrow(/must include at least one compact non-identifying profile tag/u);
  });

  it("keeps batch discovery on tag-only profiles", () => {
    expect(() => researchScoutBatchPayloadSchema.parse({
      lanes: [
        {
          label: "cognition",
          profile: PARSED_FOCUSED_PROFILE,
        },
      ],
    })).toThrow();
  });
});
