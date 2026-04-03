import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Readability } from '@mozilla/readability'
import { DOMParser } from 'linkedom'
import { createTimeoutAbortController } from '../http-retry.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  errorMessage,
  normalizeNullableString,
} from './shared.js'

export const assistantWebFetchExtractModeValues = [
  'markdown',
  'text',
] as const

export const assistantWebFetchEnvKeys = [
  'MURPH_WEB_FETCH_ENABLED',
  'MURPH_WEB_FETCH_MAX_CHARS',
  'MURPH_WEB_FETCH_MAX_RESPONSE_BYTES',
  'MURPH_WEB_FETCH_TIMEOUT_MS',
  'MURPH_WEB_FETCH_MAX_REDIRECTS',
] as const

export type AssistantWebFetchExtractMode =
  typeof assistantWebFetchExtractModeValues[number]

export interface AssistantWebFetchRequest {
  extractMode?: AssistantWebFetchExtractMode | null
  maxChars?: number | null
  signal?: AbortSignal
  url: string
}

export interface AssistantWebFetchResponse {
  contentType: string | null
  extractMode: AssistantWebFetchExtractMode
  extractor: 'json' | 'raw-html' | 'raw-text' | 'readability'
  fetchedAt: string
  finalUrl: string
  status: number
  text: string
  title: string | null
  truncated: boolean
  url: string
  warnings: string[]
}

interface NormalizedAssistantWebFetchRequest {
  extractMode: AssistantWebFetchExtractMode
  maxChars: number
  signal?: AbortSignal
  url: URL
}

interface AssistantWebFetchRuntimeContext {
  fetchImplementation: typeof fetch
  lookupImplementation: typeof lookup
  maxRedirects: number
  maxResponseBytes: number
  timeoutMs: number
}

interface AssistantWebFetchedResponse {
  finalUrl: URL
  response: Response
  warnings: string[]
}

interface AssistantWebResponseText {
  text: string
  truncated: boolean
  warnings: string[]
}

interface AssistantHtmlNodeLike {
  childNodes?: ArrayLike<AssistantHtmlNodeLike>
  getAttribute?(name: string): string | null
  nodeName: string
  nodeType: number
  textContent: string | null
}

type AssistantHtmlDocument = ReturnType<
  InstanceType<typeof DOMParser>['parseFromString']
> extends infer T
  ? Extract<T, { body: unknown }>
  : never

const ASSISTANT_WEB_FETCH_DEFAULT_MAX_CHARS = 12_000
const ASSISTANT_WEB_FETCH_MAX_CHARS = 40_000
const ASSISTANT_WEB_FETCH_DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
const ASSISTANT_WEB_FETCH_MAX_RESPONSE_BYTES = 5_000_000
const ASSISTANT_WEB_FETCH_DEFAULT_TIMEOUT_MS = 15_000
const ASSISTANT_WEB_FETCH_MIN_TIMEOUT_MS = 1_000
const ASSISTANT_WEB_FETCH_MAX_TIMEOUT_MS = 60_000
const ASSISTANT_WEB_FETCH_DEFAULT_MAX_REDIRECTS = 5
const ASSISTANT_WEB_FETCH_MAX_REDIRECTS = 10
const ASSISTANT_WEB_FETCH_BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
] as const
const ASSISTANT_WEB_FETCH_TEXT_NODE = 3
const ASSISTANT_WEB_FETCH_ELEMENT_NODE = 1

const assistantWebFetchBlockedAddressList = createAssistantWebFetchBlockedAddressList()

export function resolveAssistantWebFetchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof globalThis.fetch !== 'function') {
    return false
  }

  const raw = normalizeNullableString(env.MURPH_WEB_FETCH_ENABLED)
  if (!raw) {
    return true
  }

  const normalized = raw.toLowerCase()
  return !['0', 'false', 'no', 'off', 'disabled'].includes(normalized)
}

