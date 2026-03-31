const DOWNLOADABLE_ATTACHMENT_FILE_PATTERN = /\.(patch|diff|zip|txt|json|md|patched)\b/iu
const THREAD_ATTACHMENT_KEYWORD_PATTERN = /patch|diff|archive|zip|file|download/iu
const PATCH_ARTIFACT_LABEL_PATTERN = /(?:\.(?:patch|diff)\b|\.patched\b)/iu

function normalizeAttachmentValue(value) {
  return String(value ?? '').trim()
}

function deriveHrefLabel(href) {
  const normalizedHref = normalizeAttachmentValue(href)

  if (normalizedHref.length === 0) {
    return ''
  }

  try {
    const pathname = new URL(normalizedHref).pathname
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '')
  } catch {
    return decodeURIComponent(normalizedHref.split('/').filter(Boolean).at(-1) ?? '')
  }
}

export function deriveAttachmentLabel(item) {
  const text = normalizeAttachmentValue(
    typeof item === 'string' ? item : item?.text,
  )
  const hrefLabel = deriveHrefLabel(typeof item === 'string' ? '' : item?.href)

  if (
    hrefLabel.length > 0 &&
    PATCH_ARTIFACT_LABEL_PATTERN.test(hrefLabel) &&
    !PATCH_ARTIFACT_LABEL_PATTERN.test(text)
  ) {
    return hrefLabel
  }

  if (text.length > 0) {
    return text
  }

  return hrefLabel
}

export function isThreadAttachmentCandidate(item) {
  const text = normalizeAttachmentValue(
    typeof item === 'string' ? item : item?.text,
  )
  const href = normalizeAttachmentValue(
    typeof item === 'string' ? '' : item?.href,
  )

  return (
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(text) ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(href) ||
    THREAD_ATTACHMENT_KEYWORD_PATTERN.test(text)
  )
}

export function filterThreadAttachmentCandidates(items) {
  return (items ?? []).filter((item) => isThreadAttachmentCandidate(item))
}

export function collectPatchArtifactLabels(items) {
  return [
    ...new Set(
      filterThreadAttachmentCandidates(items)
        .map((item) => deriveAttachmentLabel(item))
        .filter(
          (label) =>
            label.length > 0 && PATCH_ARTIFACT_LABEL_PATTERN.test(label),
        ),
    ),
  ]
}
