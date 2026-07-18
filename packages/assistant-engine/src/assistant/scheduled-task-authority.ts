import { isDeepStrictEqual } from 'node:util'

import { showAutomation } from '@murphai/query'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  buildHostedVaultShareProjectionScopeKey,
} from '@murphai/hosted-execution/vault-share'

import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
  MURPH_WEEKLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
  matchesMurphManagedAutomationSeedSchedule,
  type MurphManagedAutomationSeed,
} from './managed-automations.js'
import { getKnowledgePage } from '../knowledge/service.js'

export type AssistantScheduledExperimentLifecyclePhase =
  | 'progress'
  | 'final_results'

export const ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG =
  'group-health-newsletter'

/**
 * Ephemeral authority selected by the cron parent from canonical automation
 * identity. It is never model-authored or persisted as assistant state.
 */
export type AssistantScheduledTaskAuthority =
  | { readonly kind: 'none' }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'generic_notification'
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'group_newsletter'
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'managed_knowledge_ledger'
      readonly slug: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'research_ledger'
      readonly slug: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'product_notes'
      readonly slug: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'group_challenge'
      readonly projectionScopeKey: string
      readonly slug: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'memory_maintenance'
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'experiment_lifecycle'
      readonly phase: AssistantScheduledExperimentLifecyclePhase
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'onboarding_followup'
    }

export type ResolvedAssistantScheduledTaskAuthority =
  | { readonly kind: 'none' }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'generic_notification'
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'group_newsletter'
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'managed_knowledge_ledger'
      readonly slug: string
      readonly title: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'research_ledger'
      readonly slug: string
      readonly title: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'product_notes'
      readonly slug: string
      readonly title: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'group_challenge'
      readonly projectionScopeKey: string
      readonly slug: string
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'memory_maintenance'
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'experiment_lifecycle'
      readonly phase: AssistantScheduledExperimentLifecyclePhase
    }
  | {
      readonly automationId: string
      readonly expectedUpdatedAt: string
      readonly kind: 'onboarding_followup'
    }

const NONE_SCHEDULED_TASK_AUTHORITY = { kind: 'none' } as const

type FixedManagedScheduledTaskDefinition =
  | {
      readonly kind:
        | 'managed_knowledge_ledger'
        | 'product_notes'
        | 'research_ledger'
      readonly slug: string
      /** Null means the managed automation seed already owns the right title. */
      readonly title: string | null
    }
  | {
      readonly kind: 'memory_maintenance'
      readonly slug: null
      readonly title: null
    }

const FIXED_MANAGED_SCHEDULED_TASKS = {
  [MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID]: {
    kind: 'managed_knowledge_ledger',
    slug: 'weekly-health-insights',
    title: 'Weekly health insights',
  },
  [MURPH_WEEKLY_IMPROVEMENT_COACH_AUTOMATION_ID]: {
    kind: 'managed_knowledge_ledger',
    slug: 'improvement-opportunities',
    title: 'Improvement opportunities',
  },
  [MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID]: {
    kind: 'research_ledger',
    slug: 'weekly-health-research-scout',
    title: null,
  },
  [MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID]: {
    kind: 'product_notes',
    slug: 'murph-product-notes',
    title: null,
  },
  [MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID]: {
    kind: 'memory_maintenance',
    slug: null,
    title: null,
  },
} as const satisfies Record<string, FixedManagedScheduledTaskDefinition>

export interface AssistantScheduledAutomationSource {
  activeUntil: string | null
  assistantTargetOverride: unknown
  automationId: string
  continuityPolicy: string
  instructions: string
  schedule: unknown
  scheduledTask: unknown
  slug: string
  status: string
  summary: string | null
  supportKind: unknown
  tags: readonly string[]
  title: string
  updatedAt: string
}

/**
 * Admit task authority from the canonical source definition, never from a
 * public automation id or mutable tag alone. Fixed managed tasks must match
 * the same catalog fields their reconciler owns. A group challenge instead
 * relies on its create-only typed scheduledTask binding.
 */
