import { createTimeoutAbortController } from '@murphai/operator-config/http-retry'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { normalizeNullableString } from './shared.js'
import type {
  AssistantWebFetchExtractMode,
  AssistantWebFetchRequest,
  AssistantWebFetchResponse,
} from './web-fetch/config.js'
import {
  createAssistantWebFetchRuntimeContext,
  normalizeAssistantWebRequestUrl,
  resolveAssistantWebFetchMaxChars,
} from './web-fetch/config.js'
import {
  fetchAssistantWebResponse,
  redactAssistantWebFetchUrl,
} from './web-fetch/network.js'
import {
  extractAssistantWebResponse,
  resolveAssistantWebMediaType,
} from './web-fetch/content.js'

export {
  assistantWebFetchEnvKeys,
  assistantWebFetchExtractModeValues,
  createAssistantWebFetchRuntimeContext,
  normalizeAssistantWebHostname,
  normalizeAssistantWebRequestUrl,
  resolveAssistantWebFetchEnabled,
  resolveAssistantWebFetchMaxChars,
  type AssistantWebFetchedResponse,
  type AssistantWebFetchRequest,
  type AssistantWebFetchResponse,
  type AssistantWebFetchRuntimeContext,
  type AssistantWebResponseBytes,
} from './web-fetch/config.js'
export {
  fetchAssistantWebResponse,
  redactAssistantWebFetchUrl,
} from './web-fetch/network.js'
export {
  readAssistantWebResponseBytes,
} from './web-fetch/response.js'
export {
  resolveAssistantWebMediaType,
  truncateAssistantWebText,
} from './web-fetch/content.js'

interface NormalizedAssistantWebFetchRequest {
  extractMode: AssistantWebFetchExtractMode
  maxChars: number
  signal?: AbortSignal
  url: URL
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
      toolName: 'web.fetch',
      url: normalizedRequest.url,
      runtime,
      signal: timeout.signal,
    })
    const contentType = resolveAssistantWebMediaType(
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
      url: redactAssistantWebFetchUrl(normalizedRequest.url),
      finalUrl: redactAssistantWebFetchUrl(fetched.finalUrl),
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
    parsedUrl = normalizeAssistantWebRequestUrl(url)
  } catch {
    throw new VaultCliError(
      'WEB_FETCH_URL_INVALID',
      'web.fetch requires a valid absolute URL.',
    )
  }

  const extractMode = isAssistantWebFetchExtractMode(request.extractMode)
    ? request.extractMode
    : 'markdown'
  const configuredMaxChars = resolveAssistantWebFetchMaxChars(env)
  const maxChars = Math.max(
    1,
    Math.min(
      Math.trunc(request.maxChars ?? configuredMaxChars),
      configuredMaxChars,
    ),
  )

  return {
    url: parsedUrl,
    extractMode,
    maxChars,
    signal: request.signal,
  }
}

function isAssistantWebFetchExtractMode(
  value: string | null | undefined,
): value is AssistantWebFetchExtractMode {
  return value === 'markdown' || value === 'text'
}
