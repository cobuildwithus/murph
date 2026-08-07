import * as z from "./zod-runtime.ts";

import { isStrictIsoDateTime } from "./time.ts";

export const EXA_RESEARCH_SCOUT_PROVIDER_NAME = "exa";
export const EXA_RESEARCH_SCOUT_ENDPOINT = "search";
export const EXA_RESEARCH_SCOUT_PATH = "/search";
export const EXA_RESEARCH_SCOUT_METHOD = "POST";
export const EXA_RESEARCH_SCOUT_MODE = "deep-reasoning";
export const EXA_RESEARCH_SCOUT_CATEGORY = "research paper";
export const DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS = 60_000;
export const MAX_RESEARCH_SCOUT_CANDIDATES = 12;
export const MAX_RESEARCH_SCOUT_BATCH_LANES = 4;
export const DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE = 5;

export const EXA_RESEARCH_SCOUT_SYSTEM_PROMPT = [
  "Find high-quality recent human health research with practical interpretive value.",
  "Prefer clinical guidelines, meta-analyses, systematic reviews, randomized trials, and large prospective cohorts.",
  "Prefer sources whose findings could change interpretation of an active experiment, metric, clinician question, or tradeoff.",
  "Include therapies or treatments only when source quality is credible.",
  "Avoid generic wellness news, obvious habit basics, supplement marketing, podcasts, tweets, and fear-mongering.",
  "Return candidate studies or sources, not personalized medical advice or tasks to do.",
  "In actionOrQuestion, phrase a cautious possible interpretation or question, not a behavior prescription.",
  "Keep caveats explicit.",
  "Use resultIndex to point to the source in the returned search results; do not put citation fields in the structured output.",
].join("\n");

const EXA_RESEARCH_FOCUSED_SYSTEM_PROMPT = [
  "Find high-quality recent human research that directly addresses the supplied focused structured scope.",
  "Use the compact categories only as research scope; do not infer private user context.",
  "Prefer primary studies, systematic reviews, meta-analyses, clinical guidelines, randomized trials, and large cohorts suited to the scope.",
  "Distinguish established evidence from observational, preliminary, preclinical, or conflicting evidence.",
  "Avoid generic wellness content, marketing, podcasts, tweets, and unsupported claims.",
  "Return candidate studies or sources, not personalized medical advice or tasks to do.",
  "In matchedProfileTags, use only broad lowercase non-identifying concepts; use an empty array when no tag applies.",
  "In actionOrQuestion, phrase a cautious interpretation or follow-up question, not a behavior prescription.",
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
  "Prefer candidates whose finding changes interpretation, measurement, or clinician-question framing.",
  "Reject generic wellness content, obvious habit basics, social media, marketing pages, podcasts, and unsupported supplement claims.",
  "Return candidates that can later be checked locally against a private user vault; local context decides send-worthiness.",
] as const;

