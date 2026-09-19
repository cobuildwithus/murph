import { toLocalDayKey } from '@murphai/contracts'
import { listAutomaticMealPhotoCloseoutWorkRecords } from '@murphai/vault-usecases/records'
import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID } from './managed-automations.js'

export async function canSkipManagedAutomaticMealCloseout(input: {
  automationId: string
  occurrenceAt: string
  signal?: AbortSignal | null
  timeZone: string | null
  vaultRoot: string
}): Promise<boolean> {
  if (input.automationId !== MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID) return false
  input.signal?.throwIfAborted()
  // Use the same queue as meal closeout, including historical retained photos
  // and same-occurrence removal revisions. Read failures remain retryable.
  const work = await listAutomaticMealPhotoCloseoutWorkRecords({
    limit: 1,
    occurrenceAt: input.occurrenceAt,
    to: input.timeZone
      ? toLocalDayKey(new Date(input.occurrenceAt), input.timeZone)
      : undefined,
    vault: input.vaultRoot,
  })
  input.signal?.throwIfAborted()
  return work.items.length === 0
}
