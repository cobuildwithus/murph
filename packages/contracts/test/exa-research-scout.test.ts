import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE,
  buildExaResearchScoutOutputSchema,
  buildExaResearchScoutBatchLaneRequest,
  clampExaResearchScoutPublishedWindow,
  EXA_RESEARCH_SCOUT_CATEGORY,
  EXA_RESEARCH_SCOUT_METHOD,
  EXA_RESEARCH_SCOUT_PATH,
  EXA_RESEARCH_SCOUT_SYSTEM_PROMPT,
  MAX_RESEARCH_SCOUT_BATCH_LANES,
  parseExaResearchScoutRequestBody,
  researchScoutBatchInputSchema,
  researchScoutBatchPayloadSchema,
  researchScoutProfileSchema,
} from "../src/exa-research-scout.ts";

const VALID_INPUT = {
  profile: {
    topics: ["sleep", "metabolic health"],
    biomarkers: ["glucose", "hs-crp"],
    behaviors: ["resistance training", "yoga"],
    supplements: ["creatine", "omega-3"],
    conditionsOrConcerns: ["menopause"],
    goals: ["longevity"],
    activeExperiments: [],
  },
  since: "2026-04-18T00:00:00.000Z",
  until: "2026-06-17T00:00:00.000Z",
  maxCandidates: 4,
};

