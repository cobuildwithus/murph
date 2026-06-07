import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { isIP } from 'node:net'
import { z } from 'zod'
import {
  assistantResponseMediaSchema,
  normalizeAssistantResponseMediaUrl,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  normalizeNullableString,
  readAssistantJsonFile,
  writeJsonFileAtomic,
} from './shared.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantStatePaths,
} from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  MURPH_ASSISTANT_ACTIVE_SESSION_ID_ENV,
  MURPH_ASSISTANT_ACTIVE_TURN_ID_ENV,
  MURPH_ASSISTANT_MEDIA_CATALOG_URL_ENV,
} from './response-media-env.js'

const ASSISTANT_RESPONSE_MEDIA_STORE_SCHEMA = 'murph.assistant-response-media.v1'
const ASSISTANT_MEDIA_CATALOG_SCHEMA = 'murph.assistant-media-catalog.v1'
const DEFAULT_ASSISTANT_MEDIA_CATALOG_PATH = '/assistant-media/catalog.json'
const DEFAULT_ASSISTANT_MEDIA_CATALOG_REQUEST_TIMEOUT_MS = 5_000
const MAX_ASSISTANT_RESPONSE_MEDIA = 40

const assistantResponseMediaStoreSchema = z
  .object({
    schema: z.literal(ASSISTANT_RESPONSE_MEDIA_STORE_SCHEMA),
    turnId: z.string().min(1),
    sessionId: z.string().min(1).nullable(),
    updatedAt: z.string().min(1),
    media: z.array(assistantResponseMediaSchema).max(MAX_ASSISTANT_RESPONSE_MEDIA),
  })
  .strict()

type AssistantResponseMediaStore = z.infer<typeof assistantResponseMediaStoreSchema>

const assistantMediaCatalogItemSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    url: z.string().trim().min(1),
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    tags: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()

const assistantMediaCatalogSchema = z
  .object({
    schema: z.literal(ASSISTANT_MEDIA_CATALOG_SCHEMA),
    updatedAt: z.string().trim().min(1).nullable().default(null),
    items: z.array(assistantMediaCatalogItemSchema).default([]),
  })
  .strict()

export type AssistantMediaCatalogItem = z.infer<typeof assistantMediaCatalogItemSchema> & {
  url: string
}

export function normalizeAssistantResponseMediaList(
  values: readonly unknown[] | null | undefined,
): AssistantResponseMedia[] {
  if (!Array.isArray(values) || values.length === 0) {
    return []
  }

  const media: AssistantResponseMedia[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const parsed = assistantResponseMediaSchema.parse(value)
    if (seen.has(parsed.url)) {
      continue
    }
    seen.add(parsed.url)
    media.push(parsed)
  }

  if (media.length > MAX_ASSISTANT_RESPONSE_MEDIA) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_MEDIA_LIMIT_EXCEEDED',
      `Assistant responses may attach at most ${MAX_ASSISTANT_RESPONSE_MEDIA} media items.`,
    )
  }

  return media
}

export function resolveAssistantActiveTurnContextFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): {
  sessionId: string | null
  turnId: string | null
} {
  return {
    sessionId: normalizeNullableString(env[MURPH_ASSISTANT_ACTIVE_SESSION_ID_ENV]),
    turnId: normalizeNullableString(env[MURPH_ASSISTANT_ACTIVE_TURN_ID_ENV]),
  }
}

