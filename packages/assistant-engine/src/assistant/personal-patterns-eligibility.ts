import * as z from '@murphai/contracts/zod-runtime'
import { buildPersonalPatternReportRuntime, type PersonalPatternReport } from '@murphai/query'
import { normalizeKnowledgeBody } from '../knowledge/documents.js'
import { getKnowledgePage } from '../knowledge/service.js'
import { MURPH_MANAGED_AUTOMATIONS, MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID } from './managed-automations.js'

const identifier = z.string().min(1).max(240)
const resultSchema = z.object({
  factorId: identifier,
  outcomeId: identifier,
  comparisonBasis: z.enum(['confirmed_absence', 'unobserved_baseline']),
  lagDays: z.union([z.literal(0), z.literal(1)]),
  lastSeenGrade: z.enum(['A', 'B', 'C', 'D', 'E']),
  firstSharedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  muted: z.boolean(),
}).strict()

const ledgerSchema = z.object({
  version: z.literal(1),
  initialDigestSent: z.boolean(),
  reviewedFactorIds: z.array(identifier).max(1_000),
  mutedFactorIds: z.array(identifier).max(1_000),
  results: z.array(resultSchema).max(10_000),
}).strict()

export type PersonalPatternNotificationLedger = z.infer<typeof ledgerSchema>

function resultIdentity(result: {
  factorId: string
  outcomeId: string
  comparisonBasis: string
  lagDays: number
}): string {
  return JSON.stringify([result.factorId, result.outcomeId, result.comparisonBasis, result.lagDays])
}

export function parsePersonalPatternNotificationLedger(
  body: string,
): PersonalPatternNotificationLedger | null {
  if (body.length > 512_000) return null
  try {
    const parsed = ledgerSchema.safeParse(JSON.parse(normalizeKnowledgeBody(body)))
    if (!parsed.success) return null
    const identities = parsed.data.results.map(resultIdentity)
    return new Set(identities).size === identities.length ? parsed.data : null
  } catch {
    return null
  }
}

export function personalPatternReportAlreadyReviewed(
  report: PersonalPatternReport,
  ledger: PersonalPatternNotificationLedger,
): boolean {
  if (!ledger.initialDigestSent) return false
  const factors = new Set(ledger.reviewedFactorIds)
  if (report.factors.some((factor) => !factors.has(factor.id))) return false
  const outcomes = new Map(report.outcomes.map((outcome) => [outcome.id, outcome.lagDays ?? report.lagDays]))
  const results = new Map(ledger.results.map((result) => [resultIdentity(result), result.lastSeenGrade]))
  return report.cells.every((cell) => {
    if (!cell.grade) return true
    const lagDays = outcomes.get(cell.outcomeId)
    if (!cell.comparisonBasis || lagDays === undefined) return false
    return results.get(resultIdentity({ ...cell, comparisonBasis: cell.comparisonBasis, lagDays })) === cell.grade
  })
}

// This is evidence for skipping model work, never another notification owner.
// Old or uncertain history keeps the ordinary model path and its saved preferences.
export async function canSkipManagedPersonalPatterns(input: {
  automationId: string
  instructions: string
  nowIso: string
  signal?: AbortSignal | null
  timeZone: string | null
  vaultRoot: string
}): Promise<boolean> {
  if (input.automationId !== MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID) return false
  const managed = MURPH_MANAGED_AUTOMATIONS.find((entry) => entry.automationId === input.automationId)
  if (input.instructions !== managed?.instructions) return false
  input.signal?.throwIfAborted()
  try {
    const knowledge = await getKnowledgePage({
      slug: 'personal-pattern-notifications',
      vault: input.vaultRoot,
    })
    input.signal?.throwIfAborted()
    if (knowledge.degradation) return false
    const ledger = parsePersonalPatternNotificationLedger(knowledge.page.body)
    if (!ledger?.initialDigestSent) return false
    const asOf = new Intl.DateTimeFormat('en-CA', {
      timeZone: input.timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(input.nowIso))
    const report = await buildPersonalPatternReportRuntime(input.vaultRoot, { asOf })
    input.signal?.throwIfAborted()
    return personalPatternReportAlreadyReviewed(report, ledger)
  } catch {
    input.signal?.throwIfAborted()
    return false
  }
}

