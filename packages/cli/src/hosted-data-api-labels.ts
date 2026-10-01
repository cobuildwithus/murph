import { Buffer } from 'node:buffer'

import { HOSTED_RUNTIME_PROCESS_ENV } from '@murphai/hosted-execution/env'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import * as z from '@murphai/contracts/zod-runtime'

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
  'range',
  'not_detected',
  'detected',
  'trace',
])

const hostedDataApiLabelContaminantEvidenceTypeSchema = z.enum([
  'laboratory_measurement',
  'regulatory_laboratory',
  'regulatory_finding',
  'xrf_screening',
  'manufacturer_coa',
])

const hostedDataApiLabelContaminantMeasurementMetadataSchema = z.object({
  value: z.number().nonnegative(),
  unit: z.string().min(1),
})

const hostedDataApiLabelContaminantResultMetadataSchema = {
  upperValue: z.number().nonnegative().nullable().optional(),
  qualifier: z.string().min(1).nullable().optional(),
  detectionLimit:
    hostedDataApiLabelContaminantMeasurementMetadataSchema.nullable().optional(),
  quantificationLimit:
    hostedDataApiLabelContaminantMeasurementMetadataSchema.nullable().optional(),
  reportingLimit:
    hostedDataApiLabelContaminantMeasurementMetadataSchema.nullable().optional(),
  uncertainty:
    hostedDataApiLabelContaminantMeasurementMetadataSchema.nullable().optional(),
}

const hostedDataApiLabelContaminantSampleSchema = z.object({
  evidenceType: hostedDataApiLabelContaminantEvidenceTypeSchema,
  samplingContext: z.string().min(1),
  sourceSampleId: z.string().min(1).nullable(),
  sampleCount: z.number().int().positive().nullable().optional(),
  reportedUpc: z.string().min(1).nullable().optional(),
  lotCode: z.string().min(1).nullable(),
  bestBy: z.string().min(1).nullable(),
  packageSize: z.string().min(1).nullable(),
  collectedOn: z.string().min(1).nullable(),
  testedOn: z.string().min(1).nullable(),
  labName: z.string().min(1).nullable(),
  testMethod: z.string().min(1).nullable(),
})

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
    ...hostedDataApiLabelContaminantResultMetadataSchema,
  }),
  normalizedResult: z.object({
    value: z.number().nonnegative(),
    upperValue: z.number().nonnegative().nullable().optional(),
    unit: z.string().min(1),
    basis: z.string().min(1),
  }).nullable(),
  source: hostedDataApiLabelContaminantSourceSchema,
  testedProduct: hostedDataApiLabelContaminantTestedProductSchema,
  sample: hostedDataApiLabelContaminantSampleSchema.optional(),
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
      ...hostedDataApiLabelContaminantResultMetadataSchema,
    }),
    threshold: z.object({
      value: z.number().positive(),
      unit: z.string().min(1),
      basis: z.string().min(1),
      authority: z.string().min(1),
      name: z.string().min(1),
      url: z.string().min(1).nullable(),
    }),
    screeningPolicy: z.object({
      id: z.string().min(1),
      assumedBodyWeightKg: z.number().positive(),
      assumedServingsPerDay: z.number().positive(),
      servingGrams: z.number().positive(),
      exposure: z.object({
        value: z.number().nonnegative(),
        unit: z.string().min(1),
        basis: z.string().min(1),
      }),
      ratio: z.number().nonnegative(),
    }).optional(),
    source: hostedDataApiLabelContaminantSourceSchema,
    testedProduct: hostedDataApiLabelContaminantTestedProductSchema,
    sample: hostedDataApiLabelContaminantSampleSchema.optional(),
  })).max(5),
  observationCount: z.number().int().nonnegative(),
  observations: z.array(hostedDataApiLabelContaminantObservationSchema),
})

const hostedDataApiLabelContaminantSummaryResultSchema = z.object({
  operator: hostedDataApiLabelContaminantResultOperatorSchema,
  value: z.number().nonnegative().nullable(),
  upperValue: z.number().nonnegative().nullable().optional(),
  unit: z.string().min(1),
  basis: z.string().min(1),
})

const hostedDataApiLabelContaminantSummarySourceSchema = z.object({
  name: z.string().min(1),
  reportDate: z.string().min(1).nullable(),
})

