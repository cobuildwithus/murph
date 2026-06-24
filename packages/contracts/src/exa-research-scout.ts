import * as z from "zod";

import { isStrictIsoDateTime } from "./time.ts";

export const EXA_RESEARCH_SCOUT_PROVIDER_NAME = "exa";
export const EXA_RESEARCH_SCOUT_ENDPOINT = "search";
export const EXA_RESEARCH_SCOUT_PATH = "/search";
export const EXA_RESEARCH_SCOUT_METHOD = "POST";
export const EXA_RESEARCH_SCOUT_MODE = "deep-reasoning";
export const EXA_RESEARCH_SCOUT_CATEGORY = "research paper";
export const DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS = 60_000;
export const MAX_RESEARCH_SCOUT_CANDIDATES = 12;

export const EXA_RESEARCH_SCOUT_SYSTEM_PROMPT = [
  "Find high-quality recent human health research.",
  "Prefer clinical guidelines, meta-analyses, systematic reviews, randomized trials, and large prospective cohorts.",
  "Include therapies or treatments only when source quality is credible.",
  "Avoid generic wellness news, supplement marketing, podcasts, tweets, and fear-mongering.",
  "Return candidate studies or sources, not personalized medical advice.",
  "Keep caveats explicit.",
  "Use resultIndex to point to the source in the returned search results; do not put citation fields in the structured output.",
].join("\n");

const EXA_RESEARCH_SCOUT_QUERY_PREFIX_LINES = [
  "Find high-quality new human health research.",
  "Research should relate to this non-identifying health interest profile.",
  "",
] as const;

const EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS = [
  {
    field: "topics",
    label: "Topics",
    maxItems: 24,
    maxLength: 80,
  },
  {
    field: "biomarkers",
    label: "Biomarkers",
    maxItems: 24,
    maxLength: 80,
  },
  {
    field: "behaviors",
    label: "Behaviors",
    maxItems: 24,
    maxLength: 80,
  },
  {
    field: "supplements",
    label: "Supplements",
    maxItems: 24,
    maxLength: 80,
  },
  {
    field: "conditionsOrConcerns",
    label: "Conditions or concerns",
    maxItems: 16,
    maxLength: 120,
  },
  {
    field: "goals",
    label: "Goals",
    maxItems: 16,
    maxLength: 120,
  },
  {
    field: "activeExperiments",
    label: "Active experiments",
    maxItems: 12,
    maxLength: 120,
  },
] as const;

const EXA_RESEARCH_SCOUT_QUERY_SUFFIX_LINES = [
  "",
  "Prefer studies, clinical guidelines, therapy research, treatment research, and credible reviews.",
  "Reject generic wellness content, social media, marketing pages, podcasts, and unsupported supplement claims.",
  "Return candidates that can later be checked locally against a private user vault.",
] as const;

const EXA_RESEARCH_SCOUT_REQUEST_KEYS = [
  "query",
  "type",
  "category",
  "startPublishedDate",
  "endPublishedDate",
  "numResults",
  "moderation",
  "systemPrompt",
  "outputSchema",
] as const;

const EXA_RESEARCH_SCOUT_STRUCTURED_REQUIRED_KEYS = [
  "resultIndex",
  "studyType",
  "matchedProfileTags",
  "keyFinding",
  "whyItMayMatter",
  "evidenceStrength",
  "actionOrQuestion",
  "doNotOverinterpret",
  "hypeRisk",
] as const;

const unsafeResearchScoutTagPatterns = [
  /[\r\n\t]/u,
  /[A-Z]/u,
  /[^\s@]+@[^\s@]+\.[^\s@]+/u,
  /\b\+?\d[\d\s().-]{7,}\d\b/u,
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/u,
  /\b(?:dob|date of birth|birthdate|born on)\b/iu,
  /\b(?:dr|doctor|clinician|physician|surgeon|therapist|coach|provider|clinic|hospital|university|school|employer|company|inc|llc|corp|address|street|avenue|road|appointment|visit|mychart)\b/iu,
  /\b\d{2,3}\/\d{2,3}\b/u,
  /\b\d+(?:\.\d+)?\s*(?:mg\/dL|mg\/dl|mmol\/L|mmol\/l|ng\/mL|ng\/ml|pg\/mL|pg\/ml|mcg\/mL|mcg\/ml|IU\/L|iu\/l|U\/L|u\/l|bpm|mmHg|mmhg|kg|lbs?|cm|in|%)\b/u,
  /\b(?:a1c|hba1c|ldl|hdl|apo\s?b|hs-?crp|crp|glucose|triglycerides?|tsh|ferritin|vitamin d|25-?oh|testosterone|cortisol|alt|ast|egfr|gfr|creatinine|hemoglobin|platelets?)\b[^a-z0-9]{0,12}\d+(?:\.\d+)?\b/iu,
  /\b(?:i|i'm|ive|i've|me|my|mine)\b/iu,
] as const;
const researchScoutCategoryTagPattern = /^[a-z0-9](?:[a-z0-9 /-]*[a-z0-9])?$/u;

