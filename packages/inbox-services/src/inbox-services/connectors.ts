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
import { normalizeBackfillLimit } from './shared.js'

export async function instantiateConnector(input: {
  connector: InboxConnectorConfig
  inputLimit?: number
  loadInbox: () => Promise<InboxRuntimeModule>
  loadTelegramDriver: (config: InboxConnectorConfig) => Promise<TelegramDriver>
  loadEmailDriver?: (config: InboxConnectorConfig) => Promise<EmailDriver>
  linqWebhookSecret: string | null
}): Promise<PollConnector> {
  switch (input.connector.source) {
    case 'telegram': {
      const inboxd = await input.loadInbox()
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
      const inboxd = await input.loadInbox()
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
      const inboxd = await input.loadInbox()
      const webhookSecret = requireLinqWebhookSecret(input.linqWebhookSecret)
      return inboxd.createLinqWebhookConnector({
        id: input.connector.id,
        accountId: input.connector.accountId,
        host: input.connector.options.linqWebhookHost ?? undefined,
        path: input.connector.options.linqWebhookPath ?? undefined,
        port: input.connector.options.linqWebhookPort ?? undefined,
        webhookSecret,
        downloadAttachments: true,
      })
    }
    default: {
      throw new Error(`Unsupported inbox connector source: ${input.connector.source}`)
    }
  }
}

function requireLinqWebhookSecret(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    throw new Error('Linq webhook secret is required before the local Linq listener can start.')
  }

  return normalized
}
