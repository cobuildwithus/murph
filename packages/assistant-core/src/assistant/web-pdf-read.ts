import { createTimeoutAbortController } from '../http-retry.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  errorMessage,
  normalizeNullableString,
} from './shared.js'
import {
  createAssistantWebFetchRuntimeContext,
  fetchAssistantWebResponse,
  readAssistantWebResponseBytes,
  resolveAssistantWebMediaType,
  truncateAssistantWebText,
} from './web-fetch.js'

const ASSISTANT_WEB_PDF_READ_DEFAULT_MAX_CHARS = 12_000
export const assistantWebPdfReadMaxChars = 40_000
const ASSISTANT_WEB_PDF_READ_DEFAULT_MAX_PAGES = 8
export const assistantWebPdfReadMaxPages = 25
const ASSISTANT_WEB_PDF_READ_ACCEPT_HEADER =
  'application/pdf, application/octet-stream;q=0.9, */*;q=0.1'

type AssistantPdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type AssistantPdfLoadingTask = ReturnType<AssistantPdfJsModule['getDocument']>

export interface AssistantWebPdfReadRequest {
  maxChars?: number | null
  maxPages?: number | null
  signal?: AbortSignal
  url: string
}

export interface AssistantWebPdfReadResponse {
  contentType: string | null
  fetchedAt: string
  finalUrl: string
  pageCount: number
  status: number
  text: string
  truncated: boolean
  url: string
  warnings: string[]
}

interface NormalizedAssistantWebPdfReadRequest {
  maxChars: number
  maxPages: number
  signal?: AbortSignal
  url: URL
}

interface AssistantPdfTextItemLike {
  hasEOL?: boolean
  str: string
}

export async function readAssistantWebPdf(
  request: AssistantWebPdfReadRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantWebPdfReadResponse> {
  const normalizedRequest = normalizeAssistantWebPdfReadRequest(request)
  const runtime = createAssistantWebFetchRuntimeContext(env)
  const timeout = createTimeoutAbortController(
    normalizedRequest.signal,
    runtime.timeoutMs,
  )

  try {
    const fetched = await fetchAssistantWebResponse({
      acceptHeader: ASSISTANT_WEB_PDF_READ_ACCEPT_HEADER,
      runtime,
      signal: timeout.signal,
      toolName: 'web.pdf.read',
      url: normalizedRequest.url,
    })
    const contentType = resolveAssistantWebMediaType(
      fetched.response.headers.get('content-type'),
    )
    const pdfSupport = resolveAssistantWebPdfSupport({
      contentType,
      finalUrl: fetched.finalUrl,
    })
    const responseBytes = await readAssistantWebResponseBytes({
      maxResponseBytes: runtime.maxResponseBytes,
      response: fetched.response,
    })

    const extraction = await extractAssistantPdfText({
      bytes: responseBytes.bytes,
      finalUrl: fetched.finalUrl,
      maxChars: normalizedRequest.maxChars,
      maxPages: normalizedRequest.maxPages,
      responseWasTruncated: responseBytes.truncated,
    })

    const warnings = [
      ...fetched.warnings,
      ...pdfSupport.warnings,
      ...responseBytes.warnings,
      ...extraction.warnings,
      ...(fetched.response.ok
        ? []
        : [`Received HTTP ${fetched.response.status} from the remote website.`]),
    ]

    return {
      url: normalizedRequest.url.toString(),
      finalUrl: fetched.finalUrl.toString(),
      status: fetched.response.status,
      contentType,
      pageCount: extraction.pageCount,
      text: extraction.text,
      truncated: responseBytes.truncated || extraction.truncated,
      warnings,
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (timeout.timedOut()) {
      throw new VaultCliError(
        'WEB_PDF_READ_TIMEOUT',
        `web.pdf.read timed out after ${runtime.timeoutMs}ms.`,
      )
    }

    throw error
  } finally {
    timeout.cleanup()
  }
}

function normalizeAssistantWebPdfReadRequest(
  request: AssistantWebPdfReadRequest,
): NormalizedAssistantWebPdfReadRequest {
  const url = normalizeNullableString(request.url)
  if (!url) {
    throw new VaultCliError(
      'WEB_PDF_READ_URL_INVALID',
      'web.pdf.read requires a non-empty URL.',
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new VaultCliError(
      'WEB_PDF_READ_URL_INVALID',
      'web.pdf.read requires a valid absolute URL.',
    )
  }

  return {
    url: parsedUrl,
    maxChars: normalizeAssistantWebPdfReadBoundedInteger({
      value: request.maxChars,
      fallback: ASSISTANT_WEB_PDF_READ_DEFAULT_MAX_CHARS,
      max: assistantWebPdfReadMaxChars,
      min: 1,
    }),
    maxPages: normalizeAssistantWebPdfReadBoundedInteger({
      value: request.maxPages,
      fallback: ASSISTANT_WEB_PDF_READ_DEFAULT_MAX_PAGES,
      max: assistantWebPdfReadMaxPages,
      min: 1,
    }),
    signal: request.signal,
  }
}

function normalizeAssistantWebPdfReadBoundedInteger(input: {
  fallback: number
  max: number
  min: number
  value: number | null | undefined
}): number {
  const rawValue = input.value
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return input.fallback
  }

  return Math.max(
    input.min,
    Math.min(Math.trunc(rawValue), input.max),
  )
}

function resolveAssistantWebPdfSupport(input: {
  contentType: string | null
  finalUrl: URL
}): { warnings: string[] } {
  if (isAssistantWebPdfContentType(input.contentType)) {
    return { warnings: [] }
  }

  if (input.finalUrl.pathname.toLowerCase().endsWith('.pdf')) {
    return {
      warnings: [
        'Remote response did not explicitly declare application/pdf; attempting PDF parsing because the final URL ends with .pdf.',
      ],
    }
  }

  throw new VaultCliError(
    'WEB_PDF_READ_CONTENT_TYPE_UNSUPPORTED',
    `web.pdf.read requires a PDF response, but received ${input.contentType ?? 'an unknown content type'}.`,
  )
}

async function extractAssistantPdfText(input: {
  bytes: Uint8Array
  finalUrl: URL
  maxChars: number
  maxPages: number
  responseWasTruncated: boolean
}): Promise<{
  pageCount: number
  text: string
  truncated: boolean
  warnings: string[]
}> {
  let documentLoadingTask: AssistantPdfLoadingTask | null = null

  try {
    const pdfjs = await loadAssistantPdfJs()
    documentLoadingTask = pdfjs.getDocument({
      data: input.bytes,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    })
    const pdfDocument = await documentLoadingTask.promise

    try {
      const pageCount = pdfDocument.numPages
      const warnings: string[] = []
      const pageTexts: string[] = []
      const pagesToRead = Math.min(pageCount, input.maxPages)
      let truncated = input.responseWasTruncated

      if (pagesToRead < pageCount) {
        truncated = true
        warnings.push(
          `Read only the first ${pagesToRead} pages out of ${pageCount} total pages.`,
        )
      }

      for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber)
        const textContent = await page.getTextContent()
        const pageText = renderAssistantPdfPageText(textContent.items)
        if (pageText.length > 0) {
          pageTexts.push(pageText)
        }
      }

      const joinedText = pageTexts.join('\n\n')
      const boundedText = truncateAssistantWebText(joinedText, input.maxChars)
      if (boundedText.truncated) {
        truncated = true
        warnings.push(
          `Trimmed extracted PDF text to ${input.maxChars} characters for model safety.`,
        )
      }

      if (boundedText.text.length === 0) {
        warnings.push(
          'PDF parsing succeeded but no extractable text was found. The PDF may be image-only or scanned.',
        )
      }

      return {
        pageCount,
        text: boundedText.text,
        truncated,
        warnings,
      }
    } finally {
      await pdfDocument.destroy()
    }
  } catch (error) {
    const truncationNote = input.responseWasTruncated
      ? ' The PDF response was truncated by the configured byte limit before parsing.'
      : ''
    throw new VaultCliError(
      'WEB_PDF_READ_PARSE_FAILED',
      `web.pdf.read could not extract text from ${input.finalUrl.toString()}: ${errorMessage(error)}.${truncationNote}`,
    )
  } finally {
    await documentLoadingTask?.destroy()
  }
}

