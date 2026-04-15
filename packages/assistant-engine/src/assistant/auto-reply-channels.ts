import type {
  AssistantAutomationCursor,
  AssistantAutomationState,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createIntegratedInboxServices, type InboxServices } from '@murphai/inbox-services'
import { readAssistantAutomationState, saveAssistantAutomationState } from './store.js'
import {
  normalizeAssistantAutoReplyChannels,
  sameAssistantAutoReplyState,
} from './automation-state.js'

type AssistantAutoReplyEntry = AssistantAutomationState['autoReply'][number]

function defaultManagedChannelPredicate(): boolean {
  return true
}

function compareAssistantAutoReplyEntry(
  left: AssistantAutoReplyEntry,
  right: AssistantAutoReplyEntry,
): number {
  return left.channel.localeCompare(right.channel)
}

export function managedAssistantAutoReplyChannelsNeedCursorSeed(input: {
  current: readonly AssistantAutoReplyEntry[]
  desiredChannels: readonly string[]
  isManagedChannel?: (channel: string) => boolean
}): boolean {
  const isManagedChannel = input.isManagedChannel ?? defaultManagedChannelPredicate
  const currentManagedChannels = new Set(
    input.current
      .filter((entry) => isManagedChannel(entry.channel))
      .map((entry) => entry.channel),
  )

  return normalizeAssistantAutoReplyChannels(input.desiredChannels).some(
    (channel) => !currentManagedChannels.has(channel),
  )
}

export function reconcileManagedAssistantAutoReplyChannels(input: {
  current: readonly AssistantAutoReplyEntry[]
  desiredChannels: readonly string[]
  latestCaptureCursor: AssistantAutomationCursor | null
  isManagedChannel?: (channel: string) => boolean
}): AssistantAutoReplyEntry[] {
  const desiredChannels = normalizeAssistantAutoReplyChannels(input.desiredChannels)
  const isManagedChannel = input.isManagedChannel ?? defaultManagedChannelPredicate
  const currentByChannel = new Map(
    input.current.map((entry) => [entry.channel, entry] as const),
  )
  const preservedEntries = input.current.filter(
    (entry) => !isManagedChannel(entry.channel),
  )
  const managedEntries = desiredChannels.map((channel) => {
    const existing = currentByChannel.get(channel)
    return existing ?? { channel, cursor: input.latestCaptureCursor }
  })

  return [...preservedEntries, ...managedEntries].sort(compareAssistantAutoReplyEntry)
}

export async function readLatestPersistedInboxCaptureCursor(
  vault: string,
  inboxServices: Pick<InboxServices, 'list'> = createIntegratedInboxServices(),
): Promise<AssistantAutomationCursor | null> {
  const latestCapture = (
    await inboxServices.list({
      afterCaptureId: null,
      afterOccurredAt: null,
      limit: 1,
      oldestFirst: false,
      requestId: null,
      sourceId: null,
      vault,
    })
  ).items[0]

  return latestCapture
    ? {
        captureId: latestCapture.captureId,
        occurredAt: latestCapture.occurredAt,
      }
    : null
}

export async function reconcileManagedAssistantAutoReplyChannelsLocal(input: {
  desiredChannels: readonly string[]
  inboxServices?: Pick<InboxServices, 'list'>
  isManagedChannel?: (channel: string) => boolean
  vault: string
}): Promise<{
  changed: boolean
  state: AssistantAutomationState
}> {
  const state = await readAssistantAutomationState(input.vault)
  const currentAutoReply = 'autoReply' in state ? state.autoReply : []
  const nextReplyCursor = managedAssistantAutoReplyChannelsNeedCursorSeed({
    current: currentAutoReply,
    desiredChannels: input.desiredChannels,
    isManagedChannel: input.isManagedChannel,
  })
    ? await readLatestPersistedInboxCaptureCursor(
        input.vault,
        input.inboxServices,
      )
    : null
  const nextAutoReply = reconcileManagedAssistantAutoReplyChannels({
    current: currentAutoReply,
    desiredChannels: input.desiredChannels,
    latestCaptureCursor: nextReplyCursor,
    isManagedChannel: input.isManagedChannel,
  })

  if (sameAssistantAutoReplyState(currentAutoReply, nextAutoReply)) {
    return {
      changed: false,
      state,
    }
  }

  return {
    changed: true,
    state: await saveAssistantAutomationState(input.vault, {
      ...state,
      autoReply: nextAutoReply,
      updatedAt: new Date().toISOString(),
    }),
  }
}

export async function enableAssistantAutoReplyChannelLocal(input: {
  channel: string
  inboxServices?: Pick<InboxServices, 'list'>
  isManagedChannel?: (channel: string) => boolean
  vault: string
}): Promise<boolean> {
  const state = await readAssistantAutomationState(input.vault)
  const currentAutoReply = 'autoReply' in state ? state.autoReply : []
  const isManagedChannel = input.isManagedChannel ?? defaultManagedChannelPredicate
  const result = await reconcileManagedAssistantAutoReplyChannelsLocal({
    desiredChannels: normalizeAssistantAutoReplyChannels([
      ...currentAutoReply
        .filter((entry) => isManagedChannel(entry.channel))
        .map((entry) => entry.channel),
      input.channel,
    ]),
    inboxServices: input.inboxServices,
    isManagedChannel,
    vault: input.vault,
  })

  return result.state.autoReply.some((entry) => entry.channel === input.channel)
}
