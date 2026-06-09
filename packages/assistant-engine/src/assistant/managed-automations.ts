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
  looksLikePrivateAssistantRoutePlaceholder,
  resolveAssistantDeliveryRouteWithCurrentRoute,
  stripPrivateAssistantRoutePlaceholders,
  type AssistantDeliveryRouteFields,
} from '@murphai/operator-config/assistant/current-delivery-route'
import {
  applyAssistantSelfDeliveryTargetDefaults,
} from '@murphai/operator-config/operator-config'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from './automation-tags.js'
import { getAssistantChannelAdapter } from './channel-adapters.js'

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

// One-shot ('at') seeds are delivery-time-sensitive: runtimes apply seeds
// lazily on background wakes, so a dormant user may first see a one-shot
// seed long after its scheduled moment. Past this window the seed is
// skipped rather than installed, so a stale announcement is never sent late.
const MURPH_MANAGED_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS = 30 * 60 * 1000

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
      'Do not overstate certainty. If data is missing, say that plainly.',
    ].join('\n'),
  },
] satisfies readonly MurphManagedAutomationSeed[]

export async function applyMurphManagedAutomations(
  input: ApplyMurphManagedAutomationsInput,
): Promise<ApplyMurphManagedAutomationsResult> {
  const seeds = input.seeds ?? MURPH_MANAGED_AUTOMATIONS
  const now = input.now ?? new Date()
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
    return normalizeMurphManagedAutomationRoute(input.defaultRoute)
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

  const route = stripPrivateAssistantRoutePlaceholders(
    resolveAssistantDeliveryRouteWithCurrentRoute(resolvedTarget, null),
  )

  return normalizeMurphManagedAutomationRoute(route)
}

function normalizeMurphManagedAutomationRoute(
  route: AssistantDeliveryRouteFields | null | undefined,
): AutomationRoute | null {
  if (!route) {
    return null
  }

  const channel = normalizeMurphManagedAutomationText(route.channel)
  if (!channel) {
    return null
  }

  const normalized: AutomationRoute = {
    channel,
    deliveryTarget: normalizeMurphManagedAutomationText(route.deliveryTarget),
    identityId: normalizeMurphManagedAutomationText(route.identityId),
    participantId: normalizeMurphManagedAutomationText(route.participantId),
    threadId: normalizeMurphManagedAutomationText(route.threadId),
  }

  return isDeliverableMurphManagedAutomationRoute(normalized) ? normalized : null
}

function isDeliverableMurphManagedAutomationRoute(route: AutomationRoute): boolean {
  if (!getAssistantChannelAdapter(route.channel)) {
    return false
  }

  if (route.channel === 'linq') {
    return Boolean(route.deliveryTarget) &&
      !looksLikePrivateAssistantRoutePlaceholder(route.deliveryTarget)
  }

  if (route.channel === 'email' && !route.identityId) {
    return false
  }

  return Boolean(route.deliveryTarget || route.participantId || route.threadId)
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

