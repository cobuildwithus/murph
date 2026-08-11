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
  topics: ["cognition"],
  supplements: ["creatine"],
  conditionsOrConcerns: ["healthy adults"],
  goals: ["cognitive performance"],
} as const;

const FOCUSED_PROFILE_FIELDS = [
  "topics",
  "biomarkers",
  "behaviors",
  "supplements",
  "conditionsOrConcerns",
  "goals",
  "activeExperiments",
] as const;

const PRIVATE_FOCUSED_VALUES = [
  "sampleperson recurring headaches",
  "TeSt SuBjEcT supplement use".toLowerCase(),
  "examplelab staff sleep",
  "participant 7304 headache",
  "tenant at 456 sample boulevard",
  "passphrase demo-access",
  "intake summary persistent sleeplessness",
] as const;

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
    expect(request.query).toContain("Topics: cognition");
    expect(request.query).toContain("Supplements: creatine");
    expect(request.query).toContain("Conditions or concerns: healthy adults");
    expect(request.query).toContain("Goals: cognitive performance");
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
    { topics: ["us guidelines"] },
    { topics: ["phase i trials"], conditionsOrConcerns: ["insomnia"] },
    { topics: ["type i interferon signaling"] },
    {
      topics: ["mitochondrial complex i"],
      conditionsOrConcerns: ["parkinsons disease"],
    },
  ])("allows useful compact focused scope: %j", (scope) => {
    const profile = researchScoutProfileSchema.parse({
      mode: "focused",
      ...scope,
    });
    expect(profile).toMatchObject({
      mode: "focused",
      ...scope,
    });
    const request = buildExaResearchScoutRequest({
      profile,
      since: FOCUSED_INPUT.since,
      until: FOCUSED_INPUT.until,
      maxCandidates: FOCUSED_INPUT.maxCandidates,
    });
    expect(parseExaResearchScoutRequestBody(request)?.profile).toEqual(profile);
  });

  it("rejects every private-shaped value in every focused field", () => {
    for (const field of FOCUSED_PROFILE_FIELDS) {
      for (const value of PRIVATE_FOCUSED_VALUES) {
        expect(researchScoutProfileSchema.safeParse({
          mode: "focused",
          [field]: [value],
        }).success).toBe(false);
        expect(researchScoutProfileSchema.safeParse({
          [field]: [value],
        }).success).toBe(false);
      }
    }
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
    })).toThrow(/must include at least one server-owned public concept/u);
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