const EXA_RESEARCH_FOCUSED_QUERY_PREFIX_LINES = [
  "What does high-quality recent human research show for this focused structured scope?",
  "The scope contains compact non-identifying categories; do not infer private user context.",
  "",
] as const;
const EXA_RESEARCH_FOCUSED_QUERY_SUFFIX_LINES = [
  "",
  "Prefer systematic reviews, meta-analyses, clinical guidelines, randomized trials, large cohorts, and primary studies suited to the scope.",
  "Prioritize evidence that changes interpretation or identifies important uncertainty, limitations, or tradeoffs.",
  "Reject generic wellness content, social media, marketing pages, podcasts, and unsupported claims.",
  "Return candidate sources for local interpretation; do not infer private context or give personalized medical advice.",
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
type ResearchScoutProfileField =
  typeof EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS[number]["field"];
type ResearchScoutTagProfileShape = Record<ResearchScoutProfileField, readonly string[]>;

export const RESEARCH_SCOUT_FOCUSED_CONCEPTS_BY_FIELD = {
  topics: [
    "cardiometabolic risk",
    "cognition",
    "memory",
    "metabolic health",
    "mitochondrial complex i",
    "phase i trials",
    "recovery",
    "sleep",
    "sleep duration",
    "sleep regularity",
    "systematic reviews",
    "type i interferon signaling",
    "us guidelines",
  ],
  biomarkers: [
    "apob",
    "glucose",
    "hba1c",
    "hdl cholesterol",
    "hs-crp",
    "ldl cholesterol",
  ],
  behaviors: [
    "exercise",
    "meal timing",
    "morning light",
    "resistance training",
    "screen curfew",
    "sleep timing",
    "yoga",
    "zone 2 training",
  ],
  supplements: [
    "caffeine",
    "creatine",
    "magnesium",
    "omega-3",
    "vitamin d",
  ],
  conditionsOrConcerns: [
    "adults",
    "anxiety",
    "healthy adults",
    "insomnia",
    "menopause",
    "migraine",
    "older adults",
    "parkinsons disease",
    "sleep deprivation",
    "type 2 diabetes",
  ],
  goals: [
    "better recovery",
    "cardiometabolic health",
    "cognitive performance",
    "longevity",
    "memory",
    "sleep quality",
  ],
  activeExperiments: [
    "creatine supplementation",
    "meal timing",
    "morning light",
    "resistance training",
    "screen curfew",
  ],
} as const satisfies Record<ResearchScoutProfileField, readonly string[]>;

export const RESEARCH_SCOUT_FOCUSED_CONCEPT_GUIDANCE =
  EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS.map(
    (section) =>
      `${section.field}=[${RESEARCH_SCOUT_FOCUSED_CONCEPTS_BY_FIELD[section.field].join(", ")}]`,
  ).join("; ");

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

function isAllowedFocusedResearchScoutConcept(
  field: ResearchScoutProfileField,
  value: string,
): boolean {
  const concepts: readonly string[] =
    RESEARCH_SCOUT_FOCUSED_CONCEPTS_BY_FIELD[field];
  return concepts.includes(value);
}

const unsafeResearchScoutTagMessage =
  "Research scout profile tags must be broad lowercase non-identifying categories, not raw values, dates, contacts, proper nouns, organizations, or notes.";
const unsupportedFocusedResearchScoutConceptMessage =
  "Focused research scout values must be exact server-owned public concepts listed in the command guidance.";

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

function createResearchScoutProviderValuesSchema(
  field: ResearchScoutProfileField,
  maxItems: number,
  maxLength: number,
) {
  return z.array(
    z
      .string()
      .trim()
      .min(1)
      .max(maxLength)
      .refine(
        (value) => isAllowedFocusedResearchScoutConcept(field, value),
        { message: unsupportedFocusedResearchScoutConceptMessage },
      )
      .describe(
        `Allowed provider values: ${RESEARCH_SCOUT_FOCUSED_CONCEPTS_BY_FIELD[field].join(", ")}.`,
      ),
  ).max(maxItems).default([]);
}

const researchScoutProviderProfileShape = {
  topics: createResearchScoutProviderValuesSchema("topics", 24, 80),
  biomarkers: createResearchScoutProviderValuesSchema("biomarkers", 24, 80),
  behaviors: createResearchScoutProviderValuesSchema("behaviors", 24, 80),
  supplements: createResearchScoutProviderValuesSchema("supplements", 24, 80),
  conditionsOrConcerns: createResearchScoutProviderValuesSchema(
    "conditionsOrConcerns",
    16,
    120,
  ),
  goals: createResearchScoutProviderValuesSchema("goals", 16, 120),
  activeExperiments: createResearchScoutProviderValuesSchema(
    "activeExperiments",
    12,
    120,
  ),
} as const;

export const researchScoutTagProfileSchema = z
  .object(researchScoutProviderProfileShape)
  .strict();

const emptyFocusedResearchScoutProfileMessage =
  "Focused research scout input must include at least one server-owned public concept.";

export const researchScoutProfileSchema = z
  .object({
    ...researchScoutProviderProfileShape,
    mode: z.literal("focused"),
  })
  .strict()
  .superRefine((profile, context) => {
    if (!hasResearchScoutProfileTags(profile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: emptyFocusedResearchScoutProfileMessage,
        path: ["mode"],
      });
    }
  });

export const researchScoutProfileKindSchema = z.enum([
  "tag_profile",
  "focused_profile",
]);

export function hasResearchScoutProfileTags(
  profile: ResearchScoutTagProfileShape,
): boolean {
  return EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS.some(
    (section) => profile[section.field].length > 0,
  );
}

