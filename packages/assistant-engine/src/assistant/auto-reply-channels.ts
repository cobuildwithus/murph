import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import { updateAssistantAutomationState } from './store.js'
import {
  normalizeAssistantAutoReplyChannels,
  sameAssistantAutoReplyState,
} from './automation-state.js'
import {
  type AssistantInputCandidate,
  type AssistantInputSource,
} from './input-source.js'
import {
  readLatestAssistantInputCursor,
  type AssistantInputCursor,
} from './input-store.js'

type AssistantAutoReplyEntry = AssistantAutomationState['autoReply'][number]
const LATEST_ASSISTANT_INPUT_PAGE_LIMIT = 100

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
  eligibleAfter: AssistantInputCursor | null
  enabledAt: string
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
    return existing ?? {
      channel,
      eligibleAfter: input.eligibleAfter,
      enabledAt: input.enabledAt,
    }
  })

  return [...preservedEntries, ...managedEntries].sort(compareAssistantAutoReplyEntry)
}

export async function readLatestAssistantInputSourceCursor(input: {
  inputSource?: AssistantInputSource
  signal?: AbortSignal
  vault: string
}): Promise<AssistantInputCursor | null> {
  if (!input.inputSource) {
    return await readLatestAssistantInputCursor({
      vault: input.vault,
    })
  }

  const inputSource = input.inputSource
  let afterCursor: AssistantInputCandidate['event']['cursor'] | null = null
  let latestCandidate: AssistantInputCandidate | null = null

  for (;;) {
    const listed = await inputSource.listInputCandidates({
      afterCursor,
      limit: LATEST_ASSISTANT_INPUT_PAGE_LIMIT,
      signal: input.signal,
    })
    const latest = listed.inputs.at(-1)
    if (latest) {
      latestCandidate = latest
    }
    if (!listed.nextCursor || listed.inputs.length === 0) {
      break
    }
    afterCursor = listed.nextCursor
  }

  return latestCandidate
    ? latestCandidate.event.cursor
    : null
}

async function resolveManagedAssistantAutoReplyState(input: {
  desiredChannels: readonly string[]
  hasExplicitLatestInputCursor: boolean
  inputSource?: AssistantInputSource
  isManagedChannel?: (channel: string) => boolean
  latestInputCursor?: AssistantInputCursor | null
  signal?: AbortSignal
  state: AssistantAutomationState
  vault: string
}): Promise<{
  changed: boolean
  state: AssistantAutomationState
}> {
  const currentAutoReply = 'autoReply' in input.state ? input.state.autoReply : []
  const needsCursorSeed = managedAssistantAutoReplyChannelsNeedCursorSeed({
    current: currentAutoReply,
    desiredChannels: input.desiredChannels,
    isManagedChannel: input.isManagedChannel,
  })
  const nextReplyCursor = needsCursorSeed
    ? input.hasExplicitLatestInputCursor
      ? (input.latestInputCursor ?? null)
      : await readLatestAssistantInputSourceCursor({
          inputSource: input.inputSource,
          signal: input.signal,
          vault: input.vault,
        })
    : null
  const enabledAt =
    nextReplyCursor?.createdAt ??
    nextReplyCursor?.occurredAt ??
    new Date().toISOString()
  const nextAutoReply = reconcileManagedAssistantAutoReplyChannels({
    current: currentAutoReply,
    desiredChannels: input.desiredChannels,
    eligibleAfter: nextReplyCursor,
    enabledAt,
    isManagedChannel: input.isManagedChannel,
  })

  if (sameAssistantAutoReplyState(currentAutoReply, nextAutoReply)) {
    return {
      changed: false,
      state: input.state,
    }
  }

  return {
    changed: true,
    state: {
      ...input.state,
      autoReply: nextAutoReply,
      updatedAt: new Date().toISOString(),
    },
  }
}

export async function reconcileManagedAssistantAutoReplyChannelsLocal(input: {
  desiredChannels: readonly string[]
  inputSource?: AssistantInputSource
  isManagedChannel?: (channel: string) => boolean
  latestInputCursor?: AssistantInputCursor | null
  signal?: AbortSignal
  vault: string
}): Promise<{
  changed: boolean
  state: AssistantAutomationState
}> {
  const hasExplicitLatestInputCursor = Object.prototype.hasOwnProperty.call(
    input,
    'latestInputCursor',
  )

  let changed = false
  const state = await updateAssistantAutomationState(input.vault, async (state) => {
    const resolved = await resolveManagedAssistantAutoReplyState({
      desiredChannels: input.desiredChannels,
      hasExplicitLatestInputCursor,
      inputSource: input.inputSource,
      isManagedChannel: input.isManagedChannel,
      latestInputCursor: input.latestInputCursor,
      signal: input.signal,
      state,
      vault: input.vault,
    })
    changed = resolved.changed
    return resolved.state
  })

  return {
    changed,
    state,
  }
}

export async function enableAssistantAutoReplyChannelLocal(input: {
  channel: string
  inputSource?: AssistantInputSource
  isManagedChannel?: (channel: string) => boolean
  latestInputCursor?: AssistantInputCursor | null
  signal?: AbortSignal
  vault: string
}): Promise<boolean> {
  const hasExplicitLatestInputCursor = Object.prototype.hasOwnProperty.call(
    input,
    'latestInputCursor',
  )

  const isManagedChannel = input.isManagedChannel ?? defaultManagedChannelPredicate
  const state = await updateAssistantAutomationState(input.vault, async (state) => {
    const currentAutoReply = 'autoReply' in state ? state.autoReply : []
    const desiredChannels = normalizeAssistantAutoReplyChannels([
      ...currentAutoReply
        .filter((entry) => isManagedChannel(entry.channel))
        .map((entry) => entry.channel),
      input.channel,
    ])
    const resolved = await resolveManagedAssistantAutoReplyState({
      desiredChannels,
      hasExplicitLatestInputCursor,
      inputSource: input.inputSource,
      isManagedChannel,
      latestInputCursor: input.latestInputCursor,
      signal: input.signal,
      state,
      vault: input.vault,
    })
    return resolved.state
  })

  return state.autoReply.some((entry) => entry.channel === input.channel)
}
