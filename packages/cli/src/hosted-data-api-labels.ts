import { Buffer } from 'node:buffer'

import { HOSTED_RUNTIME_PROCESS_ENV } from '@murphai/hosted-execution/cli-runtime-bridge'
import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { z } from 'zod'

export const DEFAULT_HOSTED_DATA_API_LABEL_LIMIT = 5
export const MAX_HOSTED_DATA_API_LABEL_LIMIT = 50
export const MAX_HOSTED_DATA_API_LABEL_BATCH_QUERIES = 50
export const MAX_HOSTED_DATA_API_LABEL_BATCH_QUERY_LENGTH = 256

const MAX_HOSTED_DATA_API_LABEL_BATCH_BODY_BYTES = 32 * 1024
const DEFAULT_HOSTED_DATA_API_LABEL_TIMEOUT_MS = 10_000
const MAX_HOSTED_DATA_API_LABEL_TIMEOUT_MS = 30_000
const HOSTED_DATA_API_LABELS_BASE_URL = 'http://murph-data-api.worker'

export const hostedDataApiLabelSearchInputSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_HOSTED_DATA_API_LABEL_LIMIT).optional(),
  includeOffMarket: z.boolean().optional(),
})

const hostedDataApiLabelContaminantConcernSchema = z.enum([
  'unknown',
  'none',
  'low',
  'medium',
  'high',
])

const hostedDataApiLabelContaminantResultOperatorSchema = z.enum([
  'eq',
  'lt',
  'lte',
  'gt',
  'gte',
  'not_detected',
  'detected',
  'trace',
])

const hostedDataApiLabelContaminantSourceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1).nullable(),
  reportTitle: z.string().min(1).nullable(),
  reportDate: z.string().min(1).nullable(),
})

const hostedDataApiLabelContaminantTestedProductSchema = z.object({
  name: z.string().min(1).nullable(),
  brand: z.string().min(1).nullable(),
  upc: z.string().min(1).nullable(),
  sourceProductId: z.string().min(1).nullable(),
  matchMethod: z.enum([
    'exact_upc',
    'exact_source_id',
    'manual_confirmed',
  ]),
})

const hostedDataApiLabelContaminantObservationSchema = z.object({
  contaminantKey: z.string().min(1),
  contaminantName: z.string().min(1),
  result: z.object({
    operator: hostedDataApiLabelContaminantResultOperatorSchema,
    value: z.number().nonnegative().nullable(),
    unit: z.string().min(1),
    basis: z.string().min(1),
  }),
  normalizedResult: z.object({
    value: z.number().nonnegative(),
    unit: z.string().min(1),
    basis: z.string().min(1),
  }).nullable(),
  source: hostedDataApiLabelContaminantSourceSchema,
  testedProduct: hostedDataApiLabelContaminantTestedProductSchema,
})

const hostedDataApiLabelContaminantsSchema = z.object({
  status: z.enum(['no_known_product_tests', 'known_product_tests']),
  murphConcernLevel: hostedDataApiLabelContaminantConcernSchema,
  alertCount: z.number().int().nonnegative(),
  alerts: z.array(z.object({
    contaminantKey: z.string().min(1),
    contaminantName: z.string().min(1),
    concernLevel: z.enum(['low', 'medium', 'high']),
    result: z.object({
      operator: hostedDataApiLabelContaminantResultOperatorSchema,
      value: z.number().nonnegative(),
      unit: z.string().min(1),
      basis: z.string().min(1),
    }),
    threshold: z.object({
      value: z.number().positive(),
      unit: z.string().min(1),
      basis: z.string().min(1),
      authority: z.string().min(1),
      name: z.string().min(1),
      url: z.string().min(1).nullable(),
    }),
    source: hostedDataApiLabelContaminantSourceSchema,
    testedProduct: hostedDataApiLabelContaminantTestedProductSchema,
  })).max(5),
  observationCount: z.number().int().nonnegative(),
  observations: z.array(hostedDataApiLabelContaminantObservationSchema).max(5),
})

export const hostedDataApiLabelSearchItemSchema = z.object({
  id: z.string().min(1),
  dataOrigin: z.string().min(1),
  dataOriginId: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().nullable(),
  upc: z.string().nullable(),
  offMarket: z.boolean(),
  label: z.json().optional(),
  contaminants: hostedDataApiLabelContaminantsSchema.optional(),
})

