import type { InboxConnectorConfig } from '../inbox-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  InboxAppEnvironment,
  InboxCliServices,
} from './types.js'
import { describeLinqConnectorEndpoint } from './linq-endpoint.js'
import {
  normalizeBackfillLimit,
  normalizeConnectorAccountId,
  normalizeNullableString,
  relativeToVault,
} from '../inbox-services/shared.js'
import {
  ensureConnectorNamespaceAvailable,
  ensureInitialized,
  readConfig,
  sortConnectors,
  writeConfig,
} from '../inbox-services/state.js'

function normalizeOptionalLinqWebhookPath(
  value: string | null | undefined,
): string | undefined {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return undefined
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeOptionalLinqWebhookPort(
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new VaultCliError(
      'INBOX_LINQ_WEBHOOK_PORT_INVALID',
      'Linq webhook port must be an integer between 1 and 65535.',
    )
  }

  return value
}

function assertImessageSupportedOnHost(
  env: Pick<InboxAppEnvironment, 'getPlatform'>,
  action: 'add' | 'enable',
): void {
  const platform = env.getPlatform()
  if (platform === 'darwin') {
    return
  }

  throw new VaultCliError(
    'INBOX_IMESSAGE_UNAVAILABLE',
    action === 'add'
      ? 'The iMessage inbox connector requires macOS. Use Telegram, Linq, or email on Linux, or keep iMessage on a Mac host.'
      : 'The iMessage inbox connector requires macOS and cannot be enabled on this host. Disable it here or run it from a Mac host.',
    {
      platform,
    },
  )
}

export function createInboxSourceOps(
  env: InboxAppEnvironment,
): Pick<
  InboxCliServices,
  'sourceAdd' | 'sourceList' | 'sourceRemove' | 'sourceSetEnabled'
> {
  return {
    async sourceAdd(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const config = await readConfig(paths)

      if (input.source === 'imessage') {
        assertImessageSupportedOnHost(env, 'add')
      }

      if (config.connectors.some((connector) => connector.id === input.id)) {
        throw new VaultCliError(
          'INBOX_SOURCE_EXISTS',
          `Inbox source "${input.id}" is already configured.`,
        )
      }

      let provisionedMailbox = null
      let reusedMailbox = null
      let accountId = normalizeConnectorAccountId(input.source, input.account)
      let emailAddress = normalizeNullableString(input.address)
      const linqWebhookHost = normalizeNullableString(input.linqWebhookHost)
      const linqWebhookPath = normalizeOptionalLinqWebhookPath(input.linqWebhookPath)
      const linqWebhookPort = normalizeOptionalLinqWebhookPort(input.linqWebhookPort)

      if (input.source === 'email') {
        if (input.provision) {
          const mailbox = await env.provisionOrRecoverAgentmailInbox({
            displayName: input.emailDisplayName,
            username: input.emailUsername,
            domain: input.emailDomain,
            clientId: input.emailClientId,
            preferredAccountId: accountId,
            preferredEmailAddress: emailAddress,
          })
          accountId = mailbox.accountId
          emailAddress = mailbox.emailAddress
          provisionedMailbox = mailbox.provisionedMailbox
          reusedMailbox = mailbox.reusedMailbox
        }

        if (!accountId) {
          throw new VaultCliError(
            'INBOX_EMAIL_ACCOUNT_REQUIRED',
            'Email connectors require --account with an existing AgentMail inbox id, or --provision to create one.',
          )
        }

        emailAddress = await env.tryResolveAgentmailInboxAddress({
          accountId,
          emailAddress,
        })
      }

      if (input.source === 'linq') {
        const nextEndpoint = {
          host: linqWebhookHost ?? '0.0.0.0',
          path: linqWebhookPath ?? '/linq-webhook',
          port: linqWebhookPort ?? 8789,
        }
        const conflictingConnector = config.connectors.find((connector) => {
          if (connector.source !== 'linq') {
            return false
          }

          const endpoint = describeLinqConnectorEndpoint(connector)
          return (
            endpoint.host === nextEndpoint.host &&
            endpoint.path === nextEndpoint.path &&
            endpoint.port === nextEndpoint.port
          )
        })

        if (conflictingConnector) {
          throw new VaultCliError(
            'INBOX_LINQ_WEBHOOK_CONFLICT',
            `Linq webhook endpoint ${nextEndpoint.host}:${nextEndpoint.port}${nextEndpoint.path} is already assigned to connector "${conflictingConnector.id}".`,
          )
        }
      }

      const connector: InboxConnectorConfig = {
        id: input.id,
        source: input.source,
        enabled: true,
        accountId,
        options: {
          includeOwnMessages:
            input.source === 'imessage' ? input.includeOwn ?? undefined : undefined,
          backfillLimit: normalizeBackfillLimit(input.backfillLimit),
          emailAddress: input.source === 'email' ? emailAddress : undefined,
          linqWebhookHost: input.source === 'linq' ? linqWebhookHost ?? undefined : undefined,
          linqWebhookPath: input.source === 'linq' ? linqWebhookPath ?? undefined : undefined,
          linqWebhookPort: input.source === 'linq' ? linqWebhookPort ?? undefined : undefined,
        },
      }
      ensureConnectorNamespaceAvailable(config, connector)

      config.connectors.push(connector)
      sortConnectors(config)
      await writeConfig(paths, config)

      if (input.enableAutoReply) {
        await env.enableAssistantAutoReplyChannel(paths.absoluteVaultRoot, connector.source)
      }

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connector,
        connectorCount: config.connectors.length,
        provisionedMailbox,
        reusedMailbox,
        autoReplyEnabled: input.enableAutoReply ? true : undefined,
      }
    },

    async sourceList(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const config = await readConfig(paths)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connectors: config.connectors,
      }
    },

    async sourceRemove(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const config = await readConfig(paths)
      const index = config.connectors.findIndex(
        (connector) => connector.id === input.connectorId,
      )

      if (index === -1) {
        throw new VaultCliError(
          'INBOX_SOURCE_NOT_FOUND',
          `Inbox source "${input.connectorId}" is not configured.`,
        )
      }

      config.connectors.splice(index, 1)
      await writeConfig(paths, config)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        removed: true,
        connectorId: input.connectorId,
        connectorCount: config.connectors.length,
      }
    },

    async sourceSetEnabled(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const config = await readConfig(paths)
      const connector = config.connectors.find(
        (candidate) => candidate.id === input.connectorId,
      )

      if (!connector) {
        throw new VaultCliError(
          'INBOX_SOURCE_NOT_FOUND',
          `Inbox source "${input.connectorId}" is not configured.`,
        )
      }

      if (connector.source === 'imessage' && input.enabled) {
        assertImessageSupportedOnHost(env, 'enable')
      }

      connector.enabled = input.enabled
      await writeConfig(paths, config)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connector,
        connectorCount: config.connectors.length,
      }
    },
  }
}
