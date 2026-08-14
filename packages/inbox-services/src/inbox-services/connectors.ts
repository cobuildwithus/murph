import type {
  InboxConnectorConfig,
} from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  EmailDriver,
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
  loadEmailDriver?: (config: InboxConnectorConfig) => Promise<EmailDriver>
}): Promise<PollConnector> {
  switch (input.connector.source) {
    case 'telegram': {
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
    case 'email': {
      const inboxd = await input.loadInbox()
      if (!input.loadEmailDriver) {
        throw new Error('Email connector instantiation requires loadEmailDriver.')
      }
      const driver = await input.loadEmailDriver(input.connector)
      const accountId = runtimeNamespaceAccountId(input.connector)
      return inboxd.createEmailPollConnector({
        driver,
        id: input.connector.id,
        accountId,
        accountAddress: input.connector.options.emailAddress ?? null,
        backfillLimit:
          normalizeBackfillLimit(input.inputLimit) ??
          input.connector.options.backfillLimit ??
          500,
      })
    }
    default: {
      throw new Error(`Unsupported inbox connector source: ${input.connector.source}`)
    }
  }
}