export const hostedDataApiLabelBatchSearchInputSchema = z.object({
  queries: z
    .array(z.string().trim().min(1).max(MAX_HOSTED_DATA_API_LABEL_BATCH_QUERY_LENGTH))
    .min(1)
    .max(MAX_HOSTED_DATA_API_LABEL_BATCH_QUERIES),
  limit: z.number().int().positive().max(MAX_HOSTED_DATA_API_LABEL_LIMIT).optional(),
  includeOffMarket: z.boolean().optional(),
})

const hostedDataApiLabelSearchResultItemSchema = z.object({
  query: z.string().min(1),
  items: z.array(hostedDataApiLabelSearchItemSchema),
})

export type HostedDataApiLabelSearchInput = z.infer<typeof hostedDataApiLabelSearchInputSchema>
export type HostedDataApiLabelSearchItem = z.infer<typeof hostedDataApiLabelSearchItemSchema>
export type HostedDataApiLabelBatchSearchInput = z.infer<typeof hostedDataApiLabelBatchSearchInputSchema>
export type HostedDataApiLabelSearchResultItem = z.infer<typeof hostedDataApiLabelSearchResultItemSchema>

export type HostedDataApiLabelsDependencies = {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

type HostedDataApiLabelsClientConfig<TSource extends string> = {
  apiPath: `/api/${string}`
  errorCodePrefix: string
  resultSource: TSource
  searchDescription: string
}

export function createHostedDataApiLabelSearchResultSchema<TSource extends string>(
  source: TSource,
) {
  return z.object({
    source: z.literal(source),
    query: z.string().min(1),
    limit: z.number().int().positive().max(MAX_HOSTED_DATA_API_LABEL_LIMIT),
    includeOffMarket: z.boolean(),
    items: z.array(hostedDataApiLabelSearchItemSchema),
  })
}

export function createHostedDataApiLabelBatchSearchResultSchema<TSource extends string>(
  source: TSource,
) {
  return z.object({
    source: z.literal(source),
    queries: z.array(z.string().min(1)).min(1).max(MAX_HOSTED_DATA_API_LABEL_BATCH_QUERIES),
    limit: z.number().int().positive().max(MAX_HOSTED_DATA_API_LABEL_LIMIT),
    includeOffMarket: z.boolean(),
    results: z.array(hostedDataApiLabelSearchResultItemSchema),
  })
}

export function createHostedDataApiLabelsClient<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
) {
  const searchResultSchema = createHostedDataApiLabelSearchResultSchema(config.resultSource)
  const batchSearchResultSchema =
    createHostedDataApiLabelBatchSearchResultSchema(config.resultSource)
  const apiResponseSchema = z.object({
    items: z.array(hostedDataApiLabelSearchItemSchema),
  })
  const batchApiResponseSchema = z.object({
    results: z.array(hostedDataApiLabelSearchResultItemSchema),
  })

  async function searchLabels(
    rawInput: HostedDataApiLabelSearchInput,
    dependencies: HostedDataApiLabelsDependencies = {},
  ): Promise<z.infer<typeof searchResultSchema>> {
    const input = hostedDataApiLabelSearchInputSchema.parse(rawInput)
    const { env, fetchImpl, apiBaseUrl } = resolveClient(config, dependencies)

    const limit = input.limit ?? DEFAULT_HOSTED_DATA_API_LABEL_LIMIT
    const includeOffMarket = input.includeOffMarket ?? false
    const url = new URL(config.apiPath, apiBaseUrl)
    url.searchParams.set('q', input.q)
    url.searchParams.set('limit', String(limit))
    if (includeOffMarket) {
      url.searchParams.set('includeOffMarket', 'true')
    }

    const response = await fetchLabelsApi(config, fetchImpl, url, env)
    const payload = await parseLabelsApiPayload(response, apiResponseSchema)

    return searchResultSchema.parse({
      source: config.resultSource,
      query: input.q,
      limit,
      includeOffMarket,
      items: payload.items,
    })
  }

  async function searchLabelsBatch(
    rawInput: HostedDataApiLabelBatchSearchInput,
    dependencies: HostedDataApiLabelsDependencies = {},
  ): Promise<z.infer<typeof batchSearchResultSchema>> {
    const input = hostedDataApiLabelBatchSearchInputSchema.parse(rawInput)
    const { env, fetchImpl, apiBaseUrl } = resolveClient(config, dependencies)

    const limit = input.limit ?? DEFAULT_HOSTED_DATA_API_LABEL_LIMIT
    const includeOffMarket = input.includeOffMarket ?? false
    const url = new URL(config.apiPath, apiBaseUrl)
    const body = JSON.stringify({
      queries: input.queries,
      limit,
      includeOffMarket,
    })
    const bodyBytes = Buffer.byteLength(body, 'utf8')

    if (bodyBytes > MAX_HOSTED_DATA_API_LABEL_BATCH_BODY_BYTES) {
      throw new VaultCliError(
        `${config.errorCodePrefix}_payload_too_large`,
        `${config.searchDescription} batch request is ${bodyBytes} bytes; maximum is ${MAX_HOSTED_DATA_API_LABEL_BATCH_BODY_BYTES} bytes (32 KB). Reduce the number or length of queries before retrying.`,
      )
    }

    const response = await fetchLabelsApi(config, fetchImpl, url, env, {
      body,
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    const payload = await parseLabelsBatchApiPayload(response, batchApiResponseSchema)

    return batchSearchResultSchema.parse({
      source: config.resultSource,
      queries: input.queries,
      limit,
      includeOffMarket,
      results: payload.results,
    })
  }

  return {
    batchSearchInputSchema: hostedDataApiLabelBatchSearchInputSchema,
    batchSearchResultSchema,
    searchInputSchema: hostedDataApiLabelSearchInputSchema,
    searchItemSchema: hostedDataApiLabelSearchItemSchema,
    searchLabels,
    searchLabelsBatch,
    searchResultSchema,
  }
}

function resolveClient<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  dependencies: HostedDataApiLabelsDependencies,
): {
  apiBaseUrl: URL
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
} {
  const env = dependencies.env ?? process.env
  const fetchImpl = dependencies.fetchImpl ?? fetch
  assertHostedRuntime(config, env)

  return {
    apiBaseUrl: new URL(HOSTED_DATA_API_LABELS_BASE_URL),
    env,
    fetchImpl,
  }
}

function assertHostedRuntime<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  env: NodeJS.ProcessEnv,
): void {
  if (env[HOSTED_RUNTIME_PROCESS_ENV] === '1') {
    return
  }

  throw new VaultCliError(
    `${config.errorCodePrefix}_hosted_only`,
    `${config.searchDescription} runs through the hosted Murph data API and is only available inside hosted assistant runtime.`,
  )
}

