import * as z from '@murphai/contracts/zod-runtime'

import {
  assistantSelfDeliveryTargetSchema,
  type AssistantSelfDeliveryTarget,
} from '../assistant-cli-contracts.js'

export interface AssistantSelfDeliveryTargetLookupInput {
  channel?: string | null
  deliveryTarget?: string | null
  identityId?: string | null
  participantId?: string | null
  threadId?: string | null
}

export type AssistantSelfDeliveryTargetMap = Record<
  string,
  AssistantSelfDeliveryTarget
>

export const assistantSelfDeliveryTargetMapSchema = z
  .record(z.string().min(1), assistantSelfDeliveryTargetSchema)
  .nullable()

type NormalizeOperatorConfigString = (
  value: string | null | undefined,
) => string | null

interface AssistantSelfDeliveryTargetDefaultsLike {
  selfDeliveryTargets?: AssistantSelfDeliveryTargetMap | null
}

interface AssistantSelfDeliveryTargetDependencies {
  normalizeString: NormalizeOperatorConfigString
  resolveDefaults: (
    homeDirectory: string,
  ) => Promise<AssistantSelfDeliveryTargetDefaultsLike | null>
  saveDefaultsPatch: (
    patch: {
      selfDeliveryTargets: AssistantSelfDeliveryTargetMap | null
    },
    homeDirectory: string,
  ) => Promise<unknown>
}

export async function listAssistantSelfDeliveryTargets(
  dependencies: AssistantSelfDeliveryTargetDependencies,
  homeDirectory: string,
): Promise<AssistantSelfDeliveryTarget[]> {
  const defaults = await dependencies.resolveDefaults(homeDirectory)
  return sortAssistantSelfDeliveryTargets(defaults?.selfDeliveryTargets ?? null)
}

export async function resolveAssistantSelfDeliveryTarget(
  channel: string,
  dependencies: AssistantSelfDeliveryTargetDependencies,
  homeDirectory: string,
): Promise<AssistantSelfDeliveryTarget | null> {
  const normalizedChannel = normalizeAssistantSelfDeliveryTargetChannel(
    channel,
    dependencies.normalizeString,
  )
  if (!normalizedChannel) {
    return null
  }

  const defaults = await dependencies.resolveDefaults(homeDirectory)
  return defaults?.selfDeliveryTargets?.[normalizedChannel] ?? null
}

export async function saveAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
  dependencies: AssistantSelfDeliveryTargetDependencies,
  homeDirectory: string,
): Promise<AssistantSelfDeliveryTarget> {
  const normalizedTarget = normalizeAssistantSelfDeliveryTarget(
    target,
    dependencies.normalizeString,
  )
  const existing = await dependencies.resolveDefaults(homeDirectory)
  const nextTargets = {
    ...(existing?.selfDeliveryTargets ?? {}),
    [normalizedTarget.channel]: normalizedTarget,
  }

  await dependencies.saveDefaultsPatch(
    {
      selfDeliveryTargets: nextTargets,
    },
    homeDirectory,
  )

  return normalizedTarget
}

export async function clearAssistantSelfDeliveryTargets(
  channel: string | null | undefined,
  dependencies: AssistantSelfDeliveryTargetDependencies,
  homeDirectory: string,
): Promise<string[]> {
  const existing = await dependencies.resolveDefaults(homeDirectory)
  const currentTargets = {
    ...(existing?.selfDeliveryTargets ?? {}),
  }
  const normalizedChannel =
    normalizeAssistantSelfDeliveryTargetChannel(
      channel,
      dependencies.normalizeString,
    ) ?? null

  if (normalizedChannel) {
    if (!currentTargets[normalizedChannel]) {
      return []
    }

    delete currentTargets[normalizedChannel]
    await dependencies.saveDefaultsPatch(
      {
        selfDeliveryTargets:
          Object.keys(currentTargets).length > 0 ? currentTargets : null,
      },
      homeDirectory,
    )
    return [normalizedChannel]
  }

  const clearedChannels = sortAssistantSelfDeliveryTargets(currentTargets).map(
    (target) => target.channel,
  )
  if (clearedChannels.length === 0) {
    return []
  }

  await dependencies.saveDefaultsPatch(
    {
      selfDeliveryTargets: null,
    },
    homeDirectory,
  )

  return clearedChannels
}

