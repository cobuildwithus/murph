import path from 'node:path'
import { IMessageSDK } from '@photon-ai/imessage-kit'
import { openSqliteRuntimeDatabase } from '@healthybob/runtime-state'
import {
  assistantChannelDeliverySchema,
  assistantDeliverResultSchema,
  type AssistantBindingDelivery,
} from './assistant-cli-contracts.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant/store.js'
import { errorMessage, normalizeNullableString, normalizeRequiredText } from './assistant/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const IMESSAGE_MESSAGES_DB_DISPLAY_PATH = '~/Library/Messages/chat.db'
const IMESSAGE_MESSAGES_DB_RELATIVE_PATH = ['Library', 'Messages', 'chat.db'] as const

interface ImessageSdkLike {
  close?: () => Promise<void> | void
  send?: (target: string, content: string) => Promise<unknown>
}

interface ImessageRuntimeDependencies {
  createSdk?: () => ImessageSdkLike
  homeDirectory?: string | null
  platform?: NodeJS.Platform
  probeMessagesDb?: (targetPath: string) => Promise<void>
}

export interface DeliverAssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  identityId?: string | null
  message: string
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  target?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantChannelDependencies {
  sendImessage?: (input: { message: string; target: string }) => Promise<void>
}

export async function deliverAssistantMessage(
  input: DeliverAssistantMessageInput,
  dependencies: AssistantChannelDependencies = {},
): Promise<ReturnType<typeof assistantDeliverResultSchema.parse>> {
  const normalizedMessage = normalizeRequiredText(input.message, 'message')
  const explicitTarget = input.target?.trim() ? input.target.trim() : null
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
  })

  const channel = input.channel?.trim() || resolved.session.binding.channel
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REQUIRED',
      'Outbound delivery requires a mapped channel. Pass --channel or resume a session with channel metadata.',
    )
  }

  const delivery = await deliverOverChannel(
    {
      bindingDelivery: resolved.session.binding.delivery,
      channel,
      explicitTarget,
      message: normalizedMessage,
    },
    dependencies,
  )

  const updatedSession = await saveAssistantSession(input.vault, {
    ...resolved.session,
    binding: {
      ...resolved.session.binding,
      channel,
    },
    updatedAt: delivery.sentAt,
    lastTurnAt: delivery.sentAt,
  })

  return assistantDeliverResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    message: normalizedMessage,
    session: updatedSession,
    delivery,
  })
}

export function resolveImessageDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): Array<{ kind: 'explicit' | 'participant' | 'thread'; target: string }> {
  const explicitTarget = input.explicitTarget?.trim() ? input.explicitTarget.trim() : null
  if (explicitTarget) {
    return [
      {
        kind: 'explicit',
        target: explicitTarget,
      },
    ]
  }

  if (!input.bindingDelivery) {
    return []
  }

  return [
    {
      kind: input.bindingDelivery.kind,
      target: input.bindingDelivery.target,
    },
  ]
}

async function deliverOverChannel(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    channel: string
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  switch (input.channel) {
    case 'imessage':
      return deliverImessage(input, dependencies)
    default:
      throw new VaultCliError(
        'ASSISTANT_CHANNEL_UNSUPPORTED',
        `Outbound delivery for channel "${input.channel}" is not supported in this build.`,
      )
  }
}

async function deliverImessage(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  const sendImessage = dependencies.sendImessage ?? sendImessageMessage
  const candidates = resolveImessageDeliveryCandidates({
    explicitTarget: input.explicitTarget,
    bindingDelivery: input.bindingDelivery,
  })

  if (candidates.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires an explicit target or a stored delivery binding.',
    )
  }

  const candidate = candidates[0]
  await sendImessage({
    target: candidate.target,
    message: input.message,
  })

  return assistantChannelDeliverySchema.parse({
    channel: 'imessage',
    target: candidate.target,
    targetKind: candidate.kind,
    sentAt: new Date().toISOString(),
    messageLength: input.message.length,
  })
}

export async function sendImessageMessage(input: {
  message: string
  target: string
}, dependencies: ImessageRuntimeDependencies = {}): Promise<void> {
  await ensureImessageMessagesDbReadable(dependencies)
  let sdk: ImessageSdkLike

  try {
    sdk = (dependencies.createSdk ?? (() => new IMessageSDK()))()
  } catch (error) {
    throw mapImessageRuntimeError(error)
  }

  if (typeof sdk.send !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      '@photon-ai/imessage-kit did not expose the expected send() method on IMessageSDK.',
    )
  }

  try {
    await sdk.send(input.target, input.message)
  } catch (error) {
    throw mapImessageRuntimeError(error)
  } finally {
    try {
      await sdk.close?.()
    } catch {}
  }
}

async function ensureImessageMessagesDbReadable(
  dependencies: ImessageRuntimeDependencies,
): Promise<void> {
  const platform = dependencies.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      'Outbound iMessage delivery requires macOS.',
    )
  }

  const homeDirectory = normalizeNullableString(
    dependencies.homeDirectory ?? process.env.HOME,
  )
  if (!homeDirectory) {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      `Outbound iMessage delivery could not resolve ${IMESSAGE_MESSAGES_DB_DISPLAY_PATH} because HOME is not set.`,
    )
  }

  const messagesDbPath = path.join(homeDirectory, ...IMESSAGE_MESSAGES_DB_RELATIVE_PATH)

  try {
    await (dependencies.probeMessagesDb ?? probeImessageMessagesDb)(messagesDbPath)
  } catch (error) {
    throw createImessageMessagesDbAccessError(error)
  }
}

async function probeImessageMessagesDb(targetPath: string): Promise<void> {
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

function mapImessageRuntimeError(error: unknown): VaultCliError {
  if (isImessageMessagesDbError(error)) {
    return createImessageMessagesDbAccessError(error)
  }

  return new VaultCliError(
    'ASSISTANT_IMESSAGE_DELIVERY_FAILED',
    'Outbound iMessage delivery failed inside @photon-ai/imessage-kit.',
  )
}

function createImessageMessagesDbAccessError(error: unknown): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
    `Outbound iMessage delivery requires read access to ${IMESSAGE_MESSAGES_DB_DISPLAY_PATH}. Grant Full Disk Access to the terminal or app running Healthy Bob, fully restart it, and retry.`,
    {
      causeCode: errorCode(error),
      reason: 'messages_db_unreadable',
      path: IMESSAGE_MESSAGES_DB_DISPLAY_PATH,
    },
  )
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

  const message = errorMessage(error)
  return /authorization denied|unable to open database file|chat\.db/iu.test(message)
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  return 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
}
