import os from 'node:os'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '../assistant-state.js'
import {
  createAgentmailApiClient,
  listAllAgentmailInboxes,
  matchesAgentmailHttpError,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
} from '../agentmail-runtime.js'
import { ensureImessageMessagesDbReadable } from '../imessage-readiness.js'
import { loadQueryRuntime } from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { SETUP_RUNTIME_ENV_NOTICE } from '../setup-runtime-env.js'
import {
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  resolveTelegramFileBaseUrl,
} from '../telegram-runtime.js'
import type { InboxConnectorConfig } from '../inbox-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  CoreRuntimeModule,
  EmailDriver,
  ImessageDriver,
  InboxAppEnvironment,
  InboxServicesDependencies,
  InboxRuntimeModule,
  ParsersRuntimeModule,
  ProvisionedMailboxResolution,
  RecoveredProvisionedMailbox,
  TelegramDriver,
} from './types.js'
import type { ImportersFactoryRuntimeModule } from '../usecases/types.js'

import { normalizeNullableString } from '../inbox-services/shared.js'

const IMESSAGE_MESSAGES_DB_RELATIVE_PATH = ['Library', 'Messages', 'chat.db'].join('/')

function createParserRuntimeUnavailableError(
  operation: string,
  cause: unknown,
): VaultCliError {
  const details =
    cause instanceof Error
      ? {
          cause: cause.message,
          packages: ['@murphai/inboxd', '@murphai/parsers'],
        }
      : {
          packages: ['@murphai/inboxd', '@murphai/parsers'],
        }

  return new VaultCliError(
    'runtime_unavailable',
    `packages/cli can describe ${operation}, but local execution is blocked until the integrating workspace builds and links @murphai/inboxd and @murphai/parsers.`,
    details,
  )
}

export { IMESSAGE_MESSAGES_DB_RELATIVE_PATH }

