import { z } from 'zod'

import { normalizeNullableString } from './shared.js'

const codexRolloutRelativePathPattern =
  /^sessions\/(\d{4})\/(\d{2})\/(\d{2})\/rollout-(\d{4})-(\d{2})-(\d{2})T[^/]+-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jsonl$/u

export const codexResumeStateSchema = z
  .object({
    rolloutRelativePath: z.string().min(1).nullable().optional(),
    routeFingerprint: z.string().min(1).nullable().default(null),
    threadId: z.string().min(1),
  })
  .strict()

export type CodexResumeState = z.infer<typeof codexResumeStateSchema>

export function normalizeCodexRolloutRelativePath(
  value: unknown,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\\')
  ) {
    return null
  }

  const segments = normalized.split('/')
  if (segments.some((segment) =>
    segment.length === 0 || segment === '.' || segment === '..',
  )) {
    return null
  }

  const match = codexRolloutRelativePathPattern.exec(normalized)
  if (
    !match ||
    match[1] !== match[4] ||
    match[2] !== match[5] ||
    match[3] !== match[6]
  ) {
    return null
  }

  return normalized
}

export function normalizeCodexResumeState(value: unknown): CodexResumeState | null {
  const record = readRecord(value)
  if (!record) {
    return null
  }

  const threadId =
    normalizeUnknownString(record.threadId) ??
    normalizeUnknownString(record.providerSessionId)
  if (!threadId) {
    return null
  }

  const routeFingerprint =
    normalizeUnknownString(record.routeFingerprint) ??
    normalizeUnknownString(record.resumeRouteId)
  const rolloutRelativePath =
    normalizeCodexRolloutRelativePath(record.rolloutRelativePath) ??
    normalizeCodexRolloutRelativePath(record.codexRolloutRelativePath)

  return codexResumeStateSchema.parse({
    threadId,
    routeFingerprint,
    ...(rolloutRelativePath ? { rolloutRelativePath } : {}),
  })
}

export function buildCodexResumeState(input: {
  rolloutRelativePath?: string | null
  routeFingerprint: string | null | undefined
  threadId: string | null | undefined
}): CodexResumeState | null {
  const threadId = normalizeNullableString(input.threadId)
  if (!threadId) {
    return null
  }

  const routeFingerprint = normalizeNullableString(input.routeFingerprint)
  const rolloutRelativePath = normalizeCodexRolloutRelativePath(
    input.rolloutRelativePath,
  )

  return codexResumeStateSchema.parse({
    threadId,
    routeFingerprint,
    ...(rolloutRelativePath ? { rolloutRelativePath } : {}),
  })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeUnknownString(value: unknown): string | null {
  return normalizeNullableString(typeof value === 'string' ? value : null)
}
