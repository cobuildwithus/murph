import os from 'node:os'
import { SETUP_RUNTIME_ENV_NOTICE } from '@murphai/operator-config/setup-runtime-env'
import {
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  resolveTelegramFileBaseUrl,
} from '@murphai/operator-config/telegram-runtime'
import type { InboxConnectorConfig } from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  CoreRuntimeModule,
  InboxAppEnvironment,
  ImportersFactoryRuntimeModule,
  InboxServicesDependencies,
  InboxRuntimeModule,
  ParsersRuntimeModule,
  TelegramDriver,
} from './types.js'
import { loadQueryRuntime } from '@murphai/vault-usecases/runtime'
import { loadRuntimeModule } from '../runtime-import.js'

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

  const enableAssistantAutoReplyChannel =
    dependencies.enableAssistantAutoReplyChannel ??
    (async () => false)

  return {
    clock,
    getPid,
    getPlatform,
    getHomeDirectory,
    killProcess,
    sleep,
    getEnvironment,
    usesInjectedTelegramDriver: Boolean(dependencies.loadTelegramDriver),
    loadCore,
    loadImporters,
    loadInbox,
    loadParsers,
    loadQuery,
    requireParsers,
    loadConfiguredTelegramDriver,
    enableAssistantAutoReplyChannel,
    journalPromotionEnabled:
      dependencies.enableJournalPromotion ?? dependencies.loadCoreModule === undefined,
  }
}
