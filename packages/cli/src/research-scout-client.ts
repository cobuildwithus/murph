import {
  Exa,
  type DeepObjectOutputSchema,
  type DeepSearchType,
  type RegularSearchOptions,
  type SearchResponse,
} from 'exa-js'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE,
  DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS,
  EXA_RESEARCH_SCOUT_CATEGORY,
  EXA_RESEARCH_SCOUT_ENDPOINT,
  EXA_RESEARCH_SCOUT_METHOD,
  EXA_RESEARCH_SCOUT_MODE,
  EXA_RESEARCH_SCOUT_PATH,
  EXA_RESEARCH_SCOUT_PROVIDER_NAME,
  MAX_RESEARCH_SCOUT_BATCH_LANES,
  MAX_RESEARCH_SCOUT_CANDIDATES,
  buildExaResearchScoutBatchLaneRequest,
  buildExaResearchScoutRequest,
  parseExaResearchScoutRequestBody,
  researchScoutBatchInputSchema,
  researchScoutBatchResultSchema,
  researchScoutInputSchema,
  researchScoutResultSchema,
  resolveResearchScoutProfileKind,
  type ExaResearchScoutRequestBody,
  type ResearchScoutBatchInput,
  type ResearchScoutBatchResult,
  type ResearchScoutResult,
} from '@murphai/contracts'

export {
  DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE,
  MAX_RESEARCH_SCOUT_BATCH_LANES,
  MAX_RESEARCH_SCOUT_CANDIDATES,
  buildExaResearchScoutRequest,
} from '@murphai/contracts'

export const DEFAULT_EXA_API_BASE_URL = 'https://api.exa.ai'
export const EXA_API_KEY_ENV = 'EXA_API_KEY'

export interface ExaResearchScoutClientDependencies {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export function readExaApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return normalizeNullableString(env[EXA_API_KEY_ENV])
}

export async function fetchExaResearchScoutCandidates(
  rawInput: unknown,
  dependencies: ExaResearchScoutClientDependencies = {},
): Promise<ResearchScoutResult> {
  const input = researchScoutInputSchema.parse(rawInput)
  const env = dependencies.env ?? process.env
  const apiKey = readExaApiKey(env)

  if (!apiKey) {
    throw new VaultCliError(
      'research_exa_token_missing',
      'Exa research scout is not configured. Set EXA_API_KEY in the runtime environment before using research scout.',
    )
  }

  const client = createExaResearchScoutClient(apiKey, dependencies)
  const result = {
    provider: {
      name: EXA_RESEARCH_SCOUT_PROVIDER_NAME,
      endpoint: EXA_RESEARCH_SCOUT_ENDPOINT,
      mode: EXA_RESEARCH_SCOUT_MODE,
    },
    privacy: {
      tokenSource: 'env',
      persistedByTool: false,
      sentProfileKind: resolveResearchScoutProfileKind(input.profile),
      rawVaultValuesSent: false,
    },
    response: await fetchExaResearchScoutResponse(
      buildExaResearchScoutRequest(input),
      client,
    ),
  } satisfies ResearchScoutResult

  return researchScoutResultSchema.parse(result)
}

export async function fetchExaResearchScoutBatchCandidates(
  rawInput: ResearchScoutBatchInput,
  dependencies: ExaResearchScoutClientDependencies = {},
): Promise<ResearchScoutBatchResult> {
  const input = researchScoutBatchInputSchema.parse(rawInput)
  const env = dependencies.env ?? process.env
  const apiKey = readExaApiKey(env)

  if (!apiKey) {
    throw new VaultCliError(
      'research_exa_token_missing',
      'Exa research scout is not configured. Set EXA_API_KEY in the runtime environment before using research scout.',
    )
  }

  const client = createExaResearchScoutClient(apiKey, dependencies)
  const lanes: ResearchScoutBatchResult['lanes'] = []
  for (const lane of input.lanes) {
    lanes.push({
      label: lane.label,
      response: await fetchExaResearchScoutResponse(
        buildExaResearchScoutBatchLaneRequest({
          profile: lane.profile,
          since: input.since,
          until: input.until,
          maxCandidates: input.maxCandidatesPerLane,
        }),
        client,
      ),
    })
  }

  return researchScoutBatchResultSchema.parse({
    provider: {
      name: EXA_RESEARCH_SCOUT_PROVIDER_NAME,
      endpoint: EXA_RESEARCH_SCOUT_ENDPOINT,
      mode: EXA_RESEARCH_SCOUT_MODE,
    },
    privacy: {
      tokenSource: 'env',
      persistedByTool: false,
      sentProfileKind: 'tag_profile',
      rawVaultValuesSent: false,
    },
    lanes,
  })
}

type ExaDeepSearchOptions = Extract<
  RegularSearchOptions,
  { type: DeepSearchType }
>

type ExaResearchPaperSearchOptions = Omit<
  ExaDeepSearchOptions,
  'category' | 'contents'
> & {
  category: typeof EXA_RESEARCH_SCOUT_CATEGORY
  contents: undefined
}

async function fetchExaResearchScoutResponse(
  requestBody: ExaResearchScoutRequestBody,
  client: RunnerScopedExaClient,
): Promise<unknown> {
  const options = buildExaResearchScoutSearchOptions(requestBody)

  try {
    const response: SearchResponse<{}> = await client.search(
      requestBody.query,
      toExaSdkSearchOptions(options),
    )
    return response
  } catch (error) {
    if (error instanceof VaultCliError) {
      throw error
    }
    throw createExaResearchScoutRequestError({
      failureStage: 'sdk',
      transportErrorName: readSafeErrorName(error),
    })
  }
}

