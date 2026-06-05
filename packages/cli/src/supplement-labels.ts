import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { z } from 'zod'

const DEFAULT_SUPPLEMENT_LABEL_LIMIT = 10
const MAX_SUPPLEMENT_LABEL_LIMIT = 50
const DEFAULT_SUPPLEMENT_LABEL_TIMEOUT_MS = 10_000
const MAX_SUPPLEMENT_LABEL_TIMEOUT_MS = 30_000
const GTIN_LENGTHS = new Set([8, 12, 13, 14])

export const supplementLabelSearchInputSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_SUPPLEMENT_LABEL_LIMIT).optional(),
  includeOffMarket: z.boolean().optional(),
})

export const supplementLabelSearchItemSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  name: z.string().min(1),
  brand: z.string().nullable(),
  upc: z.string().nullable(),
  offMarket: z.boolean(),
})

export const supplementLabelSearchResultSchema = z.object({
  source: z.literal('murph-data-api'),
  query: z.string().min(1),
  limit: z.number().int().positive().max(MAX_SUPPLEMENT_LABEL_LIMIT),
  includeOffMarket: z.boolean(),
  items: z.array(supplementLabelSearchItemSchema),
})

const supplementLabelsApiResponseSchema = z.object({
  items: z.array(supplementLabelSearchItemSchema),
})
const supplementLabelsApiItemResponseSchema = z.object({
  item: supplementLabelSearchItemSchema.extend({
    label: z.unknown().optional(),
  }),
})

export type SupplementLabelSearchInput = z.infer<typeof supplementLabelSearchInputSchema>
export type SupplementLabelSearchResult = z.infer<typeof supplementLabelSearchResultSchema>

type SupplementLabelLookupParam =
  | { key: 'id'; value: string }
  | { key: 'q'; value: string }
  | { key: 'upc'; value: string }

export async function searchSupplementLabels(
  rawInput: SupplementLabelSearchInput,
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: typeof fetch
  } = {},
): Promise<SupplementLabelSearchResult> {
  const input = supplementLabelSearchInputSchema.parse(rawInput)
  const env = dependencies.env ?? process.env
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const hostedWebBaseUrl = readHostedWebBaseUrl(env)

  if (!hostedWebBaseUrl) {
    throw new VaultCliError(
      'supplement_labels_api_unconfigured',
      'Supplement label search is not configured. Set HOSTED_WEB_BASE_URL before using this command.',
    )
  }

  const limit = input.limit ?? DEFAULT_SUPPLEMENT_LABEL_LIMIT
  const includeOffMarket = input.includeOffMarket ?? false
  const lookupParams = resolveSupplementLabelLookupParams(input.q)
  const payload = await fetchSupplementLabelsPayload({
    env,
    fetchImpl,
    hostedWebBaseUrl,
    includeOffMarket,
    limit,
    lookupParams,
  })

  return supplementLabelSearchResultSchema.parse({
    source: 'murph-data-api',
    query: input.q,
    limit,
    includeOffMarket,
    items: payload.items,
  })
}

function resolveSupplementLabelLookupParams(q: string): SupplementLabelLookupParam[] {
  const trimmed = q.trim()
  const digits = trimmed.replace(/\D/gu, '')

  if (/^[a-z][a-z0-9_-]*:\S+$/u.test(trimmed)) {
    return [{ key: 'id', value: trimmed }, { key: 'q', value: trimmed }]
  }

  if (/^\d+$/u.test(trimmed)) {
    return GTIN_LENGTHS.has(digits.length)
      ? [{ key: 'id', value: digits }, { key: 'upc', value: digits }]
      : [{ key: 'id', value: digits }]
  }

  if (/^[\d\s().-]+$/u.test(trimmed) && GTIN_LENGTHS.has(digits.length)) {
    return [{ key: 'upc', value: digits }]
  }

  return [{ key: 'q', value: trimmed }]
}

function readHostedWebBaseUrl(env: NodeJS.ProcessEnv): URL | null {
  const raw = normalizeNullableString(env.HOSTED_WEB_BASE_URL)
  if (!raw) {
    return null
  }

  try {
    return new URL(raw)
  } catch {
    throw new VaultCliError(
      'supplement_labels_api_invalid_base_url',
      'Supplement label search is misconfigured. HOSTED_WEB_BASE_URL must be an absolute URL.',
    )
  }
}

async function fetchSupplementLabelsApi(
  fetchImpl: typeof fetch,
  url: URL,
  env: NodeJS.ProcessEnv,
  options: {
    allowNotFound?: boolean
  } = {},
): Promise<Response> {
  let response: Response

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(resolveSupplementLabelTimeoutMs(env)),
    })
  } catch (error) {
    throw new VaultCliError(
      'supplement_labels_api_request_failed',
      `Supplement label search request failed: ${errorMessage(error)}.`,
    )
  }

  if (response.status === 404 && options.allowNotFound === true) {
    return response
  }

  if (!response.ok) {
    throw new VaultCliError(
      'supplement_labels_api_response_failed',
      `Supplement label search request failed (${await describeFailedSupplementLabelsResponse(response)}).`,
    )
  }

  return response
}

async function fetchSupplementLabelsPayload(input: {
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedWebBaseUrl: URL
  includeOffMarket: boolean
  limit: number
  lookupParams: SupplementLabelLookupParam[]
}): Promise<{ items: z.infer<typeof supplementLabelSearchItemSchema>[] }> {
  for (const lookup of input.lookupParams) {
    const url = new URL('/api/supplements', input.hostedWebBaseUrl)
    url.searchParams.set(lookup.key, lookup.value)
    url.searchParams.set('limit', String(input.limit))
    if (input.includeOffMarket) {
      url.searchParams.set('includeOffMarket', 'true')
    }

    const response = await fetchSupplementLabelsApi(input.fetchImpl, url, input.env, {
      allowNotFound: lookup.key !== 'q',
    })
    if (response.status === 404) {
      continue
    }

    return await parseSupplementLabelsApiPayload(response)
  }

  return { items: [] }
}

async function parseSupplementLabelsApiPayload(
  response: Response,
): Promise<{ items: z.infer<typeof supplementLabelSearchItemSchema>[] }> {
  const payload: unknown = await response.json()
  const search = supplementLabelsApiResponseSchema.safeParse(payload)
  if (search.success) {
    return search.data
  }

  const detail = supplementLabelsApiItemResponseSchema.parse(payload)
  const { label: _label, ...item } = detail.item

  return {
    items: [item],
  }
}

function resolveSupplementLabelTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = normalizeNullableString(env.MURPH_DATA_API_TIMEOUT_MS)
  if (!configured) {
    return DEFAULT_SUPPLEMENT_LABEL_TIMEOUT_MS
  }

  const parsed = Number.parseInt(configured, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_SUPPLEMENT_LABEL_TIMEOUT_MS
  }

  return Math.min(parsed, MAX_SUPPLEMENT_LABEL_TIMEOUT_MS)
}

async function describeFailedSupplementLabelsResponse(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`

  try {
    const payload = (await response.json()) as {
      error?: unknown
    }
    const error = typeof payload.error === 'string'
      ? normalizeNullableString(payload.error)
      : null

    return error ? `${fallback}: ${error}` : fallback
  } catch {
    return fallback
  }
}
