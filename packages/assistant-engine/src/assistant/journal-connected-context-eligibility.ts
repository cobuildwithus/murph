import { listAutomationPage } from '@murphai/query'
import {
  getMurphMaintenanceAutomationIds,
  MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
} from './managed-automations.js'

/**
 * Preparation owns the connected-account inventory and controls; this check
 * only adds the private reminder inventory. Any active or paused reminder
 * needs the daily review, and an absent or uncertain preparation admits.
 */
export async function canSkipManagedJournalConnectedContext(input: {
  automationId: string
  preparedAdmission?: 'run' | 'empty' | null
  signal?: AbortSignal | null
  vaultRoot: string
}): Promise<boolean> {
  if (input.automationId !== MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID) return false
  input.signal?.throwIfAborted()
  try {
    // Same inventory and maintenance exclusion as vault-cli automation list.
    const reminders = await listAutomationPage(input.vaultRoot, {
      status: ['active', 'paused'],
      excludeAutomationIds: getMurphMaintenanceAutomationIds(),
      limit: 1,
    })
    input.signal?.throwIfAborted()
    return reminders.items.length === 0 && input.preparedAdmission === 'empty'
  } catch {
    input.signal?.throwIfAborted()
    return false
  }
}
