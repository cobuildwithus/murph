import * as z from '@murphai/contracts/zod-runtime'
import { listAutomationPage } from '@murphai/query'
import type { AssistantConnectedAppsPort } from './connected-apps-port.js'
import { readConnectedContextPolicyState } from './journal-connected-context-ledger.js'
import {
  getMurphMaintenanceAutomationIds,
  MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
} from './managed-automations.js'

// The web manage/list handler returns this complete inventory and requests only
// ACTIVE accounts from Composio. Any other status or contract drift fails open.
const connectedAppsListSchema = z.object({
  result: z.object({
    accounts: z.array(z.object({
      alias: z.string().nullable(),
      connectedAt: z.string().nullable(),
      id: z.string().trim().min(1),
      status: z.literal('ACTIVE'),
      toolkit: z.string().trim().min(1),
      toolkitConfigured: z.boolean(),
      toolkitLabel: z.string(),
      wordId: z.string().nullable(),
    }).strict()),
    toolkits: z.array(z.object({ label: z.string(), slug: z.string().trim().min(1) }).strict()),
  }).strict(),
}).strict()

export async function canSkipManagedJournalConnectedContext(input: {
  automationId: string
  connectedApps?: AssistantConnectedAppsPort | null
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
    if (reminders.items.length !== 0) return false
    const ledger = await readConnectedContextPolicyState(input.vaultRoot)
    input.signal?.throwIfAborted()
    if (ledger.kind === 'unreadable') return false
    if (ledger.kind === 'readable') {
      if (ledger.policy.optOuts.global) return true
      // Stale accounts need one model pass to stop contributing automatic context.
      if (ledger.policy.activeAccounts.length !== 0) return false
    }
    if (!input.connectedApps) return false

    // A stalled optional probe must still admit the ordinary model turn. Race
    // cancellation too, even when an injected port does not honor its signal.
    const deadline = new AbortController()
    const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal
    const timer = setTimeout(() => deadline.abort(), 5_000)
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      signal.throwIfAborted()
      const response = await Promise.race([
        input.connectedApps.request({ operation: 'manage', input: { action: 'list' } }, { signal }),
        aborted,
      ])
      signal.throwIfAborted()
      const parsed = connectedAppsListSchema.safeParse(response)
      return parsed.success && !parsed.data.result.accounts.some(account =>
        ['googlecalendar', 'gmail', 'outlook'].includes(account.toolkit.trim().toLowerCase()),
      )
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  } catch {
    input.signal?.throwIfAborted()
    return false
  }
}