export async function fetchAssistantWeb(
  request: AssistantWebFetchRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantWebFetchResponse> {
  const normalizedRequest = normalizeAssistantWebFetchRequest(request, env)
  const runtime = createAssistantWebFetchRuntimeContext(env)
  const timeout = createTimeoutAbortController(
    normalizedRequest.signal,
    runtime.timeoutMs,
  )

  try {
    const fetched = await fetchAssistantWebResponse({
      request: normalizedRequest,
      runtime,
      signal: timeout.signal,
    })
    const contentType = resolveMediaType(
      fetched.response.headers.get('content-type'),
    )
    const extracted = await extractAssistantWebResponse({
      contentType,
      extractMode: normalizedRequest.extractMode,
      maxChars: normalizedRequest.maxChars,
      maxResponseBytes: runtime.maxResponseBytes,
      response: fetched.response,
    })

    return {
      url: normalizedRequest.url.toString(),
      finalUrl: fetched.finalUrl.toString(),
      status: fetched.response.status,
      contentType,
      title: extracted.title,
      extractMode: normalizedRequest.extractMode,
      extractor: extracted.extractor,
      text: extracted.text,
      truncated: extracted.truncated,
      warnings: [
        ...fetched.warnings,
        ...extracted.warnings,
        ...(fetched.response.ok
          ? []
          : [`Received HTTP ${fetched.response.status} from the remote website.`]),
      ],
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (timeout.timedOut()) {
      throw new VaultCliError(
        'WEB_FETCH_TIMEOUT',
        `web.fetch timed out after ${runtime.timeoutMs}ms.`,
      )
    }

    throw error
  } finally {
    timeout.cleanup()
  }
}

function normalizeAssistantWebFetchRequest(
  request: AssistantWebFetchRequest,
  env: NodeJS.ProcessEnv,
): NormalizedAssistantWebFetchRequest {
  const url = normalizeNullableString(request.url)
  if (!url) {
    throw new VaultCliError(
      'WEB_FETCH_URL_INVALID',
      'web.fetch requires a non-empty URL.',
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new VaultCliError(
      'WEB_FETCH_URL_INVALID',
      'web.fetch requires a valid absolute URL.',
    )
  }

  const extractMode = isAssistantWebFetchExtractMode(request.extractMode)
    ? request.extractMode
    : 'markdown'
  const maxChars = Math.max(
    1,
    Math.min(
      Math.trunc(request.maxChars ?? resolveAssistantWebFetchMaxChars(env)),
      resolveAssistantWebFetchMaxChars(env),
      ASSISTANT_WEB_FETCH_MAX_CHARS,
    ),
  )

  return {
    url: parsedUrl,
    extractMode,
    maxChars,
    signal: request.signal,
  }
}

function createAssistantWebFetchRuntimeContext(
  env: NodeJS.ProcessEnv,
): AssistantWebFetchRuntimeContext {
  if (!resolveAssistantWebFetchEnabled(env)) {
    throw new VaultCliError(
      'WEB_FETCH_DISABLED',
      'web.fetch is disabled in this runtime.',
    )
  }

  return {
    fetchImplementation: globalThis.fetch,
    lookupImplementation: lookup,
    timeoutMs: resolveAssistantWebFetchTimeoutMs(env),
    maxResponseBytes: resolveAssistantWebFetchMaxResponseBytes(env),
    maxRedirects: resolveAssistantWebFetchMaxRedirects(env),
  }
}

async function fetchAssistantWebResponse(input: {
  request: NormalizedAssistantWebFetchRequest
  runtime: AssistantWebFetchRuntimeContext
  signal: AbortSignal
}): Promise<AssistantWebFetchedResponse> {
  let currentUrl = input.request.url
  const warnings: string[] = []

  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertAssistantWebUrlIsPublic(
      currentUrl,
      input.runtime.lookupImplementation,
    )

    let response: Response
    try {
      response = await input.runtime.fetchImplementation(currentUrl.toString(), {
        method: 'GET',
        headers: {
          accept: 'text/html, application/xhtml+xml, application/json, text/plain;q=0.9, */*;q=0.1',
        },
        redirect: 'manual',
        signal: input.signal,
      })
    } catch (error) {
      throw new VaultCliError(
        'WEB_FETCH_REQUEST_FAILED',
        `web.fetch could not reach ${currentUrl.toString()}: ${errorMessage(error)}`,
      )
    }

    if (!isAssistantWebRedirectStatus(response.status)) {
      return {
        finalUrl: currentUrl,
        response,
        warnings,
      }
    }

    const location = normalizeNullableString(response.headers.get('location'))
    if (!location) {
      throw new VaultCliError(
        'WEB_FETCH_REDIRECT_INVALID',
        `web.fetch received HTTP ${response.status} without a redirect location.`,
      )
    }

    if (redirectCount >= input.runtime.maxRedirects) {
      throw new VaultCliError(
        'WEB_FETCH_REDIRECT_LIMIT',
        `web.fetch followed too many redirects (>${input.runtime.maxRedirects}).`,
      )
    }

    const nextUrl = new URL(location, currentUrl)
    warnings.push(
      `Followed redirect ${redirectCount + 1} to ${redactAssistantWebFetchUrl(nextUrl)}.`,
    )
    currentUrl = nextUrl
  }
}

async function assertAssistantWebUrlIsPublic(
  candidateUrl: URL,
  lookupImplementation: typeof lookup,
): Promise<void> {
  const protocol = candidateUrl.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new VaultCliError(
      'WEB_FETCH_URL_UNSUPPORTED_SCHEME',
      'web.fetch only supports http:// and https:// URLs.',
    )
  }

  if (candidateUrl.username || candidateUrl.password) {
    throw new VaultCliError(
      'WEB_FETCH_URL_CREDENTIALS_FORBIDDEN',
      'web.fetch does not allow credentials in URLs.',
    )
  }

  const hostname = normalizeNullableString(candidateUrl.hostname)?.toLowerCase()
  if (!hostname) {
    throw new VaultCliError(
      'WEB_FETCH_HOST_INVALID',
      'web.fetch requires a URL with a hostname.',
    )
  }

  if (isAssistantWebBlockedHostname(hostname)) {
    throw new VaultCliError(
      'WEB_FETCH_PRIVATE_HOST_BLOCKED',
      `web.fetch blocked ${hostname} because private or loopback hosts are not allowed.`,
    )
  }

  const hostAddressFamily = isIP(hostname)
  if (hostAddressFamily !== 0) {
    if (isAssistantWebBlockedIpAddress(hostname, hostAddressFamily)) {
      throw new VaultCliError(
        'WEB_FETCH_PRIVATE_HOST_BLOCKED',
        `web.fetch blocked ${hostname} because private or loopback hosts are not allowed.`,
      )
    }

    return
  }

  let resolvedAddresses: Array<{ address: string; family: number }>
  try {
    resolvedAddresses = await lookupAllAssistantWebAddresses(
      lookupImplementation,
      hostname,
    )
  } catch (error) {
    throw new VaultCliError(
      'WEB_FETCH_DNS_LOOKUP_FAILED',
      `web.fetch could not resolve ${hostname}: ${errorMessage(error)}`,
    )
  }

  if (resolvedAddresses.length === 0) {
    throw new VaultCliError(
      'WEB_FETCH_DNS_LOOKUP_FAILED',
      `web.fetch could not resolve ${hostname} to any IP address.`,
    )
  }

  for (const address of resolvedAddresses) {
    if (isAssistantWebBlockedIpAddress(address.address, address.family)) {
      throw new VaultCliError(
        'WEB_FETCH_PRIVATE_HOST_BLOCKED',
        `web.fetch blocked ${hostname} because it resolved to a private or loopback address.`,
      )
    }
  }
}

async function extractAssistantWebResponse(input: {
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
    throw new VaultCliError(
      'WEB_FETCH_PDF_UNSUPPORTED',
      'web.fetch does not parse PDFs. Use the planned web.pdf.read tool instead.',
    )
  }

  if (isAssistantWebLikelyBinaryContentType(input.contentType)) {
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

async function readAssistantWebResponseText(input: {
  maxResponseBytes: number
  response: Response
}): Promise<AssistantWebResponseText> {
  const warnings: string[] = []
  const contentLength = parsePositiveInteger(
    input.response.headers.get('content-length'),
  )
  if (
    contentLength !== null &&
    contentLength > input.maxResponseBytes
  ) {
    warnings.push(
      `Response declared ${contentLength} bytes; reading only the first ${input.maxResponseBytes} bytes.`,
    )
  }

  if (!input.response.body) {
    return {
      text: '',
      truncated: false,
      warnings,
    }
  }

  const reader = input.response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ''
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    if (!value || value.length === 0) {
      continue
    }

    const remainingBytes = input.maxResponseBytes - totalBytes
    if (remainingBytes <= 0) {
      truncated = true
      break
    }

    const chunk = value.length > remainingBytes
      ? value.subarray(0, remainingBytes)
      : value
    totalBytes += chunk.length
    text += decoder.decode(chunk, {
      stream: value.length <= remainingBytes,
    })

    if (value.length > remainingBytes) {
      truncated = true
      break
    }
  }

  text += decoder.decode()

  if (truncated) {
    warnings.push(
      `Response body exceeded ${input.maxResponseBytes} bytes and was truncated.`,
    )
    try {
      await reader.cancel()
    } catch {
      // Ignore cancellation failures after truncation.
    }
  }

  return {
    text,
    truncated,
    warnings,
  }
}

function extractAssistantWebHtml(input: {
  extractMode: AssistantWebFetchExtractMode
  html: string
}): {
  extractor: AssistantWebFetchResponse['extractor']
  text: string
  title: string | null
  warnings: string[]
} {
  const document = parseAssistantHtmlDocument(input.html)
  const article = parseAssistantHtmlWithReadability(document)
  const warnings: string[] = []

  if (article) {
    const articleText = normalizeAssistantText(article.textContent ?? '')
    const markdownText = normalizeAssistantMarkdown(
      renderAssistantHtmlToMarkdown(
        parseAssistantHtmlFragment(normalizeNullableString(article.content) ?? ''),
      ),
    )
    if (input.extractMode === 'markdown' && markdownText.length === 0 && articleText.length > 0) {
      warnings.push(
        'Readable article markdown conversion was empty; falling back to normalized article text.',
      )
    }

    return {
      extractor: 'readability',
      title:
        normalizeNullableString(article.title) ??
        resolveAssistantHtmlDocumentTitle(document),
      text:
        input.extractMode === 'markdown'
          ? (markdownText || articleText)
          : articleText,
      warnings,
    }
  }

  warnings.push(
    'Readable article extraction failed; falling back to a simpler HTML cleanup path.',
  )

  const fallbackText = normalizeAssistantText(document.body?.textContent ?? '')
  const fallbackMarkdown = normalizeAssistantMarkdown(
    renderAssistantHtmlToMarkdown(document),
  )
  if (input.extractMode === 'markdown' && fallbackMarkdown.length === 0 && fallbackText.length > 0) {
    warnings.push(
      'Fallback HTML markdown conversion was empty; returning normalized page text instead.',
    )
  }

  return {
    extractor: 'raw-html',
    title: resolveAssistantHtmlDocumentTitle(document),
    text:
      input.extractMode === 'markdown'
        ? (fallbackMarkdown || fallbackText)
        : fallbackText,
    warnings,
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
      text: normalizeAssistantText(input),
      warnings: [
        'Response declared JSON but could not be parsed cleanly; returning normalized text instead.',
      ],
    }
  }
}

function parseAssistantHtmlDocument(
  html: string,
): AssistantHtmlDocument {
  const document = new DOMParser().parseFromString(
    html,
    'text/html',
  ) as AssistantHtmlDocument

  for (const element of document.querySelectorAll(
    'script, style, noscript, iframe, svg, canvas, form',
  )) {
    element.remove()
  }

  return document
}

function parseAssistantHtmlFragment(
  htmlFragment: string,
): AssistantHtmlDocument {
  return parseAssistantHtmlDocument(
    `<!doctype html><html><body>${htmlFragment}</body></html>`,
  )
}

function renderAssistantHtmlToMarkdown(
  document: AssistantHtmlDocument,
): string {
  return normalizeAssistantMarkdown(renderAssistantNodeToMarkdown(document.body))
}

function renderAssistantNodeToMarkdown(
  node: AssistantHtmlNodeLike | null | undefined,
): string {
  if (!node) {
    return ''
  }

  if (node.nodeType === ASSISTANT_WEB_FETCH_TEXT_NODE) {
    return escapeAssistantMarkdownText(node.textContent ?? '')
  }

  if (node.nodeType !== ASSISTANT_WEB_FETCH_ELEMENT_NODE) {
    return ''
  }

  const tagName = node.nodeName.toLowerCase()
  const childText = renderAssistantChildrenToMarkdown(node)

  switch (tagName) {
    case 'body':
    case 'main':
    case 'article':
    case 'section':
    case 'header':
    case 'footer':
    case 'nav':
    case 'aside':
    case 'div':
      return `${childText}\n\n`
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Math.max(
        1,
        Math.min(Number(tagName.slice(1)) || 1, 6),
      )
      const heading = normalizeAssistantText(childText)
      return heading ? `${'#'.repeat(level)} ${heading}\n\n` : ''
    }
    case 'p':
      return childText.trim() ? `${childText.trim()}\n\n` : ''
    case 'br':
      return '\n'
    case 'hr':
      return '\n---\n\n'
    case 'ul':
    case 'ol':
      return `${renderAssistantListToMarkdown(node, tagName === 'ol')}\n`
    case 'li': {
      const text = normalizeAssistantMarkdownInline(childText)
      return text ? `${text}\n` : ''
    }
    case 'pre': {
      const code = normalizeTrailingWhitespace(node.textContent ?? '')
      return code ? `\n\`\`\`\n${code}\n\`\`\`\n\n` : ''
    }
    case 'code': {
      const text = normalizeAssistantText(node.textContent ?? '')
      return text ? `\`${text}\`` : ''
    }
    case 'a': {
      const text = normalizeAssistantMarkdownInline(childText)
      const href = normalizeNullableString(node.getAttribute?.('href') ?? null)
      if (!text) {
        return ''
      }
      if (!href) {
        return text
      }
      return `[${text}](${href})`
    }
    case 'strong':
    case 'b': {
      const text = normalizeAssistantMarkdownInline(childText)
      return text ? `**${text}**` : ''
    }
    case 'em':
    case 'i': {
      const text = normalizeAssistantMarkdownInline(childText)
      return text ? `_${text}_` : ''
    }
    case 'blockquote': {
      const lines = normalizeAssistantText(childText)
        .split('\n')
        .filter((line) => line.length > 0)
      return lines.length > 0
        ? `${lines.map((line) => `> ${line}`).join('\n')}\n\n`
        : ''
    }
    case 'table':
      return `${normalizeAssistantText(childText)}\n\n`
    default:
      return childText
  }
}

