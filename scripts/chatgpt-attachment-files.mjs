const DOWNLOADABLE_ATTACHMENT_FILE_PATTERN = /\.(patch|diff|zip|txt|json|md|patched)\b/iu
const THREAD_ATTACHMENT_KEYWORD_PATTERN = /\b(?:archive|zip|file|download|attachment)\b/iu
const PATCH_ARTIFACT_LABEL_PATTERN = /(?:\.(?:patch|diff|zip)\b|\.patched\b)/iu
const PATCH_BUTTON_TEXT_PATTERN = /\b(?:patch|diff)\b/iu

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

function isChatConversationHref(href) {
  const normalizedHref = normalizeAttachmentValue(href)
  if (normalizedHref.length === 0) {
    return false
  }

  try {
    const url = new URL(normalizedHref, 'https://chatgpt.com')
    return /^\/c\/[^/]+$/u.test(url.pathname)
  } catch {
    return /^\/?c\/[^/]+$/u.test(normalizedHref)
  }
}

function deriveAttachmentLabelFromParts({ hrefLabel, text }) {
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

function normalizeAttachmentItem(item) {
  const isStringItem = typeof item === 'string'
  const text = normalizeAttachmentValue(isStringItem ? item : item?.text)
  const href = normalizeAttachmentValue(isStringItem ? '' : item?.href)
  const download = isStringItem ? false : Boolean(item?.download)
  const behaviorButton = isStringItem ? false : Boolean(item?.behaviorButton)
  const insideAssistantMessage = isStringItem ? false : Boolean(item?.insideAssistantMessage)
  const hrefLabel = deriveHrefLabel(href)
  const label = deriveAttachmentLabelFromParts({ hrefLabel, text })

  return {
    behaviorButton,
    download,
    href,
    hrefLabel,
    insideAssistantMessage,
    isAssistantDownloadControl: download && insideAssistantMessage,
    isAssistantPatchButton:
      behaviorButton &&
      insideAssistantMessage &&
      PATCH_BUTTON_TEXT_PATTERN.test(text),
    item,
    label,
    text,
  }
}

function isThreadAttachmentCandidateRecord(item) {
  if (isChatConversationHref(item.href)) {
    return false
  }

  return (
    item.download ||
    item.isAssistantPatchButton ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(item.text) ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(item.href) ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(item.hrefLabel) ||
    THREAD_ATTACHMENT_KEYWORD_PATTERN.test(item.text)
  )
}

function listNormalizedThreadAttachmentCandidates(items) {
  return (items ?? [])
    .map((item) => normalizeAttachmentItem(item))
    .filter((item) => isThreadAttachmentCandidateRecord(item))
}

function isPatchArtifactCandidate(item) {
  if (item.label.length === 0 && !item.isAssistantDownloadControl) {
    return false
  }

  return (
    PATCH_ARTIFACT_LABEL_PATTERN.test(item.label) ||
    PATCH_ARTIFACT_LABEL_PATTERN.test(item.href) ||
    item.isAssistantDownloadControl ||
    (item.behaviorButton && PATCH_BUTTON_TEXT_PATTERN.test(item.label))
  )
}

function isDownloadablePatchArtifact(item) {
  return (
    (
      PATCH_ARTIFACT_LABEL_PATTERN.test(item.label) ||
      PATCH_ARTIFACT_LABEL_PATTERN.test(item.href) ||
      item.isAssistantDownloadControl
    ) &&
    (
      item.download ||
      item.href.length > 0 ||
      item.insideAssistantMessage
    )
  )
}

export function deriveAttachmentLabel(item) {
  return normalizeAttachmentItem(item).label
}

export function isThreadAttachmentCandidate(item) {
  return isThreadAttachmentCandidateRecord(normalizeAttachmentItem(item))
}

export function filterThreadAttachmentCandidates(items) {
  return listNormalizedThreadAttachmentCandidates(items).map((item) => item.item)
}

export function collectPatchArtifactLabels(items) {
  const candidates = listNormalizedThreadAttachmentCandidates(items)
    .filter((item) => isPatchArtifactCandidate(item))
  const preferredAssistantPatchButtons = candidates.filter(
    (item) => item.isAssistantPatchButton,
  )
  const selectedItems =
    preferredAssistantPatchButtons.length > 0
      ? [
          ...preferredAssistantPatchButtons,
          ...candidates.filter((item) => isDownloadablePatchArtifact(item)),
        ]
      : candidates

  return [
    ...new Set(
      selectedItems
        .map((item) => item.label)
        .filter((label) => label.length > 0),
    ),
  ]
}
