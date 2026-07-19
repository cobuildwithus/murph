import {
  listAutomations,
  pauseAutomationsIfExactSnapshots,
  type AutomationRecord,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  assistantAutomationHasAmbiguousLinqAudience,
  type AssistantScheduledAutomationSource,
} from './scheduled-task-authority.js'

const AMBIGUOUS_LINQ_AUTOMATION_MAX_CANDIDATES = 4_096

/**
 * Temporary pre-claim bridge for pre-binding Linq automations without an
 * explicitly direct audience.
 *
 * Their free-text instructions cannot prove whether they target a private
 * conversation, an ordinary group notification, a health update, or a
 * challenge. This bridge grants no authority: it atomically pauses the
 * ambiguous set. Legacy direct work must be explicitly retargeted to a trusted
 * current direct conversation; group work must be recreated through the
 * ordinary current-route create path with a typed task.
 *
 * Remove it only after the typed runner is the rollback floor, every older
 * runner has been retired, and a complete supported-vault inventory taken
 * after that point reports zero matching active or paused records.
 */
export async function pauseAmbiguousLinqAutomationsBeforeClaim(input: {
  now?: Date
  vault: string
}): Promise<void> {
  const candidates = await listAmbiguousLinqAutomationPauseCandidates({
    vault: input.vault,
  })
  if (candidates.length === 0) {
    return
  }

  const { paused } = await pauseAutomationsIfExactSnapshots({
    snapshots: candidates,
    ...(input.now ? { now: input.now } : {}),
    vaultRoot: input.vault,
  })
  if (!paused) {
    throw new VaultCliError(
      'ASSISTANT_AMBIGUOUS_LINQ_AUTOMATION_PAUSE_RACED',
      'An ambiguous Linq automation changed while scheduled execution was being paused.',
      { retryable: true },
    )
  }
}

export function assertAmbiguousLinqAutomationNotClaimable(
  source: AssistantScheduledAutomationSource,
): void {
  if (!assistantAutomationHasAmbiguousLinqAudience(source)) {
    return
  }
  throw new VaultCliError(
    'ASSISTANT_AMBIGUOUS_LINQ_AUTOMATION_RECREATION_REQUIRED',
    'This ambiguous Linq automation must be explicitly retargeted to a trusted current direct conversation or recreated from the current group with a typed task before it can run.',
  )
}

async function listAmbiguousLinqAutomationPauseCandidates(input: {
  vault: string
}): Promise<AutomationRecord[]> {
  const automations = await listAutomations({
    status: 'active',
    vaultRoot: input.vault,
  })
  const candidates = automations.items.filter((automation) =>
    assistantAutomationHasAmbiguousLinqAudience(automation)
  )
  if (candidates.length > AMBIGUOUS_LINQ_AUTOMATION_MAX_CANDIDATES) {
    throw new VaultCliError(
      'ASSISTANT_AMBIGUOUS_LINQ_AUTOMATION_CANDIDATE_LIMIT',
      'Ambiguous untyped Linq pre-claim candidates exceeded the bounded transition limit.',
    )
  }
  return candidates
}
