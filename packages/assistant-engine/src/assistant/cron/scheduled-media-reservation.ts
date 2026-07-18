import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  assertAssistantScheduledTaskSourceCurrent,
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
} from '../scheduled-task-authority.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { withAssistantCronWriteLock } from './locking.js'
import {
  findAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'

export type AssistantCronScheduledMediaLane = 'audio' | 'image'
export type AssistantCronScheduledMediaReservationResult =
  | 'already_reserved'
  | 'reserved'

export async function reserveAssistantCronScheduledMediaGeneration(
  input: {
    authority: AssistantScheduledTaskAuthority | null
    lane: AssistantCronScheduledMediaLane
    occurrenceAt: string
    vault: string
  },
  dependencies: {
    assertSourceCurrent?: typeof assertAssistantScheduledTaskSourceCurrent
    now?: () => string
  } = {},
): Promise<AssistantCronScheduledMediaReservationResult> {
  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  if (
    authority.kind !== 'group_challenge' ||
    !isExactIsoTimestamp(input.occurrenceAt)
  ) {
    throw new VaultCliError(
      'scheduled_media_unauthorized',
      'Scheduled media requires an exact current group-challenge occurrence.',
    )
  }

  const paths = resolveAssistantStatePaths(input.vault)
  return withAssistantCronWriteLock(paths, async () => {
    const currentAuthority = await (
      dependencies.assertSourceCurrent ?? assertAssistantScheduledTaskSourceCurrent
    )({
      authority,
      vault: input.vault,
    })
    if (
      currentAuthority.kind !== 'group_challenge' ||
      currentAuthority.automationId !== authority.automationId ||
      currentAuthority.expectedUpdatedAt !== authority.expectedUpdatedAt
    ) {
      throw new VaultCliError(
        'scheduled_media_unauthorized',
        'Scheduled media authority changed before reservation.',
      )
    }

    const store = await readAssistantCronCanonicalRuntimeStore(paths, {
      reclaimStaleRunningClaims: false,
    })
    const runtimeState = findAssistantCronCanonicalRuntimeRecord(
      store,
      authority.automationId,
    )
    if (
      !runtimeState ||
      runtimeState.state.pendingOccurrenceAt !== input.occurrenceAt ||
      runtimeState.state.runningAt === null ||
      runtimeState.state.runningClaimId === null
    ) {
      throw new VaultCliError(
        'scheduled_media_unauthorized',
        'Scheduled media occurrence is not the current claimed cron occurrence.',
      )
    }

    if (runtimeState.state.scheduledMediaReservation !== null) {
      return 'already_reserved'
    }

    const now = dependencies.now?.() ?? new Date().toISOString()
    upsertAssistantCronCanonicalRuntimeRecord(store, {
      ...runtimeState,
      updatedAt: now,
      state: {
        ...runtimeState.state,
        scheduledMediaReservation: {
          automationId: authority.automationId,
          expectedUpdatedAt: authority.expectedUpdatedAt,
          lane: input.lane,
          occurrenceAt: input.occurrenceAt,
        },
      },
    })
    await writeAssistantCronCanonicalRuntimeStore(paths, store, {
      reclaimStaleRunningClaims: false,
    })
    return 'reserved'
  })
}

function isExactIsoTimestamp(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}
