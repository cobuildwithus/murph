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
  const download =
    typeof item === 'string' ? false : Boolean(item?.download)
  const behaviorButton =
    typeof item === 'string' ? false : Boolean(item?.behaviorButton)
  const insideAssistantMessage =
    typeof item === 'string' ? false : Boolean(item?.insideAssistantMessage)
  const hrefLabel = deriveHrefLabel(href)

  if (isChatConversationHref(href)) {
    return false
  }

  return (
    download ||
    (behaviorButton &&
      insideAssistantMessage &&
      PATCH_BUTTON_TEXT_PATTERN.test(text)) ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(text) ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(href) ||
    DOWNLOADABLE_ATTACHMENT_FILE_PATTERN.test(hrefLabel) ||
    THREAD_ATTACHMENT_KEYWORD_PATTERN.test(text)
  )
}

export function filterThreadAttachmentCandidates(items) {
  return (items ?? []).filter((item) => isThreadAttachmentCandidate(item))
}

export function collectPatchArtifactLabels(items) {
  const candidates = filterThreadAttachmentCandidates(items).filter((item) => {
    const label = deriveAttachmentLabel(item)
    const href = String(item?.href ?? '')
    const isAssistantDownloadControl =
      Boolean(item?.download) &&
      Boolean(item?.insideAssistantMessage)
    if (label.length === 0 && !isAssistantDownloadControl) {
      return false
    }
    if (
      PATCH_ARTIFACT_LABEL_PATTERN.test(label) ||
      PATCH_ARTIFACT_LABEL_PATTERN.test(href)
    ) {
      return true
    }
    if (isAssistantDownloadControl) {
      return true
    }
    return Boolean(item?.behaviorButton) && PATCH_BUTTON_TEXT_PATTERN.test(label)
  })

  const preferredAssistantPatchButtons = candidates.filter(
    (item) =>
      Boolean(item?.behaviorButton) &&
      Boolean(item?.insideAssistantMessage) &&
      PATCH_BUTTON_TEXT_PATTERN.test(deriveAttachmentLabel(item)),
  )
  const downloadablePatchFiles = candidates.filter((item) => {
    const label = deriveAttachmentLabel(item)
    return (
      (
        PATCH_ARTIFACT_LABEL_PATTERN.test(label) ||
        PATCH_ARTIFACT_LABEL_PATTERN.test(String(item?.href ?? '')) ||
        (Boolean(item?.download) && Boolean(item?.insideAssistantMessage))
      ) &&
      (
        Boolean(item?.download) ||
        Boolean(item?.href) ||
        Boolean(item?.insideAssistantMessage)
      )
    )
  })
  const selectedItems =
    preferredAssistantPatchButtons.length > 0
      ? [...preferredAssistantPatchButtons, ...downloadablePatchFiles]
      : candidates

  return [
    ...new Set(
      selectedItems
        .map((item) => deriveAttachmentLabel(item))
        .filter((label) => label.length > 0),
    ),
  ]
}