export function isSafeResearchScoutProfileTag(value: string): boolean {
  const tag = value.trim();
  if (!tag || tag !== value) {
    return false;
  }
  if (tag.split(/\s+/u).length > 10) {
    return false;
  }
  if (!researchScoutCategoryTagPattern.test(tag)) {
    return false;
  }
  return !unsafeResearchScoutTagPatterns.some((pattern) => pattern.test(tag));
}

const unsafeResearchScoutTagMessage =
  "Research scout profile tags must be broad lowercase non-identifying categories, not raw values, dates, contacts, proper nouns, organizations, or notes.";

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(isSafeResearchScoutProfileTag, {
    message: unsafeResearchScoutTagMessage,
  });

const longerTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isSafeResearchScoutProfileTag, {
    message: unsafeResearchScoutTagMessage,
  });

export const researchScoutProfileSchema = z
  .object({
    topics: z.array(tagSchema).max(24).default([]),
    biomarkers: z.array(tagSchema).max(24).default([]),
    behaviors: z.array(tagSchema).max(24).default([]),
    supplements: z.array(tagSchema).max(24).default([]),
    conditionsOrConcerns: z.array(longerTagSchema).max(16).default([]),
    goals: z.array(longerTagSchema).max(16).default([]),
    activeExperiments: z.array(longerTagSchema).max(12).default([]),
  })
  .strict();

export const researchScoutInputSchema = z
  .object({
    profile: researchScoutProfileSchema,
    since: z.string().datetime(),
    until: z.string().datetime(),
    maxCandidates: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESEARCH_SCOUT_CANDIDATES)
      .default(MAX_RESEARCH_SCOUT_CANDIDATES),
  })
  .strict();

export const researchScoutStudyTypeSchema = z.enum([
  "guideline",
  "meta_analysis",
  "systematic_review",
  "randomized_trial",
  "prospective_cohort",
  "observational",
  "case_study",
  "preclinical",
  "preprint",
  "news_or_commentary",
]);

export const researchScoutEvidenceStrengthSchema = z.enum([
  "strong",
  "moderate",
  "early",
  "weak",
]);

export const researchScoutHypeRiskSchema = z.enum(["low", "medium", "high"]);

export const researchScoutResultSchema = z
  .object({
    provider: z
      .object({
        name: z.literal(EXA_RESEARCH_SCOUT_PROVIDER_NAME),
        endpoint: z.literal(EXA_RESEARCH_SCOUT_ENDPOINT),
        mode: z.literal(EXA_RESEARCH_SCOUT_MODE),
      })
      .strict(),
    privacy: z
      .object({
        tokenSource: z.literal("env"),
        persistedByTool: z.literal(false),
        sentProfileKind: z.literal("tag_profile"),
        rawVaultValuesSent: z.literal(false),
      })
      .strict(),
    response: z.unknown(),
  })
  .strict();

export const exaResearchScoutStructuredCandidateSchema = z
  .object({
    resultIndex: z.number().int().min(0).max(99),
    studyType: researchScoutStudyTypeSchema,
    matchedProfileTags: z.array(longerTagSchema).max(16),
    keyFinding: z.string().min(1).max(700),
    whyItMayMatter: z.string().min(1).max(700),
    evidenceStrength: researchScoutEvidenceStrengthSchema,
    actionOrQuestion: z.string().min(1).max(500),
    doNotOverinterpret: z.string().min(1).max(500),
    hypeRisk: researchScoutHypeRiskSchema,
  })
  .strict();

export const exaResearchScoutStructuredOutputSchema = z
  .object({
    candidates: z
      .array(exaResearchScoutStructuredCandidateSchema)
      .max(MAX_RESEARCH_SCOUT_CANDIDATES),
  })
  .strict();

export interface ExaResearchScoutRequestBody {
  category: typeof EXA_RESEARCH_SCOUT_CATEGORY;
  endPublishedDate: string;
  moderation: true;
  numResults: number;
  outputSchema: ExaResearchScoutOutputSchema;
  query: string;
  startPublishedDate: string;
  systemPrompt: string;
  type: typeof EXA_RESEARCH_SCOUT_MODE;
}