export async function applyAssistantSelfDeliveryTargetDefaults(
  input: AssistantSelfDeliveryTargetLookupInput,
  dependencies: AssistantSelfDeliveryTargetDependencies,
  options: {
    allowSingleSavedTargetFallback?: boolean
    includeEmailInSingleSavedTargetFallback?: boolean
  } | undefined,
  homeDirectory: string,
): Promise<AssistantSelfDeliveryTargetLookupInput> {
  const normalizedChannel =
    normalizeAssistantSelfDeliveryTargetChannel(
      input.channel,
      dependencies.normalizeString,
    ) ?? null
  const savedTarget = normalizedChannel
    ? await resolveAssistantSelfDeliveryTarget(
        normalizedChannel,
        dependencies,
        homeDirectory,
      )
    : options?.allowSingleSavedTargetFallback
      ? await resolveSingleAssistantSelfDeliveryTarget(
          dependencies,
          homeDirectory,
          options.includeEmailInSingleSavedTargetFallback ?? false,
        )
      : null

  if (!savedTarget) {
    return {
      channel: normalizedChannel,
      identityId: dependencies.normalizeString(input.identityId),
      participantId: dependencies.normalizeString(input.participantId),
      threadId: dependencies.normalizeString(input.threadId),
      deliveryTarget: dependencies.normalizeString(input.deliveryTarget),
    }
  }

  return {
    channel: normalizedChannel ?? savedTarget.channel,
    identityId:
      dependencies.normalizeString(input.identityId) ??
      savedTarget.identityId ??
      null,
    participantId:
      dependencies.normalizeString(input.participantId) ??
      savedTarget.participantId ??
      null,
    threadId:
      dependencies.normalizeString(input.threadId) ??
      savedTarget.threadId ??
      null,
    deliveryTarget:
      dependencies.normalizeString(input.deliveryTarget) ??
      savedTarget.deliveryTarget ??
      null,
  }
}

export function normalizeAssistantSelfDeliveryTargetMap(
  targets: AssistantSelfDeliveryTargetMap | null,
  normalizeString: NormalizeOperatorConfigString,
): AssistantSelfDeliveryTargetMap | null {
  if (!targets || Object.keys(targets).length === 0) {
    return null
  }

  return Object.fromEntries(
    Object.values(targets).map((target) => {
      const normalized = normalizeAssistantSelfDeliveryTarget(
        target,
        normalizeString,
      )
      return [normalized.channel, normalized]
    }),
  )
}

export function normalizeAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
  normalizeString: NormalizeOperatorConfigString,
): AssistantSelfDeliveryTarget {
  const channel = normalizeAssistantSelfDeliveryTargetChannel(
    target.channel,
    normalizeString,
  )
  if (!channel) {
    throw new Error('Assistant self delivery targets require a channel.')
  }

  return assistantSelfDeliveryTargetSchema.parse({
    channel,
    identityId: normalizeString(target.identityId),
    participantId: normalizeString(target.participantId),
    threadId: normalizeString(target.threadId),
    deliveryTarget: normalizeString(target.deliveryTarget),
  })
}

export function sortAssistantSelfDeliveryTargets(
  targets: AssistantSelfDeliveryTargetMap | null,
): AssistantSelfDeliveryTarget[] {
  return Object.values(targets ?? {}).sort((left, right) =>
    left.channel.localeCompare(right.channel),
  )
}

export function normalizeUnknownAssistantSelfDeliveryTargets(
  value: unknown,
  normalizeString: NormalizeOperatorConfigString,
): AssistantSelfDeliveryTargetMap | null {
  const parsed = assistantSelfDeliveryTargetMapSchema.safeParse(value)
  return parsed.success
    ? normalizeAssistantSelfDeliveryTargetMap(parsed.data, normalizeString)
    : null
}

async function resolveSingleAssistantSelfDeliveryTarget(
  dependencies: AssistantSelfDeliveryTargetDependencies,
  homeDirectory: string,
  includeEmail: boolean,
): Promise<AssistantSelfDeliveryTarget | null> {
  const targets = (await listAssistantSelfDeliveryTargets(
    dependencies,
    homeDirectory,
  )).filter((target) => includeEmail || target.channel !== 'email')
  return targets.length === 1 ? targets[0] ?? null : null
}

function normalizeAssistantSelfDeliveryTargetChannel(
  channel: string | null | undefined,
  normalizeString: NormalizeOperatorConfigString,
): string | null {
  const normalized = normalizeString(channel)?.toLowerCase() ?? null
  return normalized
    ? normalizeAssistantSelfDeliveryTargetChannelAlias(normalized)
    : null
}

function normalizeAssistantSelfDeliveryTargetChannelAlias(
  channel: string,
): string {
  switch (channel) {
    case 'imessage':
    case 'i-message':
      return 'linq'
    default:
      return channel
  }
}
