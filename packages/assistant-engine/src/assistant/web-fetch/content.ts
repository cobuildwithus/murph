import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantWebFetchExtractMode,
  AssistantWebFetchResponse,
} from './config.js'
import {
  cancelAssistantWebResponseBody,
  readAssistantWebResponseText,
} from './response.js'
import { extractAssistantWebHtml } from './html.js'

export async function extractAssistantWebResponse(input: {
  contentType: string | null
  extractMode: AssistantWebFetchExtractMode
  finalUrl: URL
  maxChars: number
  maxResponseBytes: number
  response: Response
}): Promise<{
  extractor: AssistantWebFetchResponse['extractor']
  text: string
  title: string | null
  truncated: boolean
  warnings: string[]
}> {
  if (isAssistantWebPdfContentType(input.contentType)) {
    await cancelAssistantWebResponseBody(input.response)
    throw new VaultCliError(
      'WEB_FETCH_PDF_UNSUPPORTED',
      'web.fetch does not parse PDFs. Use web.pdf.read for PDF content.',
    )
  }

  if (isAssistantWebLikelyBinaryContentType(input.contentType)) {
    await cancelAssistantWebResponseBody(input.response)
    throw new VaultCliError(
      'WEB_FETCH_CONTENT_TYPE_UNSUPPORTED',
      `web.fetch cannot extract readable text from ${input.contentType}.`,
    )
  }

  const responseText = await readAssistantWebResponseText({
    response: input.response,
    maxResponseBytes: input.maxResponseBytes,
  })
  const warnings = [...responseText.warnings]

  let title: string | null = null
  let text = responseText.text
  let extractor: AssistantWebFetchResponse['extractor'] = 'raw-text'

  if (isAssistantWebHtmlContentType(input.contentType)) {
    const extractedHtml = extractAssistantWebHtml({
      baseUrl: input.finalUrl,
      extractMode: input.extractMode,
      html: responseText.text,
    })
    title = extractedHtml.title
    text = extractedHtml.text
    extractor = extractedHtml.extractor
    warnings.push(...extractedHtml.warnings)
  } else if (isAssistantWebJsonContentType(input.contentType)) {
    extractor = 'json'
    const normalizedJson = normalizeAssistantWebJsonText(responseText.text)
    text = normalizedJson.text
    warnings.push(...normalizedJson.warnings)
  }

  const truncated = responseText.truncated
  const bounded = truncateAssistantWebText(text, input.maxChars)
  if (bounded.truncated) {
    warnings.push(
      `Trimmed extracted content to ${input.maxChars} characters for model safety.`,
    )
  }

  return {
    extractor,
    title,
    text: bounded.text,
    truncated: truncated || bounded.truncated,
    warnings,
  }
}

export function truncateAssistantWebText(input: string, maxChars: number): {
  text: string
  truncated: boolean
} {
  if (input.length <= maxChars) {
    return {
      text: input,
      truncated: false,
    }
  }

  return {
    text: input.slice(0, maxChars).trimEnd(),
    truncated: true,
  }
}

export function resolveAssistantWebMediaType(
  contentType: string | null,
): string | null {
  const normalized = contentType?.trim()
  if (!normalized) {
    return null
  }

  return normalized.split(';', 1)[0]?.trim().toLowerCase() ?? null
}

function normalizeAssistantWebJsonText(input: string): {
  text: string
  warnings: string[]
} {
  try {
    return {
      text: `${JSON.stringify(JSON.parse(input), null, 2)}\n`,
      warnings: [],
    }
  } catch {
    return {
      text: normalizeAssistantWebText(input),
      warnings: [
        'Response declared JSON but could not be parsed cleanly; returning normalized text instead.',
      ],
    }
  }
}

function isAssistantWebHtmlContentType(
  contentType: string | null,
): boolean {
  return contentType === 'text/html' || contentType === 'application/xhtml+xml'
}

function isAssistantWebJsonContentType(
  contentType: string | null,
): boolean {
  return contentType === 'application/json' ||
    Boolean(contentType?.endsWith('+json'))
}

export function isAssistantWebPdfContentType(
  contentType: string | null,
): boolean {
  return contentType === 'application/pdf' || contentType === 'application/x-pdf'
}

function isAssistantWebLikelyBinaryContentType(
  contentType: string | null,
): boolean {
  if (!contentType) {
    return false
  }

  if (isAssistantWebSupportedTextContentType(contentType)) {
    return false
  }

  return contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('font/') ||
    contentType.startsWith('model/') ||
    contentType.startsWith('multipart/') ||
    contentType.startsWith('application/')
}

function isAssistantWebSupportedTextContentType(
  contentType: string,
): boolean {
  return contentType.startsWith('text/') ||
    isAssistantWebHtmlContentType(contentType) ||
    isAssistantWebJsonContentType(contentType) ||
    contentType === 'application/ecmascript' ||
    contentType === 'application/graphql' ||
    contentType === 'application/javascript' ||
    contentType === 'application/xml' ||
    contentType === 'application/x-javascript' ||
    contentType === 'application/x-toml' ||
    contentType === 'application/x-www-form-urlencoded' ||
    contentType === 'application/x-yaml' ||
    contentType === 'application/yaml' ||
    contentType === 'application/toml' ||
    contentType.endsWith('+xml') ||
    contentType === 'image/svg+xml'
}

function normalizeAssistantWebText(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}