export function resolveAssistantScheduledTaskAuthorityFromSource(
  source: AssistantScheduledAutomationSource,
): AssistantScheduledTaskAuthority {
  const fixedTask = resolveFixedManagedScheduledTaskDefinition(
    source.automationId,
  )
  if (fixedTask) {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (candidate) => candidate.automationId === source.automationId,
    )
    if (!seed || !isExactFixedManagedScheduledTaskSource(source, seed)) {
      return NONE_SCHEDULED_TASK_AUTHORITY
    }

    const revision = {
      automationId: source.automationId,
      expectedUpdatedAt: source.updatedAt,
    }
    switch (fixedTask.kind) {
      case 'managed_knowledge_ledger':
        return { ...revision, kind: fixedTask.kind, slug: fixedTask.slug }
      case 'research_ledger':
        return { ...revision, kind: fixedTask.kind, slug: fixedTask.slug }
      case 'product_notes':
        return { ...revision, kind: fixedTask.kind, slug: fixedTask.slug }
      case 'memory_maintenance':
        return { ...revision, kind: fixedTask.kind }
    }
  }

  const scheduledTask = source.scheduledTask
  if (isExactGroupNewsletterScheduledTaskSource(source)) {
    return {
      automationId: source.automationId,
      expectedUpdatedAt: source.updatedAt,
      kind: 'group_newsletter',
    }
  }
  if (source.slug === ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG) {
    return NONE_SCHEDULED_TASK_AUTHORITY
  }

  if (scheduledTask !== null && scheduledTask !== undefined) {
    if (
      source.status === 'active' &&
      typeof source.activeUntil === 'string' &&
      Number.isFinite(Date.parse(source.activeUntil)) &&
      isTimeDrivenScheduledTaskSchedule(source.schedule) &&
      typeof scheduledTask === 'object' &&
      Reflect.get(scheduledTask, 'kind') === 'group_challenge' &&
      typeof Reflect.get(scheduledTask, 'knowledgeSlug') === 'string' &&
      typeof Reflect.get(scheduledTask, 'projectionScopeKey') === 'string'
    ) {
      const projectionScopeKey = Reflect.get(
        scheduledTask,
        'projectionScopeKey',
      ) as string
      if (!isGroupChallengeProjectionScopeKey(projectionScopeKey)) {
        return NONE_SCHEDULED_TASK_AUTHORITY
      }
      return {
        automationId: source.automationId,
        expectedUpdatedAt: source.updatedAt,
        kind: 'group_challenge',
        projectionScopeKey,
        slug: Reflect.get(scheduledTask, 'knowledgeSlug') as string,
      }
    }
    return NONE_SCHEDULED_TASK_AUTHORITY
  }

  if (
    source.status === 'active' &&
    source.scheduledTask == null &&
    source.automationId.trim().length > 0 &&
    Number.isFinite(Date.parse(source.updatedAt))
  ) {
    return {
      automationId: source.automationId,
      expectedUpdatedAt: source.updatedAt,
      kind: 'generic_notification',
    }
  }

  return NONE_SCHEDULED_TASK_AUTHORITY
}

function isTimeDrivenScheduledTaskSchedule(
  schedule: unknown,
): boolean {
  if (!schedule || typeof schedule !== 'object') {
    return false
  }
  const kind = Reflect.get(schedule, 'kind')
  return kind === 'at' ||
    kind === 'every' ||
    kind === 'cron' ||
    kind === 'dailyLocal'
}

export function resolveAssistantScheduledTaskAuthority(
  authority: AssistantScheduledTaskAuthority | null | undefined,
): ResolvedAssistantScheduledTaskAuthority {
  if (!authority || authority.kind === 'none') {
    return NONE_SCHEDULED_TASK_AUTHORITY
  }

  if (!scheduledSourceRevisionIsValid(authority)) {
    return NONE_SCHEDULED_TASK_AUTHORITY
  }

  switch (authority.kind) {
    case 'generic_notification':
    case 'group_newsletter':
      return authority
    case 'managed_knowledge_ledger':
    case 'research_ledger':
    case 'product_notes': {
      const fixedTask = resolveFixedManagedScheduledTaskDefinition(
        authority.automationId,
      )
      const seed = MURPH_MANAGED_AUTOMATIONS.find(
        (candidate) => candidate.automationId === authority.automationId,
      )
      return fixedTask?.kind === authority.kind &&
          fixedTask.slug === authority.slug &&
          seed
        ? {
            ...authority,
            title: fixedTask.title ?? seed.title,
          }
        : NONE_SCHEDULED_TASK_AUTHORITY
    }
    case 'group_challenge':
      return authority.automationId.trim().length > 0 &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(authority.slug) &&
          isGroupChallengeProjectionScopeKey(authority.projectionScopeKey)
        ? authority
        : NONE_SCHEDULED_TASK_AUTHORITY
    case 'memory_maintenance':
      return resolveFixedManagedScheduledTaskDefinition(authority.automationId)
          ?.kind === 'memory_maintenance'
        ? authority
        : NONE_SCHEDULED_TASK_AUTHORITY
    case 'experiment_lifecycle':
      return /^automation_[0-9A-HJKMNP-TV-Z]{26}$/u.test(authority.automationId)
        ? authority
        : NONE_SCHEDULED_TASK_AUTHORITY
    case 'onboarding_followup':
      return authority.automationId.trim().length > 0 &&
          Number.isFinite(Date.parse(authority.expectedUpdatedAt))
        ? authority
        : NONE_SCHEDULED_TASK_AUTHORITY
  }
}