async function fetchLabelsApi<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  fetchImpl: typeof fetch,
  url: URL,
  env: NodeJS.ProcessEnv,
  options: {
    body?: BodyInit
    headers?: HeadersInit
    method?: 'GET' | 'POST'
  } = {},
): Promise<Response> {
  let response: Response

  try {
    const headers = new Headers(options.headers)
    headers.set('accept', 'application/json')
    response = await fetchImpl(url, {
      body: options.body,
      headers,
      method: options.method ?? 'GET',
      signal: AbortSignal.timeout(resolveLabelTimeoutMs(env)),
    })
  } catch (error) {
    throw new VaultCliError(
      `${config.errorCodePrefix}_request_failed`,
      `${config.searchDescription} request failed: ${errorMessage(error)}.`,
    )
  }

  if (!response.ok) {
    throw new VaultCliError(
      `${config.errorCodePrefix}_response_failed`,
      `${config.searchDescription} request failed (${await describeFailedLabelsResponse(response)}).`,
    )
  }

  return response
}

async function parseLabelsApiPayload(
  response: Response,
  responseSchema: z.ZodType<{ items: HostedDataApiLabelSearchItem[] }>,
): Promise<{ items: HostedDataApiLabelSearchItem[] }> {
  const payload: unknown = await response.json()
  return responseSchema.parse(payload)
}

async function parseLabelsBatchApiPayload(
  response: Response,
  responseSchema: z.ZodType<{ results: HostedDataApiLabelSearchResultItem[] }>,
): Promise<{ results: HostedDataApiLabelSearchResultItem[] }> {
  const payload: unknown = await response.json()
  return responseSchema.parse(payload)
}

function resolveLabelTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = normalizeNullableString(env.MURPH_DATA_API_TIMEOUT_MS)
  if (!configured) {
    return DEFAULT_HOSTED_DATA_API_LABEL_TIMEOUT_MS
  }

  const parsed = Number.parseInt(configured, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_HOSTED_DATA_API_LABEL_TIMEOUT_MS
  }

  return Math.min(parsed, MAX_HOSTED_DATA_API_LABEL_TIMEOUT_MS)
}

async function describeFailedLabelsResponse(response: Response): Promise<string> {
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
