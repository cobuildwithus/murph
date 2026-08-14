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
    'enableAssistantAutoReplyChannel' | 'loadInbox'
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

      const connector: InboxConnectorConfig = normalizeInboxConnectorConfig({
        id: input.id,
        source: input.source,
        enabled: true,
        accountId: normalizeConnectorAccountId(input.source, input.account),
        options: {
          backfillLimit: normalizeBackfillLimit(input.backfillLimit),
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
