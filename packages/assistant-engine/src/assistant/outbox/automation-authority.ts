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
  assertAssistantScheduledTaskSourceCurrent,
} from '../scheduled-task-authority.js'

export async function resolveAssistantOutboxAutomationAuthorityError(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<Error | null> {
  const authority = input.intent.automationAuthority
  if (!authority) {
    return legacyNewsletterIntentRequiresAutomationAuthority(input.intent)
      ? createAssistantOutboxAutomationAuthorityStaleError()
      : null
  }

  const current = await readAssistantOutboxAuthorizedAutomation({
    authority,
    now: new Date(),
    vault: input.vault,
  })
  if (!current) {
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