describe("Exa research scout contracts", () => {
  it("builds the current research-paper request recipe from a compact profile", () => {
    const request = buildExaResearchScoutBatchLaneRequest(VALID_INPUT);

    expect(EXA_RESEARCH_SCOUT_METHOD).toBe("POST");
    expect(EXA_RESEARCH_SCOUT_PATH).toBe("/search");
    expect(request.category).toBe(EXA_RESEARCH_SCOUT_CATEGORY);
    expect(request.type).toBe("deep-reasoning");
    expect(request.moderation).toBe(true);
    expect(request.numResults).toBe(4);
    expect(request.query).toBe([
      "Find high-quality new human health research.",
      "Research should relate to this non-identifying health interest profile.",
      "",
      "Topics: sleep, metabolic health",
      "Biomarkers: glucose, hs-crp",
      "Behaviors: resistance training, yoga",
      "Supplements: creatine, omega-3",
      "Conditions or concerns: menopause",
      "Goals: longevity",
      "Active experiments: none",
      "",
      "Prefer studies, clinical guidelines, therapy research, treatment research, and credible reviews.",
      "Prefer candidates whose finding changes interpretation, measurement, or clinician-question framing.",
      "Reject generic wellness content, obvious habit basics, social media, marketing pages, podcasts, and unsupported supplement claims.",
      "Return candidates that can later be checked locally against a private user vault; local context decides send-worthiness.",
    ].join("\n"));
    expect(request.systemPrompt).toBe(EXA_RESEARCH_SCOUT_SYSTEM_PROMPT);
    expect(request.outputSchema).toEqual(buildExaResearchScoutOutputSchema(4));
    expect(parseExaResearchScoutRequestBody(request)).toEqual({
      numResults: 4,
      profile: VALID_INPUT.profile,
      since: VALID_INPUT.since,
      until: VALID_INPUT.until,
    });
  });

  it("allows finite focused concepts and rejects mode-less single-scout profiles", () => {
    expect(researchScoutProfileSchema.parse({
      mode: "focused",
      behaviors: ["yoga"],
      conditionsOrConcerns: ["menopause"],
    })).toMatchObject({
      mode: "focused",
      behaviors: ["yoga"],
      conditionsOrConcerns: ["menopause"],
    });

    expect(() =>
      researchScoutProfileSchema.parse({
        biomarkers: ["ldl cholesterol"],
      })
    ).toThrow();
    expect(() =>
      researchScoutProfileSchema.parse({
        mode: "focused",
        topics: ["sampleperson"],
      })
    ).toThrow(/exact server-owned public concepts/u);
    expect(() =>
      researchScoutProfileSchema.parse({
        mode: "focused",
        conditionsOrConcerns: ["mayo clinic"],
      })
    ).toThrow(/exact server-owned public concepts/u);
  });

  it("bounds batch lanes while reusing compact profile validation", () => {
    expect(researchScoutBatchPayloadSchema.parse({
      lanes: [
        {
          label: "sleep",
          profile: {
            topics: ["sleep"],
            behaviors: ["morning light"],
          },
        },
      ],
    })).toMatchObject({
      lanes: [
        {
          label: "sleep",
          profile: {
            topics: ["sleep"],
            behaviors: ["morning light"],
            biomarkers: [],
            supplements: [],
            conditionsOrConcerns: [],
            goals: [],
            activeExperiments: [],
          },
        },
      ],
    });

    expect(() =>
      researchScoutBatchPayloadSchema.parse({
        lanes: Array.from({ length: MAX_RESEARCH_SCOUT_BATCH_LANES + 1 }, (_, index) => ({
          label: `lane ${index + 1}`,
          profile: {
            topics: ["sleep"],
          },
        })),
      })
    ).toThrow();
    expect(() =>
      researchScoutBatchPayloadSchema.parse({
        lanes: [
          {
            label: "sleep",
            profile: {},
          },
        ],
      })
    ).toThrow(/at least one compact profile tag/u);
  });

  it("defaults batch candidate requests per lane without widening the single-call cap", () => {
    expect(researchScoutBatchInputSchema.parse({
      lanes: [
        {
          label: "sleep",
          profile: {
            topics: ["sleep"],
          },
        },
      ],
      since: VALID_INPUT.since,
      until: VALID_INPUT.until,
    }).maxCandidatesPerLane).toBe(DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE);

    expect(() =>
      researchScoutBatchInputSchema.parse({
        lanes: [
          {
            label: "sleep",
            profile: {
              topics: ["sleep"],
            },
          },
        ],
        since: VALID_INPUT.since,
        until: VALID_INPUT.until,
        maxCandidatesPerLane: 13,
      })
    ).toThrow();
  });

  it("rejects drift from the exact request shape", () => {
    const request = buildExaResearchScoutBatchLaneRequest(VALID_INPUT);

    expect(parseExaResearchScoutRequestBody({
      ...request,
      category: "news",
    })).toBeNull();
    expect(parseExaResearchScoutRequestBody({
      ...request,
      includeDomains: ["example.test"],
    })).toBeNull();
    expect(parseExaResearchScoutRequestBody({
      ...request,
      startPublishedDate: "2026-02-31T00:00:00.000Z",
    })).toBeNull();
    expect(parseExaResearchScoutRequestBody({
      ...request,
      numResults: 2,
      outputSchema: buildExaResearchScoutOutputSchema(4),
    })).toBeNull();
  });

  describe("clampExaResearchScoutPublishedWindow", () => {
    const now = new Date("2026-06-17T12:34:56.789Z");

    it("preserves a well-formed caller window", () => {
      expect(clampExaResearchScoutPublishedWindow({
        now,
        since: "2026-04-25T00:00:00.000Z",
        until: "2026-06-17T00:00:00.000Z",
      })).toEqual({
        since: "2026-04-25T00:00:00.000Z",
        until: "2026-06-17T00:00:00.000Z",
      });
    });

    it("preserves arbitrarily wide caller windows; the model decides scope", () => {
      expect(clampExaResearchScoutPublishedWindow({
        now,
        since: "2010-01-01T00:00:00.000Z",
        until: "2026-06-17T00:00:00.000Z",
      })).toEqual({
        since: "2010-01-01T00:00:00.000Z",
        until: "2026-06-17T00:00:00.000Z",
      });
    });

    it("rejects until-in-the-future beyond clock skew", () => {
      expect(clampExaResearchScoutPublishedWindow({
        now,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-17T13:34:56.789Z",
      })).toBeNull();
    });

    it("rejects since >= until", () => {
      expect(clampExaResearchScoutPublishedWindow({
        now,
        since: "2026-06-17T00:00:00.000Z",
        until: "2026-06-17T00:00:00.000Z",
      })).toBeNull();
      expect(clampExaResearchScoutPublishedWindow({
        now,
        since: "2026-06-17T00:00:00.001Z",
        until: "2026-06-17T00:00:00.000Z",
      })).toBeNull();
    });

    it("rejects non-canonical ISO timestamps", () => {
      expect(clampExaResearchScoutPublishedWindow({
        now,
        since: "2026-06-17",
        until: "2026-06-17T00:00:00.000Z",
      })).toBeNull();
    });
  });
});