export interface ExaResearchScoutOutputSchema {
  properties: {
    candidates: {
      items: {
        properties: Record<string, unknown>;
        required: readonly string[];
        type: "object";
      };
      maxItems: number;
      type: "array";
    };
  };
  required: readonly ["candidates"];
  type: "object";
}

export interface ExaResearchScoutParsedRequest {
  numResults: number;
  profile: ResearchScoutProfile;
  since: string;
  until: string;
}

export type ResearchScoutInput = z.infer<typeof researchScoutInputSchema>;
export type ResearchScoutProfile = z.infer<typeof researchScoutProfileSchema>;
export type ResearchScoutResult = z.infer<typeof researchScoutResultSchema>;
export type ExaResearchScoutStructuredCandidate = z.infer<
  typeof exaResearchScoutStructuredCandidateSchema
>;

export function buildResearchScoutQuery(profile: ResearchScoutProfile): string {
  return [
    ...EXA_RESEARCH_SCOUT_QUERY_PREFIX_LINES,
    ...EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS.map((section) =>
      `${section.label}: ${joinTags(profile[section.field])}`
    ),
    ...EXA_RESEARCH_SCOUT_QUERY_SUFFIX_LINES,
  ].join("\n");
}

export function buildExaResearchScoutRequest(
  input: ResearchScoutInput,
): ExaResearchScoutRequestBody {
  const parsed = researchScoutInputSchema.parse(input);
  return buildExaResearchScoutRequestFromQuery({
    query: buildResearchScoutQuery(parsed.profile),
    since: parsed.since,
    until: parsed.until,
    maxCandidates: parsed.maxCandidates,
  });
}

export function buildExaResearchScoutRequestFromQuery(input: {
  maxCandidates: number;
  query: string;
  since: string;
  until: string;
}): ExaResearchScoutRequestBody {
  const startPublishedDate = normalizeCanonicalUtcTimestamp(input.since);
  const endPublishedDate = normalizeCanonicalUtcTimestamp(input.until);
  if (
    !isValidResearchScoutCandidateCount(input.maxCandidates)
    || !isExaResearchScoutQuery(input.query)
    || !isCanonicalUtcIsoTimestamp(startPublishedDate)
    || !isCanonicalUtcIsoTimestamp(endPublishedDate)
  ) {
    throw new Error("Invalid Exa research scout request recipe input.");
  }

  return {
    query: input.query,
    type: EXA_RESEARCH_SCOUT_MODE,
    category: EXA_RESEARCH_SCOUT_CATEGORY,
    startPublishedDate,
    endPublishedDate,
    numResults: input.maxCandidates,
    moderation: true,
    systemPrompt: EXA_RESEARCH_SCOUT_SYSTEM_PROMPT,
    outputSchema: buildExaResearchScoutOutputSchema(input.maxCandidates),
  };
}

export function buildExaResearchScoutOutputSchema(
  maxCandidates: number,
): ExaResearchScoutOutputSchema {
  if (!isValidResearchScoutCandidateCount(maxCandidates)) {
    throw new Error("Invalid Exa research scout candidate count.");
  }

  return {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        maxItems: maxCandidates,
        items: {
          type: "object",
          properties: {
            resultIndex: { type: "integer" },
            studyType: {
              type: "string",
              enum: researchScoutStudyTypeSchema.options,
            },
            matchedProfileTags: {
              type: "array",
              items: { type: "string" },
            },
            keyFinding: { type: "string" },
            whyItMayMatter: { type: "string" },
            evidenceStrength: {
              type: "string",
              enum: researchScoutEvidenceStrengthSchema.options,
            },
            actionOrQuestion: { type: "string" },
            doNotOverinterpret: { type: "string" },
            hypeRisk: {
              type: "string",
              enum: researchScoutHypeRiskSchema.options,
            },
          },
          required: EXA_RESEARCH_SCOUT_STRUCTURED_REQUIRED_KEYS,
        },
      },
    },
    required: ["candidates"],
  };
}

export const EXA_RESEARCH_SCOUT_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function clampExaResearchScoutPublishedWindow(input: {
  now: Date;
  since: string;
  until: string;
}): { since: string; until: string } | null {
  if (
    !isCanonicalUtcIsoTimestamp(input.since)
    || !isCanonicalUtcIsoTimestamp(input.until)
  ) {
    return null;
  }
  const sinceMs = Date.parse(input.since);
  const untilMs = Date.parse(input.until);
  const nowMs = input.now.getTime();
  if (
    !Number.isFinite(sinceMs)
    || !Number.isFinite(untilMs)
    || sinceMs >= untilMs
    || untilMs > nowMs + EXA_RESEARCH_SCOUT_FUTURE_CLOCK_SKEW_MS
  ) {
    return null;
  }
  return { since: input.since, until: input.until };
}

