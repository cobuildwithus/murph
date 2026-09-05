import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { getKnowledgePage } from '../knowledge/service.js'
import type { AssistantConnectedAppsPort } from './connected-apps-port.js'
import {
  MURPH_JOURNAL_CONNECTED_CONTEXT_AFTERNOON_AUTOMATION_ID,
  MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
} from './managed-automations.js'

// An existing ledger may own notices, cancellations, or timed follow-ups even
// after every account disconnects. Only a missing ledger and a complete empty
// active-account inventory prove that this occurrence has nothing to do.
export async function canSkipManagedJournalConnectedContext(input: {
  automationId: string
  connectedApps: AssistantConnectedAppsPort | null
  signal?: AbortSignal | null
  vaultRoot: string
}): Promise<boolean> {
  if (
    !input.connectedApps
    || ![
      MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
      MURPH_JOURNAL_CONNECTED_CONTEXT_AFTERNOON_AUTOMATION_ID,
    ].includes(input.automationId)
  ) {
    return false
  }
  input.signal?.throwIfAborted()
  try {
    await getKnowledgePage({
      slug: 'journal-connected-context',
      vault: input.vaultRoot,
    })
    input.signal?.throwIfAborted()
    return false
  } catch (error) {
    input.signal?.throwIfAborted()
    if (!(error instanceof VaultCliError) || error.code !== 'knowledge_page_not_found') {
      return false
    }
  }

  try {
    // Do not filter by toolkit: a new account must retain its connection notice.
    const response = await input.connectedApps.request({
      input: { action: 'list' },
      operation: 'manage',
    }, { signal: input.signal })
    input.signal?.throwIfAborted()
    const result = response.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return false
    }
    // The management owner returns a fully collected inventory, never a page.
    // Unexpected fields may signal an error or a changed pagination contract.
    return Object.keys(result).every((key) => key === 'accounts' || key === 'toolkits')
      && 'accounts' in result && Array.isArray(result.accounts)
      && result.accounts.length === 0
      && 'toolkits' in result && Array.isArray(result.toolkits)
  } catch {
    input.signal?.throwIfAborted()
    return false
  }
}