function buildExaResearchScoutSearchOptions(
  requestBody: ExaResearchScoutRequestBody,
): ExaResearchPaperSearchOptions {
  const outputSchema: DeepObjectOutputSchema = {
    type: requestBody.outputSchema.type,
    properties: requestBody.outputSchema.properties,
    required: [...requestBody.outputSchema.required],
  }

  return {
    type: requestBody.type,
    category: requestBody.category,
    startPublishedDate: requestBody.startPublishedDate,
    endPublishedDate: requestBody.endPublishedDate,
    numResults: requestBody.numResults,
    moderation: requestBody.moderation,
    systemPrompt: requestBody.systemPrompt,
    outputSchema,
    contents: undefined,
  }
}

function toExaSdkSearchOptions(
  options: ExaResearchPaperSearchOptions,
): RegularSearchOptions & { contents: undefined } {
  // Exa supports this API category, but exa-js 2.17.0 omits it from the
  // category union. Keep the exception on this one literal while every other
  // field is reconstructed against the provider-owned options type.
  const category = options.category as NonNullable<
    ExaDeepSearchOptions['category']
  >
  return {
    type: options.type,
    category,
    startPublishedDate: options.startPublishedDate,
    endPublishedDate: options.endPublishedDate,
    numResults: options.numResults,
    moderation: options.moderation,
    systemPrompt: options.systemPrompt,
    outputSchema: options.outputSchema,
    contents: undefined,
  }
}

function createExaResearchScoutClient(
  apiKey: string,
  dependencies: ExaResearchScoutClientDependencies,
): RunnerScopedExaClient {
  return new RunnerScopedExaClient({
    apiKey,
    fetchImpl: dependencies.fetchImpl ?? fetch,
    callerSignal: dependencies.signal,
  })
}

class RunnerScopedExaClient extends Exa {
  private readonly apiKey: string
  private readonly callerSignal: AbortSignal | undefined
  private readonly fetchImpl: typeof fetch

  constructor(input: {
    apiKey: string
    callerSignal: AbortSignal | undefined
    fetchImpl: typeof fetch
  }) {
    super(input.apiKey, DEFAULT_EXA_API_BASE_URL)
    this.apiKey = input.apiKey
    this.callerSignal = input.callerSignal
    this.fetchImpl = input.fetchImpl
  }

  override async request<T = unknown>(
    endpoint: string,
    method: string,
    body?: unknown,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<T> {
    if (
      endpoint !== EXA_RESEARCH_SCOUT_PATH
      || method !== EXA_RESEARCH_SCOUT_METHOD
      || hasEntries(params)
      || hasEntries(headers)
      || parseExaResearchScoutRequestBody(body) === null
    ) {
      throw createExaResearchScoutRequestError({
        failureStage: 'request_shape',
      })
    }

    const timeoutSignal = AbortSignal.timeout(
      DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS,
    )
    const requestSignal = this.callerSignal
      ? AbortSignal.any([this.callerSignal, timeoutSignal])
      : timeoutSignal

    let response: Response
    try {
      response = await this.fetchImpl(
        `${DEFAULT_EXA_API_BASE_URL}${endpoint}`,
        {
          method,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json; charset=utf-8',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: requestSignal,
        },
      )
    } catch (error) {
      const timedOut = timeoutSignal.aborted
        && error === timeoutSignal.reason
      const abortedByCaller = this.callerSignal?.aborted === true
        && error === this.callerSignal.reason
      throw createExaResearchScoutRequestError({
        abortedByCaller,
        failureStage: 'request',
        timedOut,
        transportErrorName: readSafeErrorName(error),
      })
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw createExaResearchScoutRequestError({
        failureStage: 'response',
        status: response.status,
      })
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      const timedOut = timeoutSignal.aborted
        && error === timeoutSignal.reason
      const abortedByCaller = this.callerSignal?.aborted === true
        && error === this.callerSignal.reason
      throw createExaResearchScoutRequestError({
        abortedByCaller,
        failureStage: 'response_body',
        status: response.status,
        timedOut,
        transportErrorName: readSafeErrorName(error),
      })
    }

    // Exa's generic request method establishes T from the operation that calls
    // it. The public search method owns that selection; Murph still validates
    // the enclosing result with its local Zod contract before returning it.
    return payload as T
  }
}

function hasEntries(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0
}

function createExaResearchScoutRequestError(input: {
  abortedByCaller?: boolean
  failureStage: string
  status?: number
  timedOut?: boolean
  transportErrorName?: string
}): VaultCliError {
  const message = input.timedOut === true
    ? 'Exa research scout request timed out.'
    : input.abortedByCaller === true
      ? 'Exa research scout request was aborted.'
      : 'Exa research scout request failed.'

  return new VaultCliError(
    'research_exa_request_failed',
    message,
    {
      abortedByCaller: input.abortedByCaller === true,
      failureStage: input.failureStage,
      status: input.status,
      timedOut: input.timedOut === true,
      transportErrorName: input.transportErrorName,
    },
  )
}

function readSafeErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const name = normalizeNullableString(error.name)
  return name && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
    ? name
    : undefined
}
