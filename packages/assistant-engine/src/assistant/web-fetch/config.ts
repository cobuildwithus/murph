import { lookup } from 'node:dns/promises'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { normalizeNullableString } from '../shared.js'

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

export interface AssistantWebFetchRuntimeContext {
  lookupImplementation: typeof lookup
  maxRedirects: number
  maxResponseBytes: number
  timeoutMs: number
}

export interface AssistantWebFetchedResponse {
  finalUrl: URL
  response: Response
  warnings: string[]
}

export interface AssistantWebResponseBytes {
  bytes: Uint8Array
  truncated: boolean
  warnings: string[]
}

const ASSISTANT_WEB_FETCH_DEFAULT_MAX_CHARS = 12_000
const ASSISTANT_WEB_FETCH_MAX_CHARS = 40_000
const ASSISTANT_WEB_FETCH_DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
const ASSISTANT_WEB_FETCH_MAX_RESPONSE_BYTES = 5_000_000
const ASSISTANT_WEB_FETCH_DEFAULT_TIMEOUT_MS = 15_000
const ASSISTANT_WEB_FETCH_MIN_TIMEOUT_MS = 1_000
const ASSISTANT_WEB_FETCH_MAX_TIMEOUT_MS = 60_000
const ASSISTANT_WEB_FETCH_DEFAULT_MAX_REDIRECTS = 5
const ASSISTANT_WEB_FETCH_MAX_REDIRECTS = 10

export function resolveAssistantWebFetchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof globalThis.Headers !== 'function' || typeof globalThis.Response !== 'function') {
    return false
  }

  const raw = normalizeNullableString(env.MURPH_WEB_FETCH_ENABLED)
  if (!raw) {
    return false
  }

  return ['1', 'true', 'yes', 'on', 'enabled'].includes(raw.toLowerCase())
}

export function resolveAssistantWebFetchMaxChars(
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

export function createAssistantWebFetchRuntimeContext(
  env: NodeJS.ProcessEnv,
): AssistantWebFetchRuntimeContext {
  if (!resolveAssistantWebFetchEnabled(env)) {
    throw new VaultCliError(
      'WEB_FETCH_DISABLED',
      'web.fetch is disabled in this runtime.',
    )
  }

  return {
    lookupImplementation: lookup,
    timeoutMs: resolveAssistantWebFetchTimeoutMs(env),
    maxResponseBytes: resolveAssistantWebFetchMaxResponseBytes(env),
    maxRedirects: resolveAssistantWebFetchMaxRedirects(env),
  }
}

export function normalizeAssistantWebRequestUrl(url: string): URL {
  const parsedUrl = new URL(url)
  parsedUrl.hash = ''

  const normalizedHostname = normalizeAssistantWebHostname(parsedUrl.hostname)
  if (normalizedHostname) {
    parsedUrl.hostname = normalizedHostname
  }

  return parsedUrl
}

export function normalizeAssistantWebHostname(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase()
  if (!normalized) {
    return null
  }

  const unwrapped = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  const trimmed = unwrapped.replace(/\.+$/u, '')

  return trimmed.length > 0 ? trimmed : null
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