export async function stageAssistantResponseMedia(input: {
  media: readonly AssistantResponseMedia[]
  sessionId?: string | null
  turnId: string
  vault: string
}): Promise<AssistantResponseMedia[]> {
  return await withAssistantRuntimeWriteLock(input.vault, async () => {
    const turnId = normalizeAssistantResponseMediaTurnId(input.turnId)
    const filePath = resolveAssistantResponseMediaPath({
      turnId,
      vault: input.vault,
    })
    const existing = await readAssistantResponseMedia({
      turnId,
      vault: input.vault,
    })
    const media = normalizeAssistantResponseMediaList([...existing, ...input.media])

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeJsonFileAtomic(
      filePath,
      assistantResponseMediaStoreSchema.parse({
        schema: ASSISTANT_RESPONSE_MEDIA_STORE_SCHEMA,
        turnId,
        sessionId: normalizeNullableString(input.sessionId),
        updatedAt: new Date().toISOString(),
        media,
      }),
    )

    return media
  })
}

export async function readAssistantResponseMedia(input: {
  turnId: string
  vault: string
}): Promise<AssistantResponseMedia[]> {
  const turnId = normalizeAssistantResponseMediaTurnId(input.turnId)
  const filePath = resolveAssistantResponseMediaPath({
    turnId,
    vault: input.vault,
  })
  const read = await readAssistantJsonFile<AssistantResponseMediaStore>({
    filePath,
    createDefault: () => ({
      schema: ASSISTANT_RESPONSE_MEDIA_STORE_SCHEMA,
      turnId,
      sessionId: null,
      updatedAt: new Date(0).toISOString(),
      media: [],
    }),
    parse: (value) => assistantResponseMediaStoreSchema.parse(value),
  })
  return read.value.media
}

export async function clearAssistantResponseMedia(input: {
  turnId: string
  vault: string
}): Promise<void> {
  const turnId = normalizeAssistantResponseMediaTurnId(input.turnId)
  await rm(resolveAssistantResponseMediaPath({ turnId, vault: input.vault }), {
    force: true,
  })
}

export async function clearAssistantResponseMediaBestEffort(input: {
  turnId: string
  vault: string
}): Promise<void> {
  await clearAssistantResponseMedia(input).catch(() => undefined)
}

export function resolveAssistantResponseMediaPath(input: {
  turnId: string
  vault: string
}): string {
  const turnId = normalizeAssistantResponseMediaTurnId(input.turnId)
  const paths = resolveAssistantStatePaths(input.vault)
  return path.join(paths.assistantStateRoot, 'response-media', `${turnId}.json`)
}

export function redactAssistantResponseMediaPath(input: {
  turnId: string
  vault: string
}): string {
  return redactAssistantDisplayPath(resolveAssistantResponseMediaPath(input))
}

