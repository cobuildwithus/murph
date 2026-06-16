import {
  showAutomation,
  upsertAutomation,
  type AutomationRecord,
} from '@murphai/core'
import type {
  AutomationContinuityPolicy,
  AutomationRoute,
  AutomationSchedule,
} from '@murphai/contracts'
import {
  resolveAssistantDeliveryRouteWithCurrentRoute,
} from '@murphai/operator-config/assistant/current-delivery-route'
import {
  applyAssistantSelfDeliveryTargetDefaults,
} from '@murphai/operator-config/operator-config'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from './automation-tags.js'
import { resolveDeliverableAutomationRoute } from './cron/targets.js'
import { buildExperimentFinalResultsSeeds } from './experiment-support-automations.js'

export type MurphManagedAutomationSchedule = Exclude<
  AutomationSchedule,
  { kind: 'deviceActivity' }
>

export interface MurphManagedAutomationSeed {
  automationId: string
  continuityPolicy?: AutomationContinuityPolicy
  instructions: string
  schedule: MurphManagedAutomationSchedule
  slug: string
  summary?: string
  tags?: readonly string[]
  title: string
}

export interface ApplyMurphManagedAutomationsInput {
  defaultRoute?: AutomationRoute | null
  now?: Date
  operatorHomeRoot?: string | null
  seeds?: readonly MurphManagedAutomationSeed[]
  vaultRoot: string
}

export interface ApplyMurphManagedAutomationsResult {
  created: number
  skipped: number
  updated: number
}

export const MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID =
  'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FY'
export const MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID =
  'automation_X3GPAWV2CCHNCYHAAJ4CE2M144'

// One-shot ('at') seeds are delivery-time-sensitive: runtimes apply seeds
// lazily on background wakes, so a dormant user may first see a one-shot
// seed long after its scheduled moment. Past this window the seed is
// skipped rather than installed, so a stale announcement is never sent late.
// Keep aligned with ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS in
// cron/execution.ts: both express the same product window for how late a
// one-shot notification may still go out.
const MURPH_MANAGED_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS = 60 * 60 * 1000

const MURPH_MANAGED_AUTOMATION_BASE_TAGS = [
  'assistant',
  'scheduled',
  'murph-managed',
] as const

export const MURPH_MANAGED_AUTOMATIONS = [
  {
    automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    slug: 'weekly-health-digest',
    title: 'Weekly health digest',
    summary: 'A weekly summary of your recent health data.',
    schedule: {
      kind: 'cron',
      expression: '0 9 * * 1',
    },
    continuityPolicy: 'fresh',
    tags: [
      'murph-managed:weekly-health-digest',
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    ],
    instructions: [
      'Each Monday morning, produce one concise weekly health digest for the configured automation route.',
      '',
      'Focus on:',
      '- sleep',
      '- recovery',
      '- workouts / activity',
      '- notable changes',
      '- one suggested next step',
      '',
      'If there is an active experiment with enough data to show movement, attach its progress image with `vault-cli experiment progress-card <slug> --format json` and fold its progress into the digest.',
      '',
      'Do not overstate certainty. If data is missing, say that plainly.',
    ].join('\n'),
  },
  {
    automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    slug: 'weekly-health-insight',
    title: 'Weekly health insight',
    summary: 'A weekly scout for one non-obvious personal health/body finding.',
    schedule: {
      kind: 'cron',
      expression: '30 13 * * 3',
    },
    continuityPolicy: 'fresh',
    tags: [
      'murph-managed:weekly-health-insight',
    ],
    instructions: [
      "Each Wednesday after lunch, look for one genuinely interesting, non-obvious finding about the user's health/body that they may not already know.",
      '',
      'Before choosing a finding:',
      '- Read the derived knowledge index and the `weekly-health-insights` page if it exists.',
      '- Search the knowledge wiki for related prior findings.',
      '- Inspect only enough recent and historical vault data to test candidate patterns.',
      '- Treat `knowledge upsert --body` as a full-page replacement: if `weekly-health-insights` exists, read it before writing and build a complete replacement body that preserves all existing entries unchanged.',
      '',
      "A finding clears the bar only when it is specific to this user's vault, has concrete evidence, is not a repeat of an existing wiki finding, and can be said with uncertainty.",
      '',
      'If nothing clears the bar, suppress the scheduled message and do not write a wiki page.',
      '',
      'If something clears the bar:',
      '- Save it to the derived knowledge wiki by creating/updating the `weekly-health-insights` page with a dated entry. The upsert body must be the complete page body: all existing entries unchanged plus the new or current-date entry, so future runs can deduplicate.',
      '- If the existing `weekly-health-insights` page cannot be read safely, do not overwrite it; skip the write and scheduled message for this run.',
      '- If `weekly-health-insights` already has an entry for this scheduled run or current local date, treat that entry as this run\'s finding: do not append a duplicate, and still send the concise note from that entry. Only older entries should disqualify a candidate as a duplicate.',
      '- Use the knowledge write surface, for example: `vault-cli knowledge upsert --slug weekly-health-insights --title "Weekly health insights" --body <markdown> --source-path <canonical-vault-path>`. Cite only canonical vault source paths, never `derived/**` or `.runtime/**` paths.',
      '- Then send one concise note: what you noticed, the evidence, why it may matter, and a light optional follow-up.',
      '',
      'Do not give generic health tips, medical diagnosis, causal claims without proof, or alarmist language.',
    ].join('\n'),
  },
] satisfies readonly MurphManagedAutomationSeed[]

