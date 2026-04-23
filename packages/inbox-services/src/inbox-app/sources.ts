import {
  normalizeInboxConnectorConfig,
  type InboxConnectorConfig,
} from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  InboxAppEnvironment,
  InboxServices,
} from './types.js'
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

export function createInboxSourceOps(
  env: Pick<
    InboxAppEnvironment,
    | 'enableAssistantAutoReplyChannel'
    | 'loadInbox'
    | 'provisionOrRecoverAgentmailInbox'
    | 'tryResolveAgentmailInboxAddress'
  >,
): Pick<
  InboxServices,
  'sourceAdd' | 'sourceList' | 'sourceRemove' | 'sourceSetEnabled'
> {
  return {
    async sourceAdd(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const config = await readConfig(paths)

      if (config.connectors.some((connector) => connector.id === input.id)) {
        throw new VaultCliError(
          'INBOX_SOURCE_EXISTS',
          `Inbox source "${input.id}" is already configured.`,
        )
      }

      if (input.source === 'linq') {
        throw new VaultCliError(
          'INBOX_SOURCE_LOCAL_LINQ_REMOVED',
          'Local Linq inbox connectors are no longer supported. Existing Linq sources can still be listed or removed.',
        )
      }

      let provisionedMailbox = null
      let reusedMailbox = null
      let accountId = normalizeConnectorAccountId(input.source, input.account)
      let emailAddress = normalizeNullableString(input.address)

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

      const connector: InboxConnectorConfig = normalizeInboxConnectorConfig({
        id: input.id,
        source: input.source,
        enabled: true,
        accountId,
        options: {
          backfillLimit: normalizeBackfillLimit(input.backfillLimit),
          emailAddress: input.source === 'email' ? emailAddress : undefined,
        },
      })
      ensureConnectorNamespaceAvailable(config, connector)

      const autoReplyEnabled = input.enableAutoReply
        ? await env.enableAssistantAutoReplyChannel(
            paths.absoluteVaultRoot,
            connector.source,
          )
        : undefined

      const nextConfig = {
        ...config,
        connectors: [...config.connectors, connector],
      }
      sortConnectors(nextConfig)
      await writeConfig(paths, nextConfig)

      return {
        vault: paths.absoluteVaultRoot,
        configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
        connector,
        connectorCount: nextConfig.connectors.length,
        provisionedMailbox,
        reusedMailbox,
        autoReplyEnabled,
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
