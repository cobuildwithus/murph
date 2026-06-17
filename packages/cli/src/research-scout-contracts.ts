import { z } from 'zod'

export const EXA_RESEARCH_SCOUT_PROVIDER_NAME = 'exa'
export const EXA_RESEARCH_SCOUT_ENDPOINT = 'search'
export const EXA_RESEARCH_SCOUT_MODE = 'deep-reasoning'
export const EXA_RESEARCH_SCOUT_CATEGORY = 'research paper'
export const DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS = 60_000
export const MAX_RESEARCH_SCOUT_CANDIDATES = 12

const unsafeResearchScoutTagPatterns = [
  /[\r\n\t]/u,
  /[^\s@]+@[^\s@]+\.[^\s@]+/u,
  /\b\+?\d[\d\s().-]{7,}\d\b/u,
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/u,
  /\b(?:dob|date of birth|birthdate|born on)\b/iu,
  /\b\d{2,3}\/\d{2,3}\b/u,
  /\b\d+(?:\.\d+)?\s*(?:mg\/dL|mg\/dl|mmol\/L|mmol\/l|ng\/mL|ng\/ml|pg\/mL|pg\/ml|mcg\/mL|mcg\/ml|IU\/L|iu\/l|U\/L|u\/l|bpm|mmHg|mmhg|kg|lbs?|cm|in|%)\b/u,
  /\b(?:a1c|hba1c|ldl|hdl|apo\s?b|hs-?crp|crp|glucose|triglycerides?|tsh|ferritin|vitamin d|25-?oh|testosterone|cortisol|alt|ast|egfr|gfr|creatinine|hemoglobin|platelets?)\b[^a-z0-9]{0,12}\d+(?:\.\d+)?\b/iu,
  /\b(?:i|i'm|ive|i've|me|my|mine)\b/iu,
] as const

export function isSafeResearchScoutProfileTag(value: string): boolean {
  const tag = value.trim()
  if (!tag) return false
  if (tag.split(/\s+/u).length > 10) return false
  return !unsafeResearchScoutTagPatterns.some((pattern) => pattern.test(tag))
}

const unsafeResearchScoutTagMessage =
  'Research scout profile tags must be non-identifying categories, not raw values, dates, contacts, or notes.'
const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(isSafeResearchScoutProfileTag, {
    message: unsafeResearchScoutTagMessage,
  })
const longerTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isSafeResearchScoutProfileTag, {
    message: unsafeResearchScoutTagMessage,
  })

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
  .strict()

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
  .strict()

export const researchScoutStudyTypeSchema = z.enum([
  'guideline',
  'meta_analysis',
  'systematic_review',
  'randomized_trial',
  'prospective_cohort',
  'observational',
  'case_study',
  'preclinical',
  'preprint',
  'news_or_commentary',
])

export const researchScoutEvidenceStrengthSchema = z.enum([
  'strong',
  'moderate',
  'early',
  'weak',
])

export const researchScoutHypeRiskSchema = z.enum(['low', 'medium', 'high'])

export const researchCandidateSchema = z
  .object({
    title: z.string().min(1).max(300),
    sourceUrl: z.string().url(),
    sourceName: z.string().max(120).optional(),
    publishedAt: z.string().max(80).optional(),
    doi: z.string().max(120).optional(),
    pmid: z.string().max(80).optional(),
    studyType: researchScoutStudyTypeSchema,
    topics: z.array(tagSchema).max(16),
    matchedProfileTags: z.array(longerTagSchema).max(16),
    keyFinding: z.string().min(1).max(700),
    whyItMayMatter: z.string().min(1).max(700),
    evidenceStrength: researchScoutEvidenceStrengthSchema,
    actionOrQuestion: z.string().min(1).max(500),
    doNotOverinterpret: z.string().min(1).max(500),
    clinicianDiscussionOnly: z.boolean(),
    hypeRisk: researchScoutHypeRiskSchema,
  })
  .strict()

export const researchScoutResultSchema = z
  .object({
    provider: z
      .object({
        name: z.literal(EXA_RESEARCH_SCOUT_PROVIDER_NAME),
        endpoint: z.literal(EXA_RESEARCH_SCOUT_ENDPOINT),
        mode: z.literal(EXA_RESEARCH_SCOUT_MODE),
      })
      .strict(),
    candidates: z.array(researchCandidateSchema).max(MAX_RESEARCH_SCOUT_CANDIDATES),
    privacy: z
      .object({
        tokenSource: z.literal('env'),
        persistedByTool: z.literal(false),
        sentProfileKind: z.literal('tag_profile'),
        rawVaultValuesSent: z.literal(false),
      })
      .strict(),
    warnings: z.array(z.string().max(240)).max(8),
  })
  .strict()

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
  .strict()

export const exaResearchScoutStructuredOutputSchema = z
  .object({
    candidates: z
      .array(exaResearchScoutStructuredCandidateSchema)
      .max(MAX_RESEARCH_SCOUT_CANDIDATES),
  })
  .strict()

export type ResearchCandidate = z.infer<typeof researchCandidateSchema>
export type ResearchScoutInput = z.infer<typeof researchScoutInputSchema>
export type ResearchScoutProfile = z.infer<typeof researchScoutProfileSchema>
export type ResearchScoutResult = z.infer<typeof researchScoutResultSchema>
export type ExaResearchScoutStructuredCandidate = z.infer<
  typeof exaResearchScoutStructuredCandidateSchema
>
