import type { InboxConnectorConfig } from '@murph/assistant-core/inbox-cli-contracts'

export function describeLinqConnectorEndpoint(
  connector: Pick<InboxConnectorConfig, 'options'>,
): {
  host: string
  path: string
  port: number
} {
  return {
    host: connector.options.linqWebhookHost ?? '0.0.0.0',
    path: connector.options.linqWebhookPath ?? '/linq-webhook',
    port: connector.options.linqWebhookPort ?? 8789,
  }
}