function renderAssistantChildrenToMarkdown(node: AssistantHtmlNodeLike): string {
  if (!node.childNodes || node.childNodes.length === 0) {
    return ''
  }

  let markdown = ''
  for (const childNode of Array.from(node.childNodes)) {
    markdown += renderAssistantNodeToMarkdown(childNode)
  }

  return markdown
}

function renderAssistantListToMarkdown(
  node: AssistantHtmlNodeLike,
  ordered: boolean,
): string {
  if (!node.childNodes || node.childNodes.length === 0) {
    return ''
  }

  let markdown = ''
  let orderedListIndex = 1

  for (const childNode of Array.from(node.childNodes)) {
    if (childNode.nodeType !== ASSISTANT_WEB_FETCH_ELEMENT_NODE) {
      continue
    }

    if (childNode.nodeName.toLowerCase() !== 'li') {
      markdown += renderAssistantNodeToMarkdown(childNode)
      continue
    }

    const itemText = normalizeAssistantMarkdownInline(
      renderAssistantChildrenToMarkdown(childNode),
    )
    if (!itemText) {
      continue
    }

    markdown += ordered
      ? `${orderedListIndex}. ${itemText}\n`
      : `- ${itemText}\n`
    orderedListIndex += 1
  }

  return markdown
}

function truncateAssistantWebText(input: string, maxChars: number): {
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

function resolveAssistantWebFetchMaxChars(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_FETCH_MAX_CHARS',
    fallback: ASSISTANT_WEB_FETCH_DEFAULT_MAX_CHARS,
    min: 1,
    max: ASSISTANT_WEB_FETCH_MAX_CHARS,
  })
}

