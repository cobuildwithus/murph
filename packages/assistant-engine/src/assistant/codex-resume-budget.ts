import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  normalizeCodexResumeState,
} from '@murphai/operator-config/assistant/codex-resume-state'
import type { AssistantProviderUsage } from './providers/types.js'
import { normalizeNullableString } from './shared.js'

export const HOSTED_ASSISTANT_CODEX_RESUME_MAX_INPUT_TOKENS = 18_000
export const HOSTED_ASSISTANT_CODEX_RESUME_MAX_ROLLOUT_BYTES = 32 * 1024

export type AssistantCodexResumeBudgetRejectReason =
  | 'missing-codex-home'
  | 'missing-rollout-file'
  | 'missing-rollout-path'
  | 'rollout-not-file'
  | 'rollout-path-outside-home'
  | 'rollout-thread-mismatch'
  | 'rollout-stat-failed'
  | 'rollout-too-large'

export interface AssistantCodexResumeBudgetInspection {
  rejectReason: AssistantCodexResumeBudgetRejectReason | null
  rolloutSizeBucket: string | null
  threadId: string | null
}

export async function inspectHostedAssistantCodexResumeBudget(input: {
  codexHome?: string | null
  maxRolloutBytes?: number
  resumeState: unknown
}): Promise<AssistantCodexResumeBudgetInspection> {
  const resumeState = normalizeCodexResumeState(input.resumeState)
  const threadId = resumeState?.threadId ?? null
  if (!resumeState) {
    return {
      rejectReason: null,
      rolloutSizeBucket: null,
      threadId: null,
    }
  }

  const rolloutRelativePath = normalizeNullableString(
    resumeState.rolloutRelativePath,
  )
  if (!rolloutRelativePath) {
    return {
      rejectReason: 'missing-rollout-path',
      rolloutSizeBucket: null,
      threadId,
    }
  }

  const codexHome = normalizeNullableString(input.codexHome)
  if (!codexHome) {
    return {
      rejectReason: 'missing-codex-home',
      rolloutSizeBucket: null,
      threadId,
    }
  }

  const homeRoot = path.resolve(codexHome)
  const rolloutPath = path.resolve(homeRoot, rolloutRelativePath)
  const relativeToHome = path.relative(homeRoot, rolloutPath)
  if (
    relativeToHome.length === 0 ||
    relativeToHome.startsWith('..') ||
    path.isAbsolute(relativeToHome)
  ) {
    return {
      rejectReason: 'rollout-path-outside-home',
      rolloutSizeBucket: null,
      threadId,
    }
  }
  if (!isHostedAssistantCodexRolloutPathBoundToThread({
    rolloutRelativePath,
    threadId,
  })) {
    return {
      rejectReason: 'rollout-thread-mismatch',
      rolloutSizeBucket: null,
      threadId,
    }
  }

  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(rolloutPath)
  } catch (error) {
    return {
      rejectReason: isMissingFileError(error)
        ? 'missing-rollout-file'
        : 'rollout-stat-failed',
      rolloutSizeBucket: null,
      threadId,
    }
  }

  const rolloutSizeBucket = bucketHostedAssistantCodexRolloutBytes(fileStat.size)
  if (!fileStat.isFile()) {
    return {
      rejectReason: 'rollout-not-file',
      rolloutSizeBucket,
      threadId,
    }
  }
  try {
    const realHomeRoot = await realpath(homeRoot)
    const realRolloutPath = await realpath(rolloutPath)
    if (!isPathInsideRoot(realRolloutPath, realHomeRoot)) {
      return {
        rejectReason: 'rollout-path-outside-home',
        rolloutSizeBucket,
        threadId,
      }
    }
  } catch {
    return {
      rejectReason: 'rollout-stat-failed',
      rolloutSizeBucket,
      threadId,
    }
  }

  const maxRolloutBytes =
    input.maxRolloutBytes ?? HOSTED_ASSISTANT_CODEX_RESUME_MAX_ROLLOUT_BYTES
  if (fileStat.size > maxRolloutBytes) {
    return {
      rejectReason: 'rollout-too-large',
      rolloutSizeBucket,
      threadId,
    }
  }

  return {
    rejectReason: null,
    rolloutSizeBucket,
    threadId,
  }
}

export function shouldClearHostedAssistantCodexResumeAfterUsage(input: {
  turnTrigger?: string | null
  usage?: AssistantProviderUsage | null
  hostedMemberId?: string | null
}): boolean {
  if (
    !normalizeNullableString(input.hostedMemberId) ||
    input.turnTrigger !== 'automation-auto-reply'
  ) {
    return false
  }

  const usageBudgetTokens = resolveHostedAssistantCodexUsageBudgetTokens(
    input.usage ?? null,
  )
  if (usageBudgetTokens === null) {
    return true
  }

  return usageBudgetTokens > HOSTED_ASSISTANT_CODEX_RESUME_MAX_INPUT_TOKENS
}

function bucketHostedAssistantCodexRolloutBytes(bytes: number): string {
  if (bytes <= 32 * 1024) {
    return '0-32kb'
  }
  if (bytes <= 64 * 1024) {
    return '33-64kb'
  }
  if (bytes <= 128 * 1024) {
    return '65-128kb'
  }
  if (bytes <= 512 * 1024) {
    return '129-512kb'
  }
  return '513kb+'
}

function resolveHostedAssistantCodexUsageBudgetTokens(
  usage: AssistantProviderUsage | null,
): number | null {
  if (!usage) {
    return null
  }

  const explicitTotal = normalizeFiniteTokenCount(usage.totalTokens)
  const knownTokenCounts = [
    normalizeFiniteTokenCount(usage.inputTokens),
    normalizeFiniteTokenCount(usage.outputTokens),
    normalizeFiniteTokenCount(usage.reasoningTokens),
    normalizeFiniteTokenCount(usage.cacheWriteTokens),
    normalizeFiniteTokenCount(usage.cachedInputTokens),
  ].filter((value): value is number => value !== null)

  if (explicitTotal !== null) {
    return Math.max(explicitTotal, ...knownTokenCounts)
  }

  if (knownTokenCounts.length === 0) {
    return null
  }

  return knownTokenCounts.reduce((sum, value) => sum + value, 0)
}

function normalizeFiniteTokenCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : null
}

function isHostedAssistantCodexRolloutPathBoundToThread(input: {
  rolloutRelativePath: string
  threadId: string | null
}): boolean {
  const threadId = normalizeNullableString(input.threadId)
  if (!threadId) {
    return false
  }

  const basename = path.basename(input.rolloutRelativePath)
  if (!basename.endsWith('.jsonl')) {
    return false
  }

  const basenameWithoutExtension = basename.slice(0, -'.jsonl'.length)
  return basenameWithoutExtension === threadId ||
    basenameWithoutExtension.endsWith(`-${threadId}`)
}

function isPathInsideRoot(childPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, childPath)
  return relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error &&
    'code' in error &&
    Reflect.get(error, 'code') === 'ENOENT'
}