export function createInboxAppEnvironment(
  dependencies: InboxServicesDependencies = {},
): InboxAppEnvironment {
  const clock = dependencies.clock ?? (() => new Date())
  const getPid = dependencies.getPid ?? (() => process.pid)
  const getPlatform = dependencies.getPlatform ?? (() => process.platform)
  const getHomeDirectory = dependencies.getHomeDirectory ?? (() => os.homedir())
  const killProcess =
    dependencies.killProcess ??
    ((pid: number, signal?: NodeJS.Signals | number) => {
      process.kill(pid, signal)
    })
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds)
      }))
  const getEnvironment = dependencies.getEnvironment ?? (() => process.env)
  const loadCore =
    dependencies.loadCoreModule ??
    (() => loadRuntimeModule<CoreRuntimeModule>('@murphai/core'))
  const loadImporters =
    dependencies.loadImportersModule ??
    (() => loadRuntimeModule<ImportersFactoryRuntimeModule>('@murphai/importers'))
  const loadInbox =
    dependencies.loadInboxModule ??
    (() => loadRuntimeModule<InboxRuntimeModule>('@murphai/inboxd'))
  const loadParsers =
    dependencies.loadParsersModule ??
    (() => loadRuntimeModule<ParsersRuntimeModule>('@murphai/parsers'))
  const loadQuery =
    dependencies.loadQueryModule ??
    (() => loadQueryRuntime())

  const requireParsers = async (
    operation: string,
  ): Promise<ParsersRuntimeModule> => {
    try {
      return await loadParsers()
    } catch (error) {
      throw createParserRuntimeUnavailableError(operation, error)
    }
  }

  const loadConfiguredImessageDriver = async (
    config: InboxConnectorConfig,
  ): Promise<ImessageDriver> => {
    if (dependencies.loadImessageDriver) {
      return dependencies.loadImessageDriver(config)
    }

    const inboxd = await loadInbox()
    return inboxd.loadImessageKitDriver()
  }

  const loadConfiguredTelegramDriver = async (
    config: InboxConnectorConfig,
  ): Promise<TelegramDriver> => {
    if (dependencies.loadTelegramDriver) {
      return dependencies.loadTelegramDriver(config)
    }

    const inboxd = await loadInbox()
    const env = getEnvironment()
    const token = resolveTelegramBotToken(env)

    if (!token) {
      throw new VaultCliError(
        'INBOX_TELEGRAM_TOKEN_MISSING',
        `Telegram requires a bot token in TELEGRAM_BOT_TOKEN. ${SETUP_RUNTIME_ENV_NOTICE}`,
      )
    }

    return inboxd.createTelegramBotApiPollDriver({
      token,
      apiBaseUrl: resolveTelegramApiBaseUrl(env) ?? undefined,
      fileBaseUrl: resolveTelegramFileBaseUrl(env) ?? undefined,
    })
  }

  const createConfiguredAgentmailClient = (
    apiKey?: string | null,
  ) => {
    const env = getEnvironment()
    const resolvedApiKey =
      normalizeNullableString(apiKey) ?? resolveAgentmailApiKey(env)

    if (!resolvedApiKey) {
      throw new VaultCliError(
        'INBOX_EMAIL_API_KEY_MISSING',
        `Email requires AGENTMAIL_API_KEY. ${SETUP_RUNTIME_ENV_NOTICE}`,
      )
    }

    const baseUrl = resolveAgentmailBaseUrl(env) ?? undefined

    return dependencies.createAgentmailClient
      ? dependencies.createAgentmailClient({
          apiKey: resolvedApiKey,
          baseUrl,
          env,
        })
      : createAgentmailApiClient(resolvedApiKey, {
          baseUrl,
        })
  }

  const loadConfiguredEmailDriver = async (
    config: InboxConnectorConfig,
  ): Promise<EmailDriver> => {
    if (dependencies.loadEmailDriver) {
      return dependencies.loadEmailDriver(config)
    }

    const inboxId = normalizeNullableString(config.accountId)
    if (!inboxId) {
      throw new VaultCliError(
        'INBOX_EMAIL_ACCOUNT_REQUIRED',
        'Email connectors require an AgentMail inbox id as the connector account.',
      )
    }

    const client = createConfiguredAgentmailClient()
    const inboxd = await loadInbox()
    return inboxd.createAgentmailApiPollDriver({
      apiKey: client.apiKey,
      inboxId,
      baseUrl: client.baseUrl,
    })
  }

  const enableAssistantAutoReplyChannel = async (
    vault: string,
    channel: InboxConnectorConfig['source'],
  ): Promise<boolean> => {
    const state = await readAssistantAutomationState(vault)
    const channels = [...new Set([...state.autoReplyChannels, channel])]
    const backlogChannels = [
      ...new Set([
        ...state.autoReplyBacklogChannels.filter((value) => channels.includes(value)),
        ...(channel === 'email' ? ['email'] : []),
      ]),
    ]
    const changed =
      channels.length !== state.autoReplyChannels.length ||
      channels.some((value, index) => state.autoReplyChannels[index] !== value) ||
      backlogChannels.length !== state.autoReplyBacklogChannels.length ||
      backlogChannels.some((value, index) => state.autoReplyBacklogChannels[index] !== value)

    if (!changed) {
      return false
    }

    await saveAssistantAutomationState(vault, {
      version: 2,
      inboxScanCursor: state.inboxScanCursor,
      autoReplyScanCursor: null,
      autoReplyChannels: channels,
      autoReplyBacklogChannels: backlogChannels,
      autoReplyPrimed: false,
      updatedAt: new Date().toISOString(),
    })

    return true
  }

  const toProvisionedMailbox = (input: {
    inbox_id: string
    email: string
    display_name?: string | null
    client_id?: string | null
  }) => ({
    inboxId: input.inbox_id,
    emailAddress: input.email,
    displayName: normalizeNullableString(input.display_name),
    clientId: normalizeNullableString(input.client_id),
    provider: 'agentmail' as const,
  })

  const tryResolveAgentmailInboxAddress = async (input: {
    accountId: string
    emailAddress: string | null
  }): Promise<string | null> => {
    if (input.emailAddress) {
      return input.emailAddress
    }

    try {
      const inbox = await createConfiguredAgentmailClient().getInbox(input.accountId)
      return normalizeNullableString(inbox.email)
    } catch {
      return input.emailAddress
    }
  }

  const toRecoveredMailbox = (input: {
    accountId: string
    emailAddress: string | null
  }) => {
    const emailAddress = normalizeNullableString(input.emailAddress)
    if (!emailAddress) {
      return null
    }

    return {
      inboxId: input.accountId,
      emailAddress,
      displayName: null,
      clientId: null,
      provider: 'agentmail' as const,
    }
  }

  const recoverForbiddenAgentmailProvision = async (input: {
    preferredAccountId?: string | null
    preferredEmailAddress?: string | null
  } = {}): Promise<RecoveredProvisionedMailbox> => {
    const preferredAccountId = normalizeNullableString(input.preferredAccountId)
    const preferredEmailAddress = normalizeNullableString(input.preferredEmailAddress)

    if (preferredAccountId) {
      try {
        const inbox = await createConfiguredAgentmailClient().getInbox(preferredAccountId)
        return {
          accountId: inbox.inbox_id,
          emailAddress: normalizeNullableString(inbox.email),
          mailbox: toProvisionedMailbox(inbox),
        }
      } catch {
        return {
          accountId: preferredAccountId,
          emailAddress: preferredEmailAddress,
          mailbox: toRecoveredMailbox({
            accountId: preferredAccountId,
            emailAddress: preferredEmailAddress,
          }),
        }
      }
    }

    try {
      const inboxes = await listAllAgentmailInboxes(createConfiguredAgentmailClient())

      if (inboxes.length === 1) {
        const inbox = inboxes[0]!
        return {
          accountId: inbox.inbox_id,
          emailAddress: normalizeNullableString(inbox.email),
          mailbox: toProvisionedMailbox(inbox),
        }
      }

      if (inboxes.length > 1) {
        throw new VaultCliError(
          'INBOX_EMAIL_ACCOUNT_SELECTION_REQUIRED',
          'AgentMail rejected inbox creation for this API key, but multiple existing inboxes are available. Rerun with --account <inbox_id> to choose one, or use `murph onboard` to select an inbox interactively.',
          { inboxCount: inboxes.length },
        )
      }

      throw new VaultCliError(
        'INBOX_EMAIL_ACCOUNT_REQUIRED',
        'AgentMail rejected inbox creation for this API key and no existing inboxes were returned. Rerun with --account <inbox_id> for an existing inbox, or check whether this key can create inboxes.',
      )
    } catch (error) {
      if (
        matchesAgentmailHttpError(error, {
          status: 403,
          method: 'GET',
          path: '/inboxes',
        })
      ) {
        throw new VaultCliError(
          'INBOX_EMAIL_SCOPED_KEY_ACCOUNT_REQUIRED',
          'AgentMail rejected both inbox creation and inbox discovery for this API key. This key may be scoped to an existing inbox. Rerun with --account <inbox_id> (often the inbox email address), or use `murph onboard`.',
        )
      }

      if (error instanceof VaultCliError) {
        throw error
      }

      throw error
    }
  }

  const provisionOrRecoverAgentmailInbox = async (input: {
    displayName?: string | null
    username?: string | null
    domain?: string | null
    clientId?: string | null
    preferredAccountId?: string | null
    preferredEmailAddress?: string | null
  }): Promise<ProvisionedMailboxResolution> => {
    const client = createConfiguredAgentmailClient()

    try {
      const inbox = await client.createInbox({
        displayName: normalizeNullableString(input.displayName),
        username: normalizeNullableString(input.username),
        domain: normalizeNullableString(input.domain),
        clientId: normalizeNullableString(input.clientId),
      })

      return {
        accountId: inbox.inbox_id,
        emailAddress: normalizeNullableString(inbox.email),
        provisionedMailbox: toProvisionedMailbox(inbox),
        reusedMailbox: null,
      }
    } catch (error) {
      if (
        !matchesAgentmailHttpError(error, {
          status: 403,
          method: 'POST',
          path: '/inboxes',
        })
      ) {
        throw error
      }

      const recovered = await recoverForbiddenAgentmailProvision({
        preferredAccountId: input.preferredAccountId,
        preferredEmailAddress: input.preferredEmailAddress,
      })

      return {
        accountId: recovered.accountId,
        emailAddress: recovered.emailAddress,
        provisionedMailbox: null,
        reusedMailbox: recovered.mailbox,
      }
    }
  }

  const ensureConfiguredImessageReady = async (): Promise<void> => {
    await ensureImessageMessagesDbReadable(
      {
        homeDirectory: getHomeDirectory(),
        platform: getPlatform(),
        probeMessagesDb: dependencies.probeImessageMessagesDb,
      },
      {
        unavailableCode: 'INBOX_IMESSAGE_UNAVAILABLE',
        unavailableMessage: 'The iMessage inbox connector requires macOS.',
        permissionCode: 'INBOX_IMESSAGE_PERMISSION_REQUIRED',
        permissionMessage:
          `The iMessage inbox connector requires read access to ~/${IMESSAGE_MESSAGES_DB_RELATIVE_PATH}. Grant Full Disk Access to the terminal or app running Murph, fully restart it, and retry.`,
      },
    )
  }

  return {
    clock,
    getPid,
    getPlatform,
    getHomeDirectory,
    killProcess,
    sleep,
    getEnvironment,
    usesInjectedEmailDriver: Boolean(dependencies.loadEmailDriver),
    usesInjectedTelegramDriver: Boolean(dependencies.loadTelegramDriver),
    loadCore,
    loadImporters,
    loadInbox,
    loadParsers,
    loadQuery,
    requireParsers,
    loadConfiguredImessageDriver,
    loadConfiguredTelegramDriver,
    loadConfiguredEmailDriver,
    createConfiguredAgentmailClient,
    enableAssistantAutoReplyChannel,
    provisionOrRecoverAgentmailInbox,
    tryResolveAgentmailInboxAddress,
    ensureConfiguredImessageReady,
    journalPromotionEnabled:
      dependencies.enableJournalPromotion ?? dependencies.loadCoreModule === undefined,
  }
}
