import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { z } from 'zod'

const DEFAULT_SUPPLEMENT_LABEL_LIMIT = 10
const MAX_SUPPLEMENT_LABEL_LIMIT = 50
const DEFAULT_SUPPLEMENT_LABEL_TIMEOUT_MS = 10_000
const MAX_SUPPLEMENT_LABEL_TIMEOUT_MS = 30_000

export const supplementLabelSearchInputSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_SUPPLEMENT_LABEL_LIMIT).optional(),
  includeOffMarket: z.boolean().optional(),
})

export const supplementLabelSearchItemSchema = z.object({
  id: z.string().min(1),
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

export type SupplementLabelSearchInput = z.infer<typeof supplementLabelSearchInputSchema>
export type SupplementLabelSearchResult = z.infer<typeof supplementLabelSearchResultSchema>

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
  const url = new URL('/api/supplements', hostedWebBaseUrl)
  url.searchParams.set('q', input.q)
  url.searchParams.set('limit', String(limit))
  if (includeOffMarket) {
    url.searchParams.set('includeOffMarket', 'true')
  }

  const response = await fetchSupplementLabelsApi(fetchImpl, url, env)
  const payload = supplementLabelsApiResponseSchema.parse(await response.json())

  return supplementLabelSearchResultSchema.parse({
    source: 'murph-data-api',
    query: input.q,
    limit,
    includeOffMarket,
    items: payload.items,
  })
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

  if (!response.ok) {
    throw new VaultCliError(
      'supplement_labels_api_response_failed',
      `Supplement label search request failed (${await describeFailedSupplementLabelsResponse(response)}).`,
    )
  }

  return response
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