function resolveAssistantWebFetchMaxResponseBytes(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_FETCH_MAX_RESPONSE_BYTES',
    fallback: ASSISTANT_WEB_FETCH_DEFAULT_MAX_RESPONSE_BYTES,
    min: 16_384,
    max: ASSISTANT_WEB_FETCH_MAX_RESPONSE_BYTES,
  })
}

function resolveAssistantWebFetchTimeoutMs(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_FETCH_TIMEOUT_MS',
    fallback: ASSISTANT_WEB_FETCH_DEFAULT_TIMEOUT_MS,
    min: ASSISTANT_WEB_FETCH_MIN_TIMEOUT_MS,
    max: ASSISTANT_WEB_FETCH_MAX_TIMEOUT_MS,
  })
}

function resolveAssistantWebFetchMaxRedirects(
  env: NodeJS.ProcessEnv,
): number {
  return readAssistantBoundedIntegerEnv({
    env,
    key: 'MURPH_WEB_FETCH_MAX_REDIRECTS',
    fallback: ASSISTANT_WEB_FETCH_DEFAULT_MAX_REDIRECTS,
    min: 0,
    max: ASSISTANT_WEB_FETCH_MAX_REDIRECTS,
  })
}

function readAssistantBoundedIntegerEnv(input: {
  env: NodeJS.ProcessEnv
  fallback: number
  key: string
  max: number
  min: number
}): number {
  const raw = normalizeNullableString(input.env[input.key])
  if (!raw) {
    return input.fallback
  }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) {
    return input.fallback
  }

  return Math.max(
    input.min,
    Math.min(Math.trunc(numeric), input.max),
  )
}