export async function applyMurphManagedAutomations(
  input: ApplyMurphManagedAutomationsInput,
): Promise<ApplyMurphManagedAutomationsResult> {
  const now = input.now ?? new Date()
  const seeds =
    input.seeds ??
    [
      ...MURPH_MANAGED_AUTOMATIONS,
      ...(await buildExperimentFinalResultsSeeds({ vaultRoot: input.vaultRoot, now })),
    ]
  let createRoute: AutomationRoute | null | undefined
  const resolveCreateRoute = async (): Promise<AutomationRoute | null> => {
    if (createRoute !== undefined) {
      return createRoute
    }
    createRoute = await resolveMurphManagedAutomationCreateRoute(input)
    return createRoute
  }
  const result: ApplyMurphManagedAutomationsResult = {
    created: 0,
    skipped: 0,
    updated: 0,
  }

  for (const seed of seeds) {
    const existing = await showAutomation({
      automationId: seed.automationId,
      vaultRoot: input.vaultRoot,
    })

    if (!existing) {
      if (isStaleMurphManagedOneShotSeed(seed, now)) {
        result.skipped += 1
        continue
      }

      const existingSlug = await showAutomation({
        slug: seed.slug,
        vaultRoot: input.vaultRoot,
      })
      if (existingSlug) {
        result.skipped += 1
        continue
      }

      const route = await resolveCreateRoute()
      if (!route) {
        result.skipped += 1
        continue
      }

      const summary = normalizeMurphManagedAutomationSummary(seed)
      await upsertAutomation({
        automationId: seed.automationId,
        continuityPolicy: resolveMurphManagedAutomationContinuity(seed),
        instructions: seed.instructions,
        now,
        route,
        schedule: seed.schedule,
        slug: seed.slug,
        status: 'active',
        ...(summary === null
          ? {}
          : { summary }),
        tags: buildMurphManagedAutomationTags(seed),
        title: seed.title,
        vaultRoot: input.vaultRoot,
      })
      result.created += 1
      continue
    }

    if (existing.status !== 'active') {
      result.skipped += 1
      continue
    }

    if (isStaleMurphManagedOneShotSeed(seed, now)) {
      result.skipped += 1
      continue
    }

    if (!murphManagedAutomationSeedChanged(existing, seed)) {
      result.skipped += 1
      continue
    }

    const summary = normalizeMurphManagedAutomationSummary(seed)
    await upsertAutomation({
      automationId: existing.automationId,
      continuityPolicy: resolveMurphManagedAutomationContinuity(seed),
      instructions: seed.instructions,
      now,
      // Routes are user/runtime-owned: seeds never carry one, so updates
      // preserve the existing route without re-checking deliverability.
      // Only the create path validates routes, because that is the only
      // point where this module chooses one.
      route: existing.route,
      schedule: seed.schedule,
      slug: existing.slug,
      status: existing.status,
      ...(summary === null
        ? {}
        : { summary }),
      tags: buildMurphManagedAutomationTags(seed),
      title: seed.title,
      vaultRoot: input.vaultRoot,
    })
    result.updated += 1
  }

  return result
}

async function resolveMurphManagedAutomationCreateRoute(
  input: ApplyMurphManagedAutomationsInput,
): Promise<AutomationRoute | null> {
  if (input.defaultRoute !== undefined) {
    return input.defaultRoute
      ? resolveDeliverableAutomationRoute(input.defaultRoute)
      : null
  }

  const resolvedTarget = await applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    {
      allowSingleSavedTargetFallback: true,
    },
    input.operatorHomeRoot ?? undefined,
  )

  return resolveDeliverableAutomationRoute(
    resolveAssistantDeliveryRouteWithCurrentRoute(resolvedTarget, null),
  )
}

function murphManagedAutomationSeedChanged(
  existing: AutomationRecord,
  seed: MurphManagedAutomationSeed,
): boolean {
  // A seed without a summary leaves the stored summary unmanaged. This must
  // match upsertAutomation's omitted-field semantics (an omitted summary
  // preserves the existing one); comparing against null here would report
  // "changed" on every run and rewrite the record forever.
  const summary = normalizeMurphManagedAutomationSummary(seed)
  return existing.title !== seed.title ||
    (summary !== null && existing.summary !== summary) ||
    existing.continuityPolicy !== resolveMurphManagedAutomationContinuity(seed) ||
    existing.instructions !== seed.instructions ||
    !murphManagedAutomationValuesEqual(existing.schedule, seed.schedule) ||
    !murphManagedAutomationValuesEqual(
      existing.tags,
      buildMurphManagedAutomationTags(seed),
    )
}

function buildMurphManagedAutomationTags(
  seed: MurphManagedAutomationSeed,
): string[] {
  return [
    ...new Set([
      ...MURPH_MANAGED_AUTOMATION_BASE_TAGS,
      ...(seed.tags ?? []),
    ].flatMap((tag) => normalizeMurphManagedAutomationText(tag) ?? [])),
  ]
}

function resolveMurphManagedAutomationContinuity(
  seed: MurphManagedAutomationSeed,
): AutomationContinuityPolicy {
  return seed.continuityPolicy ?? 'preserve'
}

function normalizeMurphManagedAutomationSummary(
  seed: MurphManagedAutomationSeed,
): string | null {
  return normalizeMurphManagedAutomationText(seed.summary)
}

function normalizeMurphManagedAutomationText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function murphManagedAutomationValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isStaleMurphManagedOneShotSeed(
  seed: MurphManagedAutomationSeed,
  now: Date,
): boolean {
  if (seed.schedule.kind !== 'at') {
    return false
  }

  const scheduledAtMs = Date.parse(seed.schedule.at)
  const nowMs = now.getTime()
  if (!Number.isFinite(scheduledAtMs) || !Number.isFinite(nowMs)) {
    return true
  }

  return scheduledAtMs + MURPH_MANAGED_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS <= nowMs
}
