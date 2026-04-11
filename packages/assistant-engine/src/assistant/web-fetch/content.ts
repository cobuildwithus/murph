import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantWebFetchExtractMode,
  AssistantWebFetchResponse,
} from './config.js'
import {
  cancelAssistantWebResponseBody,
  readAssistantWebResponseBytes,
} from './response.js'
import { extractAssistantWebHtml } from './html.js'

interface AssistantWebResponseText {
  text: string
  truncated: boolean
  warnings: string[]
}

export async function extractAssistantWebResponse(input: {
  contentType: string | null
  extractMode: AssistantWebFetchExtractMode
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
  if (input.contentType === 'application/pdf') {
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

async function readAssistantWebResponseText(input: {
  maxResponseBytes: number
  response: Response
}): Promise<AssistantWebResponseText> {
  const body = await readAssistantWebResponseBytes(input)
  const decoder = new TextDecoder()

  return {
    text: decoder.decode(body.bytes),
    truncated: body.truncated,
    warnings: body.warnings,
  }
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

function isAssistantWebLikelyBinaryContentType(
  contentType: string | null,
): boolean {
  if (!contentType) {
    return false
  }

  if (
    contentType.startsWith('text/') ||
    isAssistantWebHtmlContentType(contentType) ||
    isAssistantWebJsonContentType(contentType) ||
    contentType === 'application/xml' ||
    contentType.endsWith('+xml') ||
    contentType === 'image/svg+xml'
  ) {
    return false
  }

  return contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType === 'application/octet-stream' ||
    contentType === 'application/pdf' ||
    contentType === 'application/zip'
}

function normalizeAssistantWebText(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}
