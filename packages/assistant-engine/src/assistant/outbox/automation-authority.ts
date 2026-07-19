import { isDeepStrictEqual } from 'node:util'

import {
  archiveAutomationIfActiveUntilElapsed,
  isVaultError,
} from '@murphai/core'
import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'

import {
  runExperimentLifecycleDeliveryAuthorityPrecondition,
} from '../experiment-support-automations.js'
import {
  assistantAutomationHasAmbiguousLinqAudience,
  assertAssistantScheduledTaskSourceCurrent,
} from '../scheduled-task-authority.js'
import {
  listCanonicalAssistantCronRecords,
  resolveCanonicalAssistantCronJobId,
  type CanonicalAutomationAssistantCronJobRecord,
} from '../cron/canonical-jobs.js'
import {
  readAssistantCronCanonicalRuntimeStore,
} from '../cron/runtime-state.js'
import {
  assistantCronTargetAudienceEquals,
  resolveAssistantCronTargetBindingDelivery,
} from '../cron/targets.js'
import { resolveAssistantStatePaths } from '../store/paths.js'

export async function resolveAssistantOutboxAutomationAuthorityError(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<Error | null> {
  const authority = input.intent.automationAuthority
  if (!authority) {
    if (legacyNewsletterIntentRequiresAutomationAuthority(input.intent)) {
      return createAssistantOutboxAutomationAuthorityStaleError()
    }

    if (await authoritylessLinkedIntentRequiresAutomationAuthority(input)) {
      return createAssistantOutboxAutomationAuthorityStaleError()
    }

    return null
  }

  const current = await readAssistantOutboxAuthorizedAutomation({
    authority,
    now: new Date(),
    vault: input.vault,
  })
  if (!current) {
    return createAssistantOutboxAutomationAuthorityStaleError()
  }
  if (assistantAutomationHasAmbiguousLinqAudience(current.record)) {
    return createAssistantOutboxAutomationAuthorityStaleError()
  }

  const lifecycleAuthority =
    await runExperimentLifecycleDeliveryAuthorityPrecondition({
      automationId: current.record.automationId,
      now: new Date(),
      tags: current.record.tags,
      vault: input.vault,
    })
  if (lifecycleAuthority.kind === 'skip') {
    return createAssistantOutboxAutomationAuthorityStaleError()
  }

  const finalCurrent = await readAssistantOutboxAuthorizedAutomation({
    authority,
    now: new Date(),
    vault: input.vault,
  })
  if (!finalCurrent) {
    return createAssistantOutboxAutomationAuthorityStaleError()
  }

  const dispatch = input.intent.groupChallengeDispatch
  if (!dispatch) {
    return null
  }

  try {
    await assertAssistantScheduledTaskSourceCurrent({
      authority: {
        automationId: authority.automationId,
        expectedUpdatedAt: authority.expectedUpdatedAt,
        kind: 'group_challenge',
        projectionScopeKey: dispatch.scheduledTask.projectionScopeKey,
        slug: dispatch.scheduledTask.knowledgeSlug,
      },
      vault: input.vault,
    })
    return null
  } catch (error) {
    return error instanceof Error
      ? error
      : createAssistantOutboxAutomationAuthorityStaleError()
  }
}

async function authoritylessLinkedIntentRequiresAutomationAuthority(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<boolean> {
  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(
    resolveAssistantStatePaths(input.vault),
    { reclaimStaleRunningClaims: false },
  )
  const pendingOwners = runtimeStore.jobs.filter(
    (record) =>
      record.state.pendingDeliveryIntentId === input.intent.intentId,
  )
  if (pendingOwners.length === 0) {
    return false
  }
  if (pendingOwners.length !== 1) {
    return true
  }

  const [pendingOwner] = pendingOwners
  const canonicalSources = (await listCanonicalAssistantCronRecords(
    input.vault,
    ['active', 'paused'],
  )).filter(
    (source) =>
      resolveCanonicalAssistantCronJobId(source) === pendingOwner?.jobId,
  )
  if (canonicalSources.length !== 1) {
    return true
  }

  const [source] = canonicalSources
  if (
    !source ||
    source.kind !== 'automation' ||
    !assistantOutboxIntentMatchesCanonicalAutomationAudience(
      input.intent,
      source,
    ) ||
    assistantAutomationHasAmbiguousLinqAudience(source)
  ) {
    return true
  }

  return (
    source.route.channel === 'linq' &&
    source.route.threadIsDirect !== true
  ) || (
    input.intent.channel === 'linq' &&
    input.intent.threadIsDirect !== true
  )
}

function assistantOutboxIntentMatchesCanonicalAutomationAudience(
  intent: AssistantOutboxIntent,
  source: CanonicalAutomationAssistantCronJobRecord,
): boolean {
  if (intent.channel === null) {
    return false
  }

  const intentAudience = {
    channel: intent.channel,
    deliverySource: intent.deliverySource,
    deliveryTarget: intent.explicitTarget,
    identityId: intent.identityId,
    participantId: intent.actorId,
    threadId: intent.threadId,
    threadIsDirect: intent.threadIsDirect,
  }

  return assistantCronTargetAudienceEquals(source.route, intentAudience) &&
    isDeepStrictEqual(
      resolveAssistantCronTargetBindingDelivery(source.route),
      intent.bindingDelivery ?? null,
    )
}

function legacyNewsletterIntentRequiresAutomationAuthority(
  intent: AssistantOutboxIntent,
): boolean {
  if (!intent.newsletterAuthorizationProof) {
    return false
  }
  const serializedTarget = intent.explicitTarget ?? (
    intent.bindingDelivery?.kind === 'thread'
      ? intent.bindingDelivery.target
      : null
  )
  return parseHostedEmailThreadTarget(serializedTarget)?.targetKind === 'group'
}

async function readAssistantOutboxAuthorizedAutomation(input: {
  authority: NonNullable<AssistantOutboxIntent['automationAuthority']>
  now: Date
  vault: string
}): Promise<
  Awaited<ReturnType<typeof archiveAutomationIfActiveUntilElapsed>> | null
> {
  try {
    const current = await archiveAutomationIfActiveUntilElapsed({
      expectedUpdatedAt: input.authority.expectedUpdatedAt,
      lookup: input.authority.automationId,
      now: input.now,
      vaultRoot: input.vault,
    })
    return !current.archived &&
      current.record.status === 'active' &&
      current.record.updatedAt === input.authority.expectedUpdatedAt
      ? current
      : null
  } catch (error) {
    if (isVaultError(error) && error.code === 'VAULT_AUTOMATION_MISSING') {
      return null
    }
    throw error
  }
}

function createAssistantOutboxAutomationAuthorityStaleError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    'Automation authority changed before outbound delivery.',
  )
}
