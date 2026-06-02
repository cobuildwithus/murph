const ASSISTANT_ATTACHMENT_ARTIFACT_PATH_MAX_LENGTH = 1024

export const ASSISTANT_RAW_ATTACHMENT_ARTIFACT_PATH_PREFIXES = [
  'raw/inbox/',
] as const

export const ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES = [
  'derived/inbox/',
] as const

export function normalizeAssistantAttachmentArtifactPath(
  value: string | null | undefined,
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (
    trimmed.length === 0 ||
    trimmed.length > ASSISTANT_ATTACHMENT_ARTIFACT_PATH_MAX_LENGTH ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    /[\u0000-\u001F\u007F]/u.test(trimmed) ||
    /[{}"'<>]/u.test(trimmed) ||
    /[a-z][a-z0-9+.-]*:/iu.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/u.test(trimmed) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)
  ) {
    return null
  }

  const normalized = trimmed
    .replace(/\/+/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/+$/u, '')
  if (normalized.length === 0) {
    return null
  }

  const segments = normalized.split('/')
  if (
    segments.some((segment) =>
      segment.length === 0 ||
      segment === '.' ||
      segment === '..'
    )
  ) {
    return null
  }

  return normalized
}

export function normalizeAllowedAssistantAttachmentArtifactPath(
  value: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | null {
  const normalized = normalizeAssistantAttachmentArtifactPath(value)
  if (!normalized) {
    return null
  }

  return allowedPrefixes.some((prefix) => normalized.startsWith(prefix))
    ? normalized
    : null
}

export function normalizeAssistantRawAttachmentArtifactPath(
  value: string | null | undefined,
): string | null {
  return normalizeAllowedAssistantAttachmentArtifactPath(
    value,
    ASSISTANT_RAW_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
  )
}

export function normalizeAssistantDerivedAttachmentArtifactPath(
  value: string | null | undefined,
): string | null {
  return normalizeAllowedAssistantAttachmentArtifactPath(
    value,
    ASSISTANT_DERIVED_ATTACHMENT_ARTIFACT_PATH_PREFIXES,
  )
}
