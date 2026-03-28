import type {
  InboxConnectorConfig,
} from '../inbox-cli-contracts.js'
import type {
  EmailDriver,
  ImessageDriver,
  InboxRuntimeModule,
  PollConnector,
  TelegramDriver,
} from '../inbox-app/types.js'
import { normalizeBackfillLimit } from './shared.js'

export async function instantiateConnector(input: {
  connector: InboxConnectorConfig
  inputLimit?: number
  loadInbox: () => Promise<InboxRuntimeModule>
  loadImessageDriver: (config: InboxConnectorConfig) => Promise<ImessageDriver>
  loadTelegramDriver: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  loadEmailDriver?: (config: InboxConnectorConfig) => Promise<EmailDriver>
  linqWebhookSecret?: string | null
  ensureImessageReady?: () => Promise<void>
}): Promise<PollConnector> {
  const inboxd = await input.loadInbox()

  switch (input.connector.source) {
    case 'imessage': {
      await input.ensureImessageReady?.()
      const driver = await input.loadImessageDriver(input.connector)
      return inboxd.createImessageConnector({
        driver,
        id: input.connector.id,
        accountId: input.connector.accountId ?? 'self',
        includeOwnMessages:
          input.connector.options.includeOwnMessages ?? true,
        backfillLimit:
          normalizeBackfillLimit(input.inputLimit) ??
          input.connector.options.backfillLimit ??
          500,
      })
    }
    case 'telegram': {
      const driver = await input.loadTelegramDriver(input.connector)
      return inboxd.createTelegramPollConnector({
        driver,
        id: input.connector.id,
        accountId: input.connector.accountId ?? 'bot',
        backfillLimit:
          normalizeBackfillLimit(input.inputLimit) ??
          input.connector.options.backfillLimit ??
          500,
        downloadAttachments: true,
        transportMode: 'take-over-webhook',
      })
    }
    case 'email': {
      if (!input.loadEmailDriver) {
        throw new Error('Email connector instantiation requires loadEmailDriver.')
      }
      const driver = await input.loadEmailDriver(input.connector)
      return inboxd.createEmailPollConnector({
        driver,
        id: input.connector.id,
        accountId: input.connector.accountId,
        accountAddress: input.connector.options.emailAddress ?? null,
        backfillLimit:
          normalizeBackfillLimit(input.inputLimit) ??
          input.connector.options.backfillLimit ??
          500,
      })
    }
    case 'linq': {
      return inboxd.createLinqWebhookConnector({
        id: input.connector.id,
        accountId: input.connector.accountId,
        host: input.connector.options.linqWebhookHost ?? undefined,
        path: input.connector.options.linqWebhookPath ?? undefined,
        port: input.connector.options.linqWebhookPort ?? undefined,
        webhookSecret: input.linqWebhookSecret ?? null,
        downloadAttachments: true,
      })
    }
  }
}