/** Re-read the current source immediately before an unattended effect. */
export async function assertAssistantScheduledTaskSourceCurrent(input: {
  authority: AssistantScheduledTaskAuthority | null
  vault: string
}): Promise<ResolvedAssistantScheduledTaskAuthority> {
  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  if (authority.kind === 'none') {
    throw new VaultCliError(
      'scheduled_task_unauthorized',
      'The scheduled task has no effect authority.',
    )
  }

  const current = await showAutomation(input.vault, authority.automationId)
  if (
    !current ||
    current.status !== 'active' ||
    (
      current.activeUntil !== null &&
      Date.parse(current.activeUntil) <= Date.now()
    ) ||
    current.updatedAt !== authority.expectedUpdatedAt
  ) {
    throw new VaultCliError(
      'scheduled_task_source_changed',
      'The scheduled automation changed before the effect was attempted.',
    )
  }

  if (authority.kind === 'group_challenge') {
    if (!isDeepStrictEqual(
      resolveAssistantScheduledTaskAuthorityFromSource(current),
      authority,
    )) {
      throw new VaultCliError(
        'scheduled_task_source_changed',
        'The scheduled automation changed before the effect was attempted.',
      )
    }

    let page: Awaited<ReturnType<typeof getKnowledgePage>>['page']
    try {
      page = (await getKnowledgePage({
        slug: authority.slug,
        vault: input.vault,
      })).page
    } catch {
      throw new VaultCliError(
        'scheduled_challenge_not_active',
        'The bound knowledge page is not an active challenge.',
      )
    }
    if (page.pageType !== 'challenge' || page.status !== 'active') {
      throw new VaultCliError(
        'scheduled_challenge_not_active',
        'The bound knowledge page is not an active challenge.',
      )
    }
  }
  return authority
}

export type AssistantScheduledTaskSourceCurrentAssertion = (
  authority: AssistantScheduledTaskAuthority | null,
) => Promise<ResolvedAssistantScheduledTaskAuthority>

function isExactFixedManagedScheduledTaskSource(
  source: AssistantScheduledAutomationSource,
  seed: MurphManagedAutomationSeed,
): boolean {
  const expectedTags = [
    'assistant',
    'scheduled',
    'murph-managed',
    ...(seed.tags ?? []),
  ].filter((tag, index, tags) => tags.indexOf(tag) === index)
  return source.status === 'active' &&
    source.automationId === seed.automationId &&
    source.activeUntil === (seed.activeUntil ?? null) &&
    source.slug === seed.slug &&
    source.title === seed.title &&
    source.summary === (seed.summary ?? null) &&
    source.instructions === seed.instructions &&
    source.continuityPolicy === (seed.continuityPolicy ?? 'preserve') &&
    isDeepStrictEqual(
      source.assistantTargetOverride,
      seed.assistantTargetOverride ?? null,
    ) &&
    matchesMurphManagedAutomationSeedSchedule(source.schedule, seed) &&
    source.scheduledTask == null &&
    source.supportKind == null &&
    isDeepStrictEqual(source.tags, expectedTags) &&
    Number.isFinite(Date.parse(source.updatedAt))
}

function resolveFixedManagedScheduledTaskDefinition(
  automationId: string,
): FixedManagedScheduledTaskDefinition | null {
  return FIXED_MANAGED_SCHEDULED_TASKS[
    automationId as keyof typeof FIXED_MANAGED_SCHEDULED_TASKS
  ] ?? null
}

function scheduledSourceRevisionIsValid(
  authority: Exclude<AssistantScheduledTaskAuthority, { kind: 'none' }>,
): boolean {
  return authority.automationId.trim().length > 0 &&
    Number.isFinite(Date.parse(authority.expectedUpdatedAt))
}

function isExactGroupNewsletterScheduledTaskSource(
  source: AssistantScheduledAutomationSource,
): boolean {
  return source.status === 'active' &&
    source.slug === ASSISTANT_GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG &&
    source.continuityPolicy === 'fresh' &&
    typeof source.schedule === 'object' &&
    source.schedule !== null &&
    Reflect.get(source.schedule, 'kind') === 'cron' &&
    typeof Reflect.get(source.schedule, 'expression') === 'string' &&
    (Reflect.get(source.schedule, 'expression') as string).trim().length > 0 &&
    source.scheduledTask == null &&
    source.supportKind == null &&
    source.automationId.trim().length > 0 &&
    Number.isFinite(Date.parse(source.updatedAt))
}

function isGroupChallengeProjectionScopeKey(value: string): boolean {
  return HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.some(
    (scope) => scope.projectionKind !== 'group-email.v0' &&
      buildHostedVaultShareProjectionScopeKey(scope) === value,
  )
}
