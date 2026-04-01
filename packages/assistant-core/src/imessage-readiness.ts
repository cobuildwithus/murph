import path from 'node:path'
import { openSqliteRuntimeDatabase } from '@murphai/runtime-state/node'
import { normalizeNullableString } from './assistant/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

export const IMESSAGE_MESSAGES_DB_DISPLAY_PATH = '~/Library/Messages/chat.db'
export const IMESSAGE_MESSAGES_DB_RELATIVE_PATH = [
  'Library',
  'Messages',
  'chat.db',
] as const

export interface ImessageMessagesDbDependencies {
  homeDirectory?: string | null
  platform?: NodeJS.Platform
  probeMessagesDb?: (targetPath: string) => Promise<void>
}

export async function ensureImessageMessagesDbReadable(
  dependencies: ImessageMessagesDbDependencies,
  input: {
    unavailableCode: string
    unavailableMessage: string
    permissionCode: string
    permissionMessage: string
  },
): Promise<void> {
  const platform = dependencies.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new VaultCliError(input.unavailableCode, input.unavailableMessage)
  }

  const homeDirectory = normalizeNullableString(
    dependencies.homeDirectory ?? process.env.HOME,
  )
  if (!homeDirectory) {
    throw new VaultCliError(
      input.unavailableCode,
      `Could not resolve ${IMESSAGE_MESSAGES_DB_DISPLAY_PATH} because HOME is not set.`,
    )
  }

  const messagesDbPath = path.join(
    homeDirectory,
    ...IMESSAGE_MESSAGES_DB_RELATIVE_PATH,
  )

  try {
    await (dependencies.probeMessagesDb ?? probeImessageMessagesDb)(
      messagesDbPath,
    )
  } catch (error) {
    throw createImessageMessagesDbAccessError(error, {
      code: input.permissionCode,
      message: input.permissionMessage,
    })
  }
}

export async function probeImessageMessagesDb(
  targetPath: string,
): Promise<void> {
  const database = openSqliteRuntimeDatabase(targetPath, {
    create: false,
    foreignKeys: false,
    readOnly: true,
  })

  try {
    database.prepare('SELECT 1').get()
  } finally {
    database.close()
  }
}

export function mapImessageMessagesDbRuntimeError(
  error: unknown,
  input: {
    permissionCode: string
    permissionMessage: string
    fallbackCode: string
    fallbackMessage: string
  },
): VaultCliError {
  if (isImessageMessagesDbError(error)) {
    return createImessageMessagesDbAccessError(error, {
      code: input.permissionCode,
      message: input.permissionMessage,
    })
  }

  return new VaultCliError(input.fallbackCode, input.fallbackMessage)
}

function createImessageMessagesDbAccessError(
  error: unknown,
  input: {
    code: string
    message: string
  },
): VaultCliError {
  return new VaultCliError(input.code, input.message, {
    causeCode: errorCode(error),
    reason: 'messages_db_unreadable',
    path: IMESSAGE_MESSAGES_DB_DISPLAY_PATH,
  })
}

function isImessageMessagesDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null
  if (code === 'DATABASE') {
    return true
  }

  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : String(error)
  return /authorization denied|unable to open database file|chat\.db/iu.test(
    message,
  )
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  return 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
}
