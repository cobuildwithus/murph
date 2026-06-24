import { describe, expect, it } from "vitest";

import {
  buildExaResearchScoutOutputSchema,
  buildExaResearchScoutRequest,
  clampExaResearchScoutPublishedWindow,
  EXA_RESEARCH_SCOUT_CATEGORY,
  EXA_RESEARCH_SCOUT_METHOD,
  EXA_RESEARCH_SCOUT_PATH,
  parseExaResearchScoutRequestBody,
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
    const request = buildExaResearchScoutRequest(VALID_INPUT);

    expect(EXA_RESEARCH_SCOUT_METHOD).toBe("POST");
    expect(EXA_RESEARCH_SCOUT_PATH).toBe("/search");
    expect(request.category).toBe(EXA_RESEARCH_SCOUT_CATEGORY);
    expect(request.type).toBe("deep-reasoning");
    expect(request.moderation).toBe(true);
    expect(request.numResults).toBe(4);
    expect(request.query).toContain("Behaviors: resistance training, yoga");
    expect(request.query).toContain("Conditions or concerns: menopause");
    expect(request.outputSchema).toEqual(buildExaResearchScoutOutputSchema(4));
    expect(parseExaResearchScoutRequestBody(request)).toEqual({
      numResults: 4,
      profile: VALID_INPUT.profile,
      since: VALID_INPUT.since,
      until: VALID_INPUT.until,
    });
  });

  it("allows broad lowercase category tags but rejects raw or identifying profile data", () => {
    expect(researchScoutProfileSchema.parse({
      behaviors: ["yoga"],
      conditionsOrConcerns: ["menopause"],
    })).toMatchObject({
      behaviors: ["yoga"],
      conditionsOrConcerns: ["menopause"],
    });

    expect(() =>
      researchScoutProfileSchema.parse({
        biomarkers: ["LDL 181 mg/dL"],
      })
    ).toThrow(/non-identifying categories/u);
    expect(() =>
      researchScoutProfileSchema.parse({
        topics: ["John Smith"],
      })
    ).toThrow(/non-identifying categories/u);
    expect(() =>
      researchScoutProfileSchema.parse({
        conditionsOrConcerns: ["mayo clinic"],
      })
    ).toThrow(/non-identifying categories/u);
  });

  it("rejects drift from the exact request shape", () => {
    const request = buildExaResearchScoutRequest(VALID_INPUT);

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