function renderAssistantPdfPageText(items: unknown[]): string {
  let text = ''

  for (const item of items) {
    if (!isAssistantPdfTextItem(item)) {
      continue
    }

    const value = normalizeAssistantPdfTextFragment(item.str)
    if (value.length === 0) {
      if (item.hasEOL) {
        text = appendAssistantPdfLineBreak(text)
      }
      continue
    }

    if (shouldInsertAssistantPdfSpace(text, value)) {
      text += ' '
    }
    text += value

    if (item.hasEOL) {
      text = appendAssistantPdfLineBreak(text)
    }
  }

  return normalizeAssistantPdfBlock(text)
}

function isAssistantPdfTextItem(value: unknown): value is AssistantPdfTextItemLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'str' in value &&
      typeof value.str === 'string',
  )
}

function normalizeAssistantPdfTextFragment(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim()
}

function appendAssistantPdfLineBreak(input: string): string {
  return input.endsWith('\n') ? input : `${input}\n`
}

function shouldInsertAssistantPdfSpace(currentText: string, nextFragment: string): boolean {
  if (currentText.length === 0) {
    return false
  }

  const previousCharacter = currentText.at(-1) ?? ''
  if (/\s/u.test(previousCharacter) || previousCharacter === '/' || previousCharacter === '(') {
    return false
  }

  return !/^[,.;:!?%)\]]/u.test(nextFragment)
}

function normalizeAssistantPdfBlock(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function isAssistantWebPdfContentType(contentType: string | null): boolean {
  return contentType === 'application/pdf' || contentType === 'application/x-pdf'
}

async function loadAssistantPdfJs(): Promise<AssistantPdfJsModule> {
  return await import('pdfjs-dist/legacy/build/pdf.mjs')
}