function resolveMediaType(
  contentType: string | null,
): string | null {
  const normalized = normalizeNullableString(contentType)
  if (!normalized) {
    return null
  }

  return normalized.split(';', 1)[0]?.trim().toLowerCase() ?? null
}

function parsePositiveInteger(value: string | null): number | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return Math.trunc(parsed)
}

function isAssistantWebRedirectStatus(status: number): boolean {
  return status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
}

function isAssistantWebFetchExtractMode(
  value: string | null | undefined,
): value is AssistantWebFetchExtractMode {
  return value === 'markdown' || value === 'text'
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

function isAssistantWebBlockedHostname(
  hostname: string,
): boolean {
  if (ASSISTANT_WEB_FETCH_BLOCKED_HOSTNAMES.some((blocked) => blocked === hostname)) {
    return true
  }

  return hostname.endsWith('.localhost') || hostname.endsWith('.local')
}

function isAssistantWebBlockedIpAddress(
  address: string,
  family: number,
): boolean {
  if (family === 4) {
    return assistantWebFetchBlockedAddressList.check(address, 'ipv4')
  }

  if (family === 6) {
    return assistantWebFetchBlockedAddressList.check(address, 'ipv6')
  }

  return false
}

function createAssistantWebFetchBlockedAddressList(): BlockList {
  const blockList = new BlockList()

  blockList.addSubnet('0.0.0.0', 8)
  blockList.addSubnet('10.0.0.0', 8)
  blockList.addSubnet('100.64.0.0', 10)
  blockList.addSubnet('127.0.0.0', 8)
  blockList.addSubnet('169.254.0.0', 16)
  blockList.addSubnet('172.16.0.0', 12)
  blockList.addSubnet('192.0.0.0', 24)
  blockList.addSubnet('192.168.0.0', 16)
  blockList.addSubnet('198.18.0.0', 15)
  blockList.addSubnet('224.0.0.0', 4)
  blockList.addSubnet('::', 128, 'ipv6')
  blockList.addSubnet('::1', 128, 'ipv6')
  blockList.addSubnet('fc00::', 7, 'ipv6')
  blockList.addSubnet('fe80::', 10, 'ipv6')
  blockList.addSubnet('ff00::', 8, 'ipv6')

  return blockList
}

function redactAssistantWebFetchUrl(url: URL): string {
  return `${url.origin}${url.pathname}`
}

function normalizeAssistantText(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}

function normalizeAssistantMarkdown(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function normalizeAssistantMarkdownInline(input: string): string {
  return normalizeAssistantText(input).replace(/\n+/gu, ' ')
}

function parseAssistantHtmlWithReadability(
  document: AssistantHtmlDocument,
): ReturnType<Readability['parse']> {
  const ReadabilityConstructor = Readability as new (
    ...args: readonly unknown[]
  ) => {
    parse(): ReturnType<Readability['parse']>
  }

  return new ReadabilityConstructor(document).parse()
}

async function lookupAllAssistantWebAddresses(
  lookupImplementation: typeof lookup,
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const resolved = await lookupImplementation(hostname, {
    all: true,
    verbatim: true,
  })

  return Array.isArray(resolved) ? resolved : [resolved]
}

function resolveAssistantHtmlDocumentTitle(
  document: { title?: unknown },
): string | null {
  if (typeof document.title === 'string') {
    return normalizeNullableString(document.title)
  }

  if (
    document.title &&
    typeof document.title === 'object' &&
    'textContent' in document.title
  ) {
    const textContent = document.title.textContent
    return typeof textContent === 'string'
      ? normalizeNullableString(textContent)
      : null
  }

  return null
}

function normalizeTrailingWhitespace(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/\s+$/u, '')
}

function escapeAssistantMarkdownText(input: string): string {
  return input.replace(/([\\`*_{}\[\]()#+!|>~-])/gu, '\\$1')
}
