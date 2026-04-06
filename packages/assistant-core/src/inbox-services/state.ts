import { mkdir } from 'node:fs/promises'
import {
  hasLocalStatePath,
  readVersionedJsonStateFile,
  resolveRuntimePaths,
  writeVersionedJsonStateFile,
} from '@murphai/runtime-state/node'
import {
  inboxRuntimeConfigSchema,
  type InboxConnectorConfig,
  type InboxRuntimeConfig,
} from '../inbox-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  InboxPaths,
  InboxRuntimeModule,
  RuntimeStore,
} from '../inbox-app/types.js'
import {
  connectorNamespaceKey,
  fileExists,
  relativeToVault,
} from './shared.js'

const INBOX_RUNTIME_CONFIG_SCHEMA = 'murph.inbox-runtime-config.v1'
const INBOX_RUNTIME_CONFIG_SCHEMA_VERSION = 1

export async function ensureInitialized(
  loadInbox: () => Promise<InboxRuntimeModule>,
  vaultRoot: string,
): Promise<InboxPaths> {
  return ensureInitializedWithInbox(await loadInbox(), vaultRoot)
}

export async function ensureInitializedWithInbox(
  inboxd: InboxRuntimeModule,
  vaultRoot: string,
): Promise<InboxPaths> {
  const paths = resolveRuntimePaths(vaultRoot)
  await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

  if (!(await hasLocalStatePath({ currentPath: paths.inboxConfigPath }))) {
    throw new VaultCliError(
      'INBOX_NOT_INITIALIZED',
      'Inbox runtime is not initialized. Run `vault-cli inbox init` first.',
    )
  }

  await readConfig(paths)
  return paths
}

export async function withInitializedInboxRuntime<TResult>(
  loadInbox: () => Promise<InboxRuntimeModule>,
  vaultRoot: string,
  fn: (input: {
    paths: InboxPaths
    runtime: RuntimeStore
  }) => Promise<TResult>,
): Promise<TResult> {
  const inboxd = await loadInbox()
  const paths = await ensureInitializedWithInbox(inboxd, vaultRoot)
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    return await fn({ paths, runtime })
  } finally {
    runtime.close()
  }
}

export async function ensureDirectory(
  absolutePath: string,
  createdPaths: string[],
  vaultRoot: string,
): Promise<void> {
  if (!(await fileExists(absolutePath))) {
    createdPaths.push(relativeToVault(vaultRoot, absolutePath))
  }
  await mkdir(absolutePath, { recursive: true })
}

export async function ensureConfigFile(
  paths: InboxPaths,
  createdPaths: string[],
): Promise<void> {
  if (await hasLocalStatePath({ currentPath: paths.inboxConfigPath })) {
    return
  }

  const emptyConfig: InboxRuntimeConfig = {
    connectors: [],
  }
  await writeVersionedJsonStateFile({
    filePath: paths.inboxConfigPath,
    schema: INBOX_RUNTIME_CONFIG_SCHEMA,
    schemaVersion: INBOX_RUNTIME_CONFIG_SCHEMA_VERSION,
    value: inboxRuntimeConfigSchema.parse(emptyConfig),
  })
  createdPaths.push(relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath))
}

export async function readConfig(
  paths: InboxPaths,
): Promise<InboxRuntimeConfig> {
  try {
    const { value } = await readVersionedJsonStateFile({
      currentPath: paths.inboxConfigPath,
      label: 'Inbox runtime config',
      legacyParseValue(value) {
        return inboxRuntimeConfigSchema.parse(value)
      },
      parseValue(value) {
        return inboxRuntimeConfigSchema.parse(value)
      },
      schema: INBOX_RUNTIME_CONFIG_SCHEMA,
      schemaVersion: INBOX_RUNTIME_CONFIG_SCHEMA_VERSION,
    })
    return value
  } catch (error) {
    throw new VaultCliError(
      'INBOX_CONFIG_INVALID',
      'Inbox runtime config is invalid.',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

export async function writeConfig(
  paths: InboxPaths,
  config: InboxRuntimeConfig,
): Promise<void> {
  await writeVersionedJsonStateFile({
    filePath: paths.inboxConfigPath,
    schema: INBOX_RUNTIME_CONFIG_SCHEMA,
    schemaVersion: INBOX_RUNTIME_CONFIG_SCHEMA_VERSION,
    value: inboxRuntimeConfigSchema.parse(config),
  })
}

export async function rebuildRuntime(
  paths: InboxPaths,
  inboxd: InboxRuntimeModule,
): Promise<number> {
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    await inboxd.rebuildRuntimeFromVault({
      vaultRoot: paths.absoluteVaultRoot,
      runtime,
    })

    let limit = 200
    while (true) {
      const count = runtime.listCaptures({ limit }).length
      if (count < limit) {
        return count
      }
      limit *= 2
    }
  } finally {
    runtime.close()
  }
}

export function sortConnectors(config: InboxRuntimeConfig): void {
  config.connectors.sort((left, right) => left.id.localeCompare(right.id))
}

export function findConnector(
  config: InboxRuntimeConfig,
  sourceId: string,
): InboxConnectorConfig | null {
  return config.connectors.find((connector) => connector.id === sourceId) ?? null
}

export function requireConnector(
  config: InboxRuntimeConfig,
  sourceId: string,
): InboxConnectorConfig {
  const connector = findConnector(config, sourceId)
  if (!connector) {
    throw new VaultCliError(
      'INBOX_SOURCE_NOT_FOUND',
      `Inbox source "${sourceId}" is not configured.`,
    )
  }

  return connector
}

export function ensureConnectorNamespaceAvailable(
  config: InboxRuntimeConfig,
  candidate: InboxConnectorConfig,
): void {
  const namespace = connectorNamespaceKey(candidate)
  const conflict = config.connectors.find(
    (connector) => connectorNamespaceKey(connector) === namespace,
  )
  if (!conflict) {
    return
  }

  throw new VaultCliError(
    'INBOX_SOURCE_NAMESPACE_EXISTS',
    `Inbox source "${candidate.id}" aliases the same runtime namespace as "${conflict.id}".`,
    {
      accountId: candidate.accountId ?? null,
      source: candidate.source,
    },
  )
}