const emptyResearchScoutLaneProfileMessage =
  "Research scout batch lanes must include at least one compact profile tag.";

export const researchScoutBatchLaneSchema = z
  .object({
    label: tagSchema,
    profile: researchScoutTagProfileSchema.refine(hasResearchScoutProfileTags, {
      message: emptyResearchScoutLaneProfileMessage,
    }),
  })
  .strict();

export const researchScoutBatchPayloadSchema = z
  .object({
    lanes: z
      .array(researchScoutBatchLaneSchema)
      .min(1)
      .max(MAX_RESEARCH_SCOUT_BATCH_LANES),
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

const researchScoutTagInputSchema = researchScoutInputSchema
  .extend({ profile: researchScoutTagProfileSchema })
  .strict();

export const researchScoutBatchInputSchema = researchScoutBatchPayloadSchema
  .extend({
    since: z.string().datetime(),
    until: z.string().datetime(),
    maxCandidatesPerLane: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESEARCH_SCOUT_CANDIDATES)
      .default(DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE),
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
        sentProfileKind: researchScoutProfileKindSchema,
        rawVaultValuesSent: z.literal(false),
      })
      .strict(),
    response: z.unknown(),
  })
  .strict();

export const researchScoutBatchResultSchema = z
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
    lanes: z
      .array(z
        .object({
          label: tagSchema,
          response: z.unknown(),
        })
        .strict())
      .min(1)
      .max(MAX_RESEARCH_SCOUT_BATCH_LANES),
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
  profile: ResearchScoutProfile | ResearchScoutTagProfile;
  since: string;
  until: string;
}

export type ResearchScoutInput = z.infer<typeof researchScoutInputSchema>;
export type ResearchScoutTagInput = z.infer<typeof researchScoutTagInputSchema>;
export type ResearchScoutBatchInput = z.infer<typeof researchScoutBatchInputSchema>;
export type ResearchScoutBatchPayload = z.infer<typeof researchScoutBatchPayloadSchema>;
export type ResearchScoutBatchResult = z.infer<typeof researchScoutBatchResultSchema>;
export type ResearchScoutProfile = z.infer<typeof researchScoutProfileSchema>;
export type ResearchScoutTagProfile = z.infer<typeof researchScoutTagProfileSchema>;
export type ResearchScoutProfileKind = z.infer<typeof researchScoutProfileKindSchema>;
export type ResearchScoutResult = z.infer<typeof researchScoutResultSchema>;
export type ExaResearchScoutStructuredCandidate = z.infer<
  typeof exaResearchScoutStructuredCandidateSchema
>;

export function resolveResearchScoutProfileKind(
  profile: ResearchScoutProfile | ResearchScoutTagProfile,
): ResearchScoutProfileKind {
  return isFocusedResearchScoutProfile(profile)
    ? "focused_profile"
    : "tag_profile";
}

export function buildResearchScoutQuery(
  profile: ResearchScoutProfile | ResearchScoutTagProfile,
): string {
  return [
    ...(isFocusedResearchScoutProfile(profile)
      ? EXA_RESEARCH_FOCUSED_QUERY_PREFIX_LINES
      : EXA_RESEARCH_SCOUT_QUERY_PREFIX_LINES),
    ...EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS.map((section) =>
      `${section.label}: ${joinTags(profile[section.field])}`
    ),
    ...(isFocusedResearchScoutProfile(profile)
      ? EXA_RESEARCH_FOCUSED_QUERY_SUFFIX_LINES
      : EXA_RESEARCH_SCOUT_QUERY_SUFFIX_LINES),
  ].join("\n");
}

export function buildExaResearchScoutRequest(
  input: ResearchScoutInput,
): ExaResearchScoutRequestBody {
  const parsed = researchScoutInputSchema.parse(input);
  return buildExaResearchScoutRequestForProfile(parsed);
}

export function buildExaResearchScoutBatchLaneRequest(
  input: ResearchScoutTagInput,
): ExaResearchScoutRequestBody {
  const parsed = researchScoutTagInputSchema.parse(input);
  return buildExaResearchScoutRequestForProfile(parsed);
}

