import { describe, expect, it } from "vitest";

import {
  buildExaResearchScoutRequest,
  parseExaResearchScoutRequestBody,
  researchScoutBatchPayloadSchema,
  researchScoutProfileSchema,
  resolveResearchScoutProfileKind,
} from "../src/exa-research-scout.ts";

const QUESTION_PROFILE = {
  question:
    "What do recent randomized trials and systematic reviews show about creatine and cognitive performance in healthy adults?",
} as const;

const PARSED_QUESTION_PROFILE = researchScoutProfileSchema.parse(
  QUESTION_PROFILE,
);

const QUESTION_INPUT = {
  profile: PARSED_QUESTION_PROFILE,
  since: "2021-01-01T00:00:00.000Z",
  until: "2026-08-06T00:00:00.000Z",
  maxCandidates: 6,
} as const;

const ALLOWED_PUBLIC_QUESTIONS = [
  "What did the 2025 Stanford University review conclude about GLP-1 medicines and cardiovascular outcomes?",
  "What do US guidelines recommend about creatine use in healthy adults?",
  "What do studies tell us about sleep regularity and cardiometabolic risk?",
  "How should we interpret conflicting evidence about morning light and sleep timing?",
  "What changed in human research from 2010-2020 about creatine and cognition?",
  "What changed in human research from 2010 - 2020 about creatine and cognition?",
  "What should we do about sleep deprivation at a population level?",
  "What do phase I trials show about a new insomnia treatment?",
  "What does type I interferon signaling indicate in human studies?",
  "What does mitochondrial complex I research show about Parkinson's disease?",
] as const;

describe("focused public Exa research questions", () => {
  it("reuses the canonical research-paper request and round-trips through the hosted parser", () => {
    const request = buildExaResearchScoutRequest(QUESTION_INPUT);

    expect(request.type).toBe("deep-reasoning");
    expect(request.category).toBe("research paper");
    expect(request.numResults).toBe(6);
    expect(request.moderation).toBe(true);
    expect(request.query).toContain(QUESTION_PROFILE.question);
    expect(request.query).toContain("generalized and non-identifying");
    expect(request.query).not.toContain("Topics:");
    expect(request.systemPrompt).toContain("focused public question");
    expect(parseExaResearchScoutRequestBody(request)).toEqual({
      numResults: 6,
      profile: PARSED_QUESTION_PROFILE,
      since: QUESTION_INPUT.since,
      until: QUESTION_INPUT.until,
    });
    expect(resolveResearchScoutProfileKind(PARSED_QUESTION_PROFILE)).toBe(
      "public_question",
    );
  });

  it.each(ALLOWED_PUBLIC_QUESTIONS)(
    "allows useful public research phrasing: %s",
    (question) => {
      expect(researchScoutProfileSchema.parse({ question })).toMatchObject({
        question,
        topics: [],
        behaviors: [],
      });
    },
  );

  it.each([
    "What should I do about my LDL 181 mg/dL?",
    "What does this mean for me at 27 years old?",
    "I experienced insomnia; what does the research show?",
    "Review the research for patient id member_123.",
    "Email person@example.test with the latest evidence.",
    "Use Bearer secret-token to research sleep.",
    "Use sk-live-secret-value to research sleep.",
    "Review https://private.example.test/note/token for evidence.",
    "Review private.example.test/note/token for evidence.",
    "Review the clinical note from mychart.",
    "What does 185 lb mean for health?",
    "What does 32% body fat mean for health?",
    "What applies to a 27-year-old adult?",
    "Research patient 123e4567-e89b-12d3-a456-426614174000.",
    "Can I take creatine for cognition?",
    "What do phase I trials show, and should I take the treatment?",
    "Research the appointment from 2026-08-06.",
    "What does blood pressure 125/85 mean for my health?",
  ])("rejects private or identifying question text before provider work: %s", (question) => {
    expect(() => researchScoutProfileSchema.parse({ question })).toThrow(
      /focused public questions/u,
    );
  });

  it("rejects mixing a focused question with compact discovery tags", () => {
    expect(() => researchScoutProfileSchema.parse({
      question: QUESTION_PROFILE.question,
      topics: ["creatine"],
    })).toThrow(/either one focused public question or compact tag fields/u);
  });

  it("keeps batch discovery on compact tag profiles rather than question-shaped lanes", () => {
    expect(() => researchScoutBatchPayloadSchema.parse({
      lanes: [
        {
          label: "cognition",
          profile: PARSED_QUESTION_PROFILE,
        },
      ],
    })).toThrow();
  });
});
