import type {
  InboxConnectorConfig,
} from '@murphai/operator-config/inbox-cli-contracts'
import type {
  InboxRuntimeModule,
  PollConnector,
  TelegramDriver,
} from '../inbox-app/types.js'
import {
  normalizeBackfillLimit,
  runtimeNamespaceAccountId,
} from './shared.js'

export async function instantiateConnector(input: {
  connector: InboxConnectorConfig
  inputLimit?: number
  loadInbox: () => Promise<InboxRuntimeModule>
  loadTelegramDriver: (config: InboxConnectorConfig) => Promise<TelegramDriver>
}): Promise<PollConnector> {
  if (input.connector.source !== 'telegram') {
    throw new Error(`Unsupported inbox connector source: ${input.connector.source}`)
  }

  const inboxd = await input.loadInbox()
  const driver = await input.loadTelegramDriver(input.connector)
  const accountId = runtimeNamespaceAccountId(input.connector)
  return inboxd.createTelegramPollConnector({
    driver,
    id: input.connector.id,
    accountId: accountId ?? 'bot',
    backfillLimit:
      normalizeBackfillLimit(input.inputLimit) ??
      input.connector.options.backfillLimit ??
      500,
    downloadAttachments: true,
    transportMode: 'take-over-webhook',
  })
}