export function parseExaResearchScoutRequestBody(
  parsed: unknown,
): ExaResearchScoutParsedRequest | null {
  if (
    !isJsonRecord(parsed)
    || !hasExactJsonKeys(parsed, EXA_RESEARCH_SCOUT_REQUEST_KEYS)
  ) {
    return null;
  }

  const numResults = parsed.numResults;
  const query = parsed.query;
  const profile = parseResearchScoutQuery(query);
  if (
    typeof query !== "string"
    || profile === null
    || parsed.type !== EXA_RESEARCH_SCOUT_MODE
    || parsed.category !== EXA_RESEARCH_SCOUT_CATEGORY
    || !isCanonicalUtcIsoTimestamp(parsed.startPublishedDate)
    || !isCanonicalUtcIsoTimestamp(parsed.endPublishedDate)
    || typeof numResults !== "number"
    || !Number.isInteger(numResults)
    || numResults < 1
    || numResults > MAX_RESEARCH_SCOUT_CANDIDATES
    || parsed.moderation !== true
    || parsed.systemPrompt !== EXA_RESEARCH_SCOUT_SYSTEM_PROMPT
    || !isExactJsonValue(
      parsed.outputSchema,
      buildExaResearchScoutOutputSchema(numResults),
    )
  ) {
    return null;
  }

  return {
    numResults,
    profile,
    since: parsed.startPublishedDate,
    until: parsed.endPublishedDate,
  };
}

export function isExaResearchScoutQuery(value: unknown): boolean {
  return parseResearchScoutQuery(value) !== null;
}

export function parseResearchScoutQuery(value: unknown): ResearchScoutProfile | null {
  if (typeof value !== "string" || value.length > 4_096) {
    return null;
  }
  const lines = value.split("\n");
  const expectedLineCount =
    EXA_RESEARCH_SCOUT_QUERY_PREFIX_LINES.length
    + EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS.length
    + EXA_RESEARCH_SCOUT_QUERY_SUFFIX_LINES.length;
  if (lines.length !== expectedLineCount) {
    return null;
  }

  let lineIndex = 0;
  for (const expected of EXA_RESEARCH_SCOUT_QUERY_PREFIX_LINES) {
    if (lines[lineIndex] !== expected) {
      return null;
    }
    lineIndex += 1;
  }

  const profile: Record<keyof ResearchScoutProfile, string[]> = {
    activeExperiments: [],
    behaviors: [],
    biomarkers: [],
    conditionsOrConcerns: [],
    goals: [],
    supplements: [],
    topics: [],
  };
  for (const section of EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS) {
    const prefix = `${section.label}: `;
    const line = lines[lineIndex] ?? "";
    if (!line.startsWith(prefix)) {
      return null;
    }
    const tags = parseSafeResearchScoutTags(line.slice(prefix.length), section);
    if (tags === null) {
      return null;
    }
    profile[section.field] = tags;
    lineIndex += 1;
  }

  for (const expected of EXA_RESEARCH_SCOUT_QUERY_SUFFIX_LINES) {
    if (lines[lineIndex] !== expected) {
      return null;
    }
    lineIndex += 1;
  }
  const parsed = researchScoutProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data : null;
}

export function isCanonicalUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40 || !isStrictIsoDateTime(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseSafeResearchScoutTags(
  rawValue: string,
  section: {
    maxItems: number;
    maxLength: number;
  },
): string[] | null {
  if (rawValue === "none") {
    return [];
  }
  if (!rawValue || rawValue.trim() !== rawValue) {
    return null;
  }
  const tags = rawValue.split(", ");
  if (
    tags.length === 0
    || tags.length > section.maxItems
    || !tags.every((tag) =>
      tag.length <= section.maxLength
      && isSafeResearchScoutProfileTag(tag)
    )
  ) {
    return null;
  }
  return tags;
}

function normalizeCanonicalUtcTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Date(timestamp).toISOString();
}

function isValidResearchScoutCandidateCount(value: number): boolean {
  return (
    Number.isInteger(value)
    && value >= 1
    && value <= MAX_RESEARCH_SCOUT_CANDIDATES
  );
}

function joinTags(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function isExactJsonValue(value: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return value === expected;
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(value)
      && value.length === expected.length
      && expected.every((entry, index) => isExactJsonValue(value[index], entry))
    );
  }
  if (!isJsonRecord(value) || !isJsonRecord(expected)) {
    return false;
  }
  const expectedKeys = Object.keys(expected);
  return (
    hasExactJsonKeys(value, expectedKeys)
    && expectedKeys.every((key) => isExactJsonValue(value[key], expected[key]))
  );
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactJsonKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}
