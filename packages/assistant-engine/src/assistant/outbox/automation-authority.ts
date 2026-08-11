import {
  archiveAutomationIfActiveUntilElapsed,
  isVaultError,
} from '@murphai/core'
import type {
  AssistantOnboardingState,
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  runExperimentLifecycleDeliveryAuthorityPrecondition,
} from '../experiment-support-automations.js'
import {
  isRecognizedMurphOnboardingFollowupAutomation,
  isRetiredMurphManagedAutomationId,
} from '../managed-automations.js'
import {
  isAssistantOnboardingStateReadError,
  readAssistantOnboardingState,
} from '../onboarding-state.js'
import {
  isCurrentMurphOnboardingFollowupAutomation,
} from '../onboarding-followup-automation.js'
import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
  runOnboardingGoalCheckinAuthorityPrecondition,
} from '../onboarding-goal-checkin-automation.js'

export async function resolveAssistantOutboxAutomationAuthorityError(input: {
  intent: AssistantOutboxIntent
  vault: string
}): Promise<Error | null> {
  const authority = input.intent.automationAuthority
  if (!authority) {
    return null
  }
  if (isRetiredMurphManagedAutomationId(authority.automationId)) {
    return createAssistantOutboxAutomationAuthorityStaleError()
  }

  const authorityNow = new Date()
  const current = await readAssistantOutboxAuthorizedAutomation({
    authority,
    now: authorityNow,
    vault: input.vault,
  })
  if (!current) {
    return createAssistantOutboxAutomationAuthorityStaleError()
  }

  if (isRecognizedMurphOnboardingFollowupAutomation(current.record)) {
    if (!isCurrentMurphOnboardingFollowupAutomation(current.record)) {
      return createAssistantOutboxAutomationAuthorityStaleError()
    }
    let onboardingState: AssistantOnboardingState
    try {
      onboardingState = await readAssistantOnboardingState(input.vault)
    } catch (error) {
      if (!isAssistantOnboardingStateReadError(error)) {
        throw error
      }
      throw new VaultCliError(
        'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
        'Onboarding follow-up authority could not be revalidated before delivery.',
        {
          reason: error.reason,
          retryable: true,
        },
      )
    }
    if (onboardingState.status === 'completed') {
      return createAssistantOutboxAutomationAuthorityStaleError()
    }
  }

  if (
    current.record.automationId ===
    MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID
  ) {
    const onboardingAuthority =
      await runOnboardingGoalCheckinAuthorityPrecondition({
        automationId: current.record.automationId,
        occurrenceAt:
          current.record.schedule.kind === 'at'
            ? current.record.schedule.at
            : authorityNow.toISOString(),
        vault: input.vault,
      })
    if (onboardingAuthority.kind === 'skip') {
      return createAssistantOutboxAutomationAuthorityStaleError()
    }
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
  return finalCurrent
    ? null
    : createAssistantOutboxAutomationAuthorityStaleError()
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