const hostedDataApiLabelContaminantSummarySchema = z.object({
  status: z.enum(['no_known_product_tests', 'known_product_tests']),
  murphConcernLevel: hostedDataApiLabelContaminantConcernSchema,
  alertCount: z.number().int().nonnegative(),
  alertsTruncated: z.boolean(),
  alerts: z.array(z.object({
    contaminantKey: z.string().min(1),
    contaminantName: z.string().min(1),
    concernLevel: z.enum(['low', 'medium', 'high']),
    result: hostedDataApiLabelContaminantSummaryResultSchema.extend({
      value: z.number().nonnegative(),
    }).omit({ upperValue: true }),
    threshold: z.object({
      value: z.number().positive(),
      unit: z.string().min(1),
      basis: z.string().min(1),
      authority: z.string().min(1),
      name: z.string().min(1),
    }),
    screeningPolicy: z.object({
      id: z.string().min(1),
      assumedBodyWeightKg: z.number().positive(),
      assumedServingsPerDay: z.number().positive(),
      servingGrams: z.number().positive(),
      exposure: z.object({
        value: z.number().nonnegative(),
        unit: z.string().min(1),
        basis: z.string().min(1),
      }),
      ratio: z.number().nonnegative(),
    }).optional(),
    source: hostedDataApiLabelContaminantSummarySourceSchema,
  })).max(5),
  observationCount: z.number().int().nonnegative(),
  observationsTruncated: z.boolean(),
  observations: z.array(z.object({
    contaminantKey: z.string().min(1),
    contaminantName: z.string().min(1),
    result: hostedDataApiLabelContaminantSummaryResultSchema,
    source: hostedDataApiLabelContaminantSummarySourceSchema,
  })).max(5),
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
  contaminantSummary: hostedDataApiLabelContaminantSummarySchema.optional(),
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
export type HostedDataApiLabelGenericSearchInput = HostedDataApiLabelSearchInput & {
  genericOnly?: boolean
  nutritionOnly?: boolean
}
export type HostedDataApiLabelGenericBatchSearchInput = HostedDataApiLabelBatchSearchInput & {
  genericOnly?: boolean
  nutritionOnly?: boolean
}

const hostedDataApiLabelGenericSearchInputSchema = hostedDataApiLabelSearchInputSchema.extend({
  genericOnly: z.boolean().optional(),
  nutritionOnly: z.boolean().optional(),
})

const hostedDataApiLabelGenericBatchSearchInputSchema =
  hostedDataApiLabelBatchSearchInputSchema.extend({
    genericOnly: z.boolean().optional(),
    nutritionOnly: z.boolean().optional(),
  })

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
    genericOnly: z.boolean().optional(),
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
    genericOnly: z.boolean().optional(),
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
    rawInput: HostedDataApiLabelGenericSearchInput,
    dependencies: HostedDataApiLabelsDependencies = {},
  ): Promise<z.infer<typeof searchResultSchema>> {
    const input = hostedDataApiLabelGenericSearchInputSchema.parse(rawInput)
    const { env, fetchImpl, apiBaseUrl } = resolveClient(config, dependencies)

    const limit = input.limit ?? DEFAULT_HOSTED_DATA_API_LABEL_LIMIT
    const includeOffMarket = input.includeOffMarket ?? false
    const genericOnly = input.genericOnly ?? false
    const nutritionOnly = input.nutritionOnly ?? false
    const url = new URL(config.apiPath, apiBaseUrl)
    url.searchParams.set('q', input.q)
    url.searchParams.set('limit', String(limit))
    if (includeOffMarket) {
      url.searchParams.set('includeOffMarket', 'true')
    }
    if (genericOnly) {
      url.searchParams.set('genericOnly', 'true')
    }
    if (nutritionOnly) {
      url.searchParams.set('nutritionOnly', 'true')
    }

    const payload = await fetchLabelsApiPayload(
      config,
      fetchImpl,
      url,
      env,
      apiResponseSchema,
    )

    return searchResultSchema.parse({
      source: config.resultSource,
      query: input.q,
      limit,
      includeOffMarket,
      ...(genericOnly ? { genericOnly } : {}),
      items: payload.items,
    })
  }

  async function searchLabelsBatch(
    rawInput: HostedDataApiLabelGenericBatchSearchInput,
    dependencies: HostedDataApiLabelsDependencies = {},
  ): Promise<z.infer<typeof batchSearchResultSchema>> {
    const input = hostedDataApiLabelGenericBatchSearchInputSchema.parse(rawInput)
    const { env, fetchImpl, apiBaseUrl } = resolveClient(config, dependencies)

    const limit = input.limit ?? DEFAULT_HOSTED_DATA_API_LABEL_LIMIT
    const includeOffMarket = input.includeOffMarket ?? false
    const genericOnly = input.genericOnly ?? false
    const nutritionOnly = input.nutritionOnly ?? false
    const url = new URL(config.apiPath, apiBaseUrl)
    const body = JSON.stringify({
      queries: input.queries,
      limit,
      includeOffMarket,
      ...(genericOnly ? { genericOnly } : {}),
      ...(nutritionOnly ? { nutritionOnly } : {}),
    })
    const bodyBytes = Buffer.byteLength(body, 'utf8')

    if (bodyBytes > MAX_HOSTED_DATA_API_LABEL_BATCH_BODY_BYTES) {
      throw new VaultCliError(
        `${config.errorCodePrefix}_payload_too_large`,
        `${config.searchDescription} batch request is ${bodyBytes} bytes; maximum is ${MAX_HOSTED_DATA_API_LABEL_BATCH_BODY_BYTES} bytes (32 KB). Reduce the number or length of queries before retrying.`,
      )
    }

    const payload = await fetchLabelsApiPayload(
      config,
      fetchImpl,
      url,
      env,
      batchApiResponseSchema,
      {
        body,
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    return batchSearchResultSchema.parse({
      source: config.resultSource,
      queries: input.queries,
      limit,
      includeOffMarket,
      ...(genericOnly ? { genericOnly } : {}),
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
    { retryable: false, stage: 'configuration' },
  )
}

async function fetchLabelsApiPayload<TSource extends string, TPayload>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  fetchImpl: typeof fetch,
  url: URL,
  env: NodeJS.ProcessEnv,
  responseSchema: z.ZodType<TPayload>,
  options: {
    body?: BodyInit
    headers?: HeadersInit
    method?: 'GET' | 'POST'
  } = {},
): Promise<TPayload> {
  let response: Response
  const providerCredential = readHostedDataApiProviderCredential(config, env)

  try {
    const headers = new Headers(options.headers)
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bearer ${providerCredential}`)
    response = await fetchImpl(url, {
      body: options.body,
      headers,
      method: options.method ?? 'GET',
      signal: AbortSignal.timeout(resolveLabelTimeoutMs(env)),
    })
  } catch (error) {
    throw createLabelsTransportError(config, error)
  }

  if (!response.ok) {
    await discardLabelsResponseBody(response)
    throw createLabelsHttpError(config, response.status)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch (error) {
    if (readSafeErrorName(error) !== 'SyntaxError') {
      throw createLabelsResponseBodyTransportError(config, response.status, error)
    }

    throw createLabelsInvalidResponseError(config, response.status, 'json')
  }

  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) {
    throw createLabelsInvalidResponseError(config, response.status, 'schema')
  }

  return parsed.data
}

function readHostedDataApiProviderCredential<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  env: NodeJS.ProcessEnv,
): string {
  const credential = normalizeNullableString(env.MURPH_DATA_API_KEY)
  if (credential) {
    return credential
  }

  throw new VaultCliError(
    `${config.errorCodePrefix}_credential_missing`,
    `${config.searchDescription} requires the hosted Murph data API provider credential.`,
    { retryable: false, stage: 'configuration' },
  )
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

async function discardLabelsResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The status is sufficient to classify the failure; body disposal is best effort.
  }
}

function createLabelsTransportError<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  error: unknown,
): VaultCliError {
  const transportErrorName = readSafeErrorName(error)
  const transportErrorCode = readSafeErrorCode(error)
  const cancelled = transportErrorName === 'AbortError'
  const timedOut = transportErrorName === 'TimeoutError'
  const message = cancelled
    ? `${config.searchDescription} request was cancelled.`
    : timedOut
      ? `${config.searchDescription} request timed out.`
      : `${config.searchDescription} request failed before receiving a response.`

  return new VaultCliError(
    cancelled
      ? `${config.errorCodePrefix}_request_cancelled`
      : timedOut
        ? `${config.errorCodePrefix}_request_timed_out`
        : `${config.errorCodePrefix}_request_failed`,
    appendLabelsTransportClassification(
      message,
      transportErrorName,
      transportErrorCode,
    ),
    {
      failureStage: 'request',
      retryable: !cancelled,
      stage: 'transport',
      timedOut,
      transportErrorName,
      transportErrorCode,
    },
  )
}

function createLabelsResponseBodyTransportError<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  status: number,
  error: unknown,
): VaultCliError {
  const transportErrorName = readSafeErrorName(error)
  const transportErrorCode = readSafeErrorCode(error)
  const timedOut = transportErrorName === 'TimeoutError'
    || transportErrorName === 'AbortError'
  const message = timedOut
    ? `${config.searchDescription} response body timed out (HTTP ${status}).`
    : `${config.searchDescription} received a response whose body could not be read (HTTP ${status}).`

  return new VaultCliError(
    timedOut
      ? `${config.errorCodePrefix}_response_body_timed_out`
      : `${config.errorCodePrefix}_response_body_failed`,
    appendLabelsTransportClassification(
      message,
      transportErrorName,
      transportErrorCode,
    ),
    {
      failureStage: 'response_body',
      retryable: true,
      stage: 'response',
      status,
      timedOut,
      transportErrorName,
      transportErrorCode,
    },
  )
}

function createLabelsHttpError<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  status: number,
): VaultCliError {
  const failure = classifyLabelsHttpFailure(config.searchDescription, status)

  return new VaultCliError(
    `${config.errorCodePrefix}_${failure.codeSuffix}`,
    failure.message,
    {
      failureStage: 'response',
      retryable: failure.retryable,
      stage: 'response',
      status,
      ...(failure.timedOut === true ? { timedOut: true } : {}),
    },
  )
}

interface LabelsHttpFailure {
  codeSuffix: string
  message: string
  retryable: boolean
  timedOut?: true
}

function classifyLabelsHttpFailure(
  searchDescription: string,
  status: number,
): LabelsHttpFailure {
  if (status === 401 || status === 403) {
    return {
      codeSuffix: 'auth_failed',
      message: `${searchDescription} authorization was rejected by the hosted data API (HTTP ${status}).`,
      retryable: false,
    }
  }

  if (status === 429) {
    return {
      codeSuffix: 'rate_limited',
      message: `${searchDescription} was rate limited by the hosted data API (HTTP ${status}).`,
      retryable: true,
    }
  }
  if (status === 408) {
    return {
      codeSuffix: 'request_timed_out',
      message: `${searchDescription} request timed out at the hosted data API (HTTP ${status}).`,
      retryable: true,
      timedOut: true,
    }
  }

  if (status >= 500 && status <= 599) {
    return {
      codeSuffix: 'service_unavailable',
      message: `${searchDescription} is temporarily unavailable (HTTP ${status}).`,
      retryable: true,
    }
  }

  return {
    codeSuffix: 'response_failed',
    message: `${searchDescription} request was rejected by the hosted data API (HTTP ${status}).`,
    retryable: false,
  }
}

function createLabelsInvalidResponseError<TSource extends string>(
  config: HostedDataApiLabelsClientConfig<TSource>,
  status: number,
  responseKind: 'json' | 'schema',
): VaultCliError {
  return new VaultCliError(
    `${config.errorCodePrefix}_invalid_response`,
    responseKind === 'json'
      ? `${config.searchDescription} received a successful response that was not valid JSON (HTTP ${status}).`
      : `${config.searchDescription} received a successful response that did not match the expected label schema (HTTP ${status}).`,
    {
      failureStage: 'response_validation',
      retryable: false,
      stage: 'response',
      status,
    },
  )
}

function appendLabelsTransportClassification(
  message: string,
  errorName: string | undefined,
  errorCode: string | undefined,
): string {
  const classification = [
    errorName ? `name=${errorName}` : undefined,
    errorCode ? `code=${errorCode}` : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(', ')

  return classification
    ? `${message} Transport classification: ${classification}.`
    : message
}

function readSafeErrorName(error: unknown): string | undefined {
  if (
    typeof error !== 'object'
    || error === null
    || !('name' in error)
    || typeof error.name !== 'string'
  ) {
    return undefined
  }

  const name = normalizeNullableString(error.name)
  return name && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
    ? name
    : undefined
}

function readSafeErrorCode(error: unknown): string | undefined {
  if (
    typeof error !== 'object'
    || error === null
    || !('code' in error)
    || typeof error.code !== 'string'
  ) {
    return undefined
  }

  const code = normalizeNullableString(error.code)
  return code && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(code)
    ? code
    : undefined
}