function buildExaResearchScoutRequestForProfile(input: {
  maxCandidates: number;
  profile: ResearchScoutProfile | ResearchScoutTagProfile;
  since: string;
  until: string;
}): ExaResearchScoutRequestBody {
  return buildExaResearchScoutRequestFromQuery({
    query: buildResearchScoutQuery(input.profile),
    since: input.since,
    until: input.until,
    maxCandidates: input.maxCandidates,
  });
}

export function buildExaResearchScoutRequestFromQuery(input: {
  maxCandidates: number;
  query: string;
  since: string;
  until: string;
}): ExaResearchScoutRequestBody {
  const profile = parseResearchScoutQuery(input.query);
  const startPublishedDate = normalizeCanonicalUtcTimestamp(input.since);
  const endPublishedDate = normalizeCanonicalUtcTimestamp(input.until);
  if (
    !isValidResearchScoutCandidateCount(input.maxCandidates)
    || profile === null
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
    systemPrompt: resolveResearchScoutSystemPrompt(profile),
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
    || parsed.systemPrompt !== resolveResearchScoutSystemPrompt(profile)
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

export function parseResearchScoutQuery(
  value: unknown,
): ResearchScoutProfile | ResearchScoutTagProfile | null {
  if (typeof value !== "string" || value.length > 4_096) {
    return null;
  }

  return parseFocusedResearchScoutQuery(value) ?? parseResearchScoutTagQuery(value);
}

export function isCanonicalUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40 || !isStrictIsoDateTime(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseFocusedResearchScoutQuery(value: string): ResearchScoutProfile | null {
  return parseResearchScoutProfileQuery(
    value,
    EXA_RESEARCH_FOCUSED_QUERY_PREFIX_LINES,
    EXA_RESEARCH_FOCUSED_QUERY_SUFFIX_LINES,
    "focused",
  );
}

function parseResearchScoutTagQuery(value: string): ResearchScoutTagProfile | null {
  return parseResearchScoutProfileQuery(
    value,
    EXA_RESEARCH_SCOUT_QUERY_PREFIX_LINES,
    EXA_RESEARCH_SCOUT_QUERY_SUFFIX_LINES,
  );
}

function parseResearchScoutProfileQuery(
  value: string,
  prefixLines: readonly string[],
  suffixLines: readonly string[],
  mode: "focused",
): ResearchScoutProfile | null;
function parseResearchScoutProfileQuery(
  value: string,
  prefixLines: readonly string[],
  suffixLines: readonly string[],
  mode?: undefined,
): ResearchScoutTagProfile | null;
function parseResearchScoutProfileQuery(
  value: string,
  prefixLines: readonly string[],
  suffixLines: readonly string[],
  mode?: "focused",
): ResearchScoutProfile | ResearchScoutTagProfile | null {
  const lines = value.split("\n");
  const expectedLineCount =
    prefixLines.length
    + EXA_RESEARCH_SCOUT_QUERY_PROFILE_SECTIONS.length
    + suffixLines.length;
  if (lines.length !== expectedLineCount) {
    return null;
  }

  let lineIndex = 0;
  for (const expected of prefixLines) {
    if (lines[lineIndex] !== expected) {
      return null;
    }
    lineIndex += 1;
  }

  const profile: Record<keyof ResearchScoutTagProfile, string[]> = {
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

  for (const expected of suffixLines) {
    if (lines[lineIndex] !== expected) {
      return null;
    }
    lineIndex += 1;
  }
  const parsed = mode === "focused"
    ? researchScoutProfileSchema.safeParse({ ...profile, mode })
    : researchScoutTagProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data : null;
}

function isFocusedResearchScoutProfile(
  profile: ResearchScoutProfile | ResearchScoutTagProfile,
): profile is ResearchScoutProfile {
  return "mode" in profile && profile.mode === "focused";
}

function resolveResearchScoutSystemPrompt(
  profile: ResearchScoutProfile | ResearchScoutTagProfile,
): string {
  return isFocusedResearchScoutProfile(profile)
    ? EXA_RESEARCH_FOCUSED_SYSTEM_PROMPT
    : EXA_RESEARCH_SCOUT_SYSTEM_PROMPT;
}

function parseSafeResearchScoutTags(
  rawValue: string,
  section: {
    field: ResearchScoutProfileField;
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
      && isAllowedFocusedResearchScoutConcept(section.field, tag)
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
