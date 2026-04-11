import { createAbortError, createTimeoutAbortController } from '@murphai/operator-config/http-retry'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  errorMessage,
  normalizeNullableString,
} from './shared.js'
import {
  createAssistantWebFetchRuntimeContext,
  normalizeAssistantWebRequestUrl,
} from './web-fetch/config.js'
import {
  resolveAssistantWebMediaType,
  truncateAssistantWebText,
} from './web-fetch/content.js'
import {
  fetchAssistantWebResponse,
  redactAssistantWebFetchUrl,
} from './web-fetch/network.js'
import {
  readAssistantWebResponseBytes,
} from './web-fetch/response.js'

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
      signal: timeout.signal,
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
      url: redactAssistantWebFetchUrl(normalizedRequest.url),
      finalUrl: redactAssistantWebFetchUrl(fetched.finalUrl),
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
    parsedUrl = normalizeAssistantWebRequestUrl(url)
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
  signal: AbortSignal
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
    const pdfDocument = await waitForAssistantPdfOperation({
      promise: documentLoadingTask.promise,
      signal: input.signal,
      onAbort: () => documentLoadingTask?.destroy(),
    })

    try {
      const pageCount = pdfDocument.numPages
      const warnings: string[] = []
      if (input.responseWasTruncated) {
        warnings.push(
          'The PDF response hit the configured byte limit before parsing, so extracted text may be incomplete or malformed.',
        )
      }
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
        const page = await waitForAssistantPdfOperation({
          promise: pdfDocument.getPage(pageNumber),
          signal: input.signal,
          onAbort: () => pdfDocument.destroy(),
        })
        const textContent = await waitForAssistantPdfOperation({
          promise: page.getTextContent(),
          signal: input.signal,
          onAbort: () => pdfDocument.destroy(),
        })
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }

    const truncationNote = input.responseWasTruncated
      ? ' The PDF response was truncated by the configured byte limit before parsing.'
      : ''
    throw new VaultCliError(
      'WEB_PDF_READ_PARSE_FAILED',
      `web.pdf.read could not extract text from ${redactAssistantWebFetchUrl(input.finalUrl)}: ${errorMessage(error)}.${truncationNote}`,
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

async function waitForAssistantPdfOperation<T>(input: {
  onAbort: (() => void | Promise<void>) | undefined
  promise: Promise<T>
  signal: AbortSignal
}): Promise<T> {
  if (input.signal.aborted) {
    void input.promise.catch(() => {})
    void Promise.resolve(input.onAbort?.()).catch(() => {})
    throw createAbortError()
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      void Promise.resolve(input.onAbort?.()).catch(() => {})
      reject(createAbortError())
    }
    const cleanup = () => input.signal.removeEventListener('abort', onAbort)

    input.signal.addEventListener('abort', onAbort, { once: true })
    input.promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