export async function listAssistantMediaCatalog(input: {
  catalogUrl?: string | null
  env?: NodeJS.ProcessEnv
  fetchImplementation?: typeof fetch
  productBaseUrl?: string | null
  query?: string | null
  requestTimeoutMs?: number | null
} = {}): Promise<{
  catalogUrl: string
  items: AssistantMediaCatalogItem[]
  updatedAt: string | null
}> {
  const catalogUrl = resolveAssistantMediaCatalogUrl(input)
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_MEDIA_CATALOG_FETCH_UNAVAILABLE',
      'Assistant media catalog lookup requires fetch support in this Node.js runtime.',
    )
  }

  const requestTimeoutMs = normalizeAssistantMediaCatalogRequestTimeoutMs(
    input.requestTimeoutMs,
  )
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    const response = await fetchImplementation(catalogUrl, {
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new VaultCliError(
        'ASSISTANT_MEDIA_CATALOG_REQUEST_FAILED',
        `Assistant media catalog request failed with HTTP ${response.status}.`,
      )
    }

    const catalog = assistantMediaCatalogSchema.parse(await response.json())
    const queryTokens = normalizeMediaCatalogQueryTokens(input.query)
    const items = catalog.items
      .map((item) => ({
        ...item,
        url: resolveCatalogItemUrl(catalogUrl, item.url),
      }))
      .filter((item) => mediaCatalogItemMatchesQuery(item, queryTokens))

    return {
      catalogUrl,
      items,
      updatedAt: catalog.updatedAt,
    }
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new VaultCliError(
        'ASSISTANT_MEDIA_CATALOG_REQUEST_TIMEOUT',
        'Assistant media catalog request timed out.',
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function resolveAssistantMediaCatalogUrl(input: {
  catalogUrl?: string | null
  env?: NodeJS.ProcessEnv
  productBaseUrl?: string | null
}): string {
  const env = input.env ?? process.env
  const explicit = normalizeNullableString(input.catalogUrl)
    ?? normalizeNullableString(env[MURPH_ASSISTANT_MEDIA_CATALOG_URL_ENV])
  if (explicit) {
    return normalizeAssistantMediaCatalogUrl(explicit)
  }

  const productBaseUrl = normalizeNullableString(input.productBaseUrl)
    ?? normalizeNullableString(env.MURPH_PRODUCT_BASE_URL)
    ?? normalizeNullableString(env.NEXT_PUBLIC_MURPH_PRODUCT_BASE_URL)
  if (!productBaseUrl) {
    throw new VaultCliError(
      'ASSISTANT_MEDIA_CATALOG_URL_REQUIRED',
      `Set ${MURPH_ASSISTANT_MEDIA_CATALOG_URL_ENV} or MURPH_PRODUCT_BASE_URL to list assistant media.`,
    )
  }

  return normalizeAssistantMediaCatalogUrl(new URL(DEFAULT_ASSISTANT_MEDIA_CATALOG_PATH, productBaseUrl).toString())
}

function resolveCatalogItemUrl(catalogUrl: string, value: string): string {
  return normalizeAssistantResponseMediaUrl(new URL(value, catalogUrl).toString())
}

function normalizeAssistantMediaCatalogUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new VaultCliError('ASSISTANT_MEDIA_INVALID_URL', 'Assistant media catalog URL must be a valid URL.')
  }
  if (parsed.protocol !== 'https:') {
    throw new VaultCliError('ASSISTANT_MEDIA_INVALID_URL', 'Assistant media catalog URL must use HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new VaultCliError(
      'ASSISTANT_MEDIA_INVALID_URL',
      'Assistant media catalog URL must be a public URL without credentials, query strings, or fragments.',
    )
  }
  if (!isPublicAssistantMediaCatalogHost(parsed.hostname)) {
    throw new VaultCliError('ASSISTANT_MEDIA_INVALID_URL', 'Assistant media catalog URL must use a public host.')
  }
  return parsed.toString()
}

function isPublicAssistantMediaCatalogHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return false
  }

  const ipLiteral = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  return isIP(ipLiteral) === 0
}

function normalizeMediaCatalogQueryTokens(query: string | null | undefined): string[] {
  return (normalizeNullableString(query) ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function mediaCatalogItemMatchesQuery(
  item: AssistantMediaCatalogItem,
  queryTokens: readonly string[],
): boolean {
  if (queryTokens.length === 0) {
    return true
  }
  const haystack = [
    item.id,
    item.title,
    item.description,
    item.alt ?? '',
    ...item.tags,
  ].join(' ').toLowerCase()
  return queryTokens.every((token) => haystack.includes(token))
}

function normalizeAssistantMediaCatalogRequestTimeoutMs(
  value: number | null | undefined,
): number {
  if (value === undefined || value === null) {
    return DEFAULT_ASSISTANT_MEDIA_CATALOG_REQUEST_TIMEOUT_MS
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new VaultCliError(
      'ASSISTANT_MEDIA_CATALOG_TIMEOUT_INVALID',
      'Assistant media catalog request timeout must be a positive number of milliseconds.',
    )
  }
  return Math.floor(value)
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.name === 'AbortError'
  )
}

function normalizeAssistantResponseMediaTurnId(value: string): string {
  const normalized = normalizeNullableString(value)
  if (
    !normalized ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_MEDIA_TURN_REQUIRED',
      'Assistant response media staging requires a valid active turn id.',
    )
  }
  return normalized
}
