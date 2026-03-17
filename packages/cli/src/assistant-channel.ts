import {
  assistantChannelDeliverySchema,
  assistantDeliverResultSchema,
} from './assistant-cli-contracts.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant-state.js'
import { VaultCliError } from './vault-cli-errors.js'

export interface DeliverAssistantMessageInput {
  alias?: string | null
  channel?: string | null
  identityId?: string | null
  message: string
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  target?: string | null
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
  const explicitTarget = normalizeNullableString(input.target)
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    participantId:
      normalizeNullableString(input.participantId) ??
      (explicitTarget && !normalizeNullableString(input.sourceThreadId)
        ? explicitTarget
        : null),
    sourceThreadId: input.sourceThreadId,
  })

  const channel =
    normalizeNullableString(input.channel) ?? resolved.session.channel ?? null
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REQUIRED',
      'Outbound delivery requires a mapped channel. Pass --channel or resume a session with channel metadata.',
    )
  }

  const delivery = await deliverOverChannel(
    {
      channel,
      explicitTarget,
      message: normalizedMessage,
      participantId:
        normalizeNullableString(input.participantId) ??
        resolved.session.participantId,
      sourceThreadId:
        normalizeNullableString(input.sourceThreadId) ??
        resolved.session.sourceThreadId,
    },
    dependencies,
  )

  const updatedSession = await saveAssistantSession(input.vault, {
    ...resolved.session,
    channel,
    updatedAt: delivery.sentAt,
    lastTurnAt: delivery.sentAt,
    participantId:
      normalizeNullableString(input.participantId) ??
      resolved.session.participantId,
    sourceThreadId:
      normalizeNullableString(input.sourceThreadId) ??
      resolved.session.sourceThreadId,
    lastAssistantMessage: normalizedMessage,
  })

  return assistantDeliverResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    message: normalizedMessage,
    session: updatedSession,
    delivery,
  })
}

export function resolveImessageDeliveryCandidates(input: {
  explicitTarget?: string | null
  participantId?: string | null
  sourceThreadId?: string | null
}): Array<{ kind: 'explicit' | 'participant' | 'source-thread'; target: string }> {
  const explicitTarget = normalizeNullableString(input.explicitTarget)
  const participantId = normalizeNullableString(input.participantId)
  const sourceThreadId = normalizeNullableString(input.sourceThreadId)
  const candidates: Array<{
    kind: 'explicit' | 'participant' | 'source-thread'
    target: string
  }> = []

  if (explicitTarget) {
    candidates.push({
      kind: 'explicit',
      target: explicitTarget,
    })
  }

  if (!explicitTarget) {
    if (participantId && shouldPreferParticipantTarget(sourceThreadId)) {
      candidates.push({
        kind: 'participant',
        target: participantId,
      })
    }

    if (sourceThreadId) {
      candidates.push({
        kind: 'source-thread',
        target: sourceThreadId,
      })
    }

    if (participantId && !shouldPreferParticipantTarget(sourceThreadId)) {
      candidates.push({
        kind: 'participant',
        target: participantId,
      })
    }
  }

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.target)) {
      return false
    }

    seen.add(candidate.target)
    return true
  })
}

async function deliverOverChannel(
  input: {
    channel: string
    explicitTarget: string | null
    message: string
    participantId: string | null
    sourceThreadId: string | null
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
    explicitTarget: string | null
    message: string
    participantId: string | null
    sourceThreadId: string | null
  },
  dependencies: AssistantChannelDependencies,
) {
  const sendImessage = dependencies.sendImessage ?? sendImessageMessage
  const candidates = resolveImessageDeliveryCandidates({
    explicitTarget: input.explicitTarget,
    participantId: input.participantId,
    sourceThreadId: input.sourceThreadId,
  })

  if (candidates.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires a participant, source thread, or explicit target.',
    )
  }

  const failures: string[] = []

  for (const candidate of candidates) {
    try {
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
    } catch (error) {
      failures.push(`${candidate.kind}=${candidate.target}: ${errorMessage(error)}`)
    }
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_DELIVERY_FAILED',
    `Unable to deliver the iMessage. ${failures.join(' | ')}`,
  )
}

export async function sendImessageMessage(input: {
  message: string
  target: string
}): Promise<void> {
  const specifier = '@photon-ai/imessage-kit'
  let module: Record<string, unknown>

  try {
    module = (await import(specifier)) as Record<string, unknown>
  } catch (error) {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      'Outbound iMessage delivery requires @photon-ai/imessage-kit to be installed where vault-cli runs.',
      {
        cause: errorMessage(error),
      },
    )
  }

  const IMessageSDK = module.IMessageSDK
  if (typeof IMessageSDK !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      '@photon-ai/imessage-kit did not expose the expected IMessageSDK constructor.',
    )
  }

  const sdk = new (IMessageSDK as new () => {
    close?: () => Promise<void> | void
    send?: (target: string, content: string) => Promise<unknown>
  })()

  if (typeof sdk.send !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      '@photon-ai/imessage-kit did not expose the expected send() method on IMessageSDK.',
    )
  }

  try {
    await sdk.send(input.target, input.message)
  } finally {
    await sdk.close?.()
  }
}

function shouldPreferParticipantTarget(sourceThreadId: string | null): boolean {
  if (!sourceThreadId) {
    return true
  }

  const lower = sourceThreadId.toLowerCase()
  return !lower.startsWith('chat') && !lower.includes('chat')
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = normalizeNullableString(value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'invalid_payload',
    `${fieldName} must be a non-empty string.`,
  )
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}
