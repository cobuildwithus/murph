import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  CoreRuntimeModule,
  InboxAppEnvironment,
  ImportersFactoryRuntimeModule,
  InboxServicesDependencies,
  InboxRuntimeModule,
  ParsersRuntimeModule,
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

  return {
    clock,
    loadCore,
    loadImporters,
    loadInbox,
    loadParsers,
    loadQuery,
    requireParsers,
    journalPromotionEnabled:
      dependencies.enableJournalPromotion ?? dependencies.loadCoreModule === undefined,
  }
}
