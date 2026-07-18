import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS,
  EXA_RESEARCH_SCOUT_ENDPOINT,
  EXA_RESEARCH_SCOUT_MODE,
  EXA_RESEARCH_SCOUT_PATH,
  EXA_RESEARCH_SCOUT_PROVIDER_NAME,
  buildExaResearchScoutRequest,
  researchScoutBatchInputSchema,
  researchScoutBatchResultSchema,
  researchScoutInputSchema,
  researchScoutResultSchema,
  type ResearchScoutBatchInput,
  type ResearchScoutBatchResult,
  type ResearchScoutInput,
  type ResearchScoutResult,
} from '@murphai/contracts'

export const DEFAULT_EXA_API_BASE_URL = 'https://api.exa.ai'
export const EXA_API_KEY_ENV = 'EXA_API_KEY'
const MAX_EXA_RESPONSE_BYTES = 256_000

export interface ExaResearchScoutClientDependencies {
  abortSignal?: AbortSignal | null
  beforeRequest?: (() => Promise<void> | void) | null
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

export function readExaApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return normalizeNullableString(env[EXA_API_KEY_ENV])
}

export async function fetchExaResearchScoutCandidates(
  rawInput: ResearchScoutInput,
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

  const fetchImpl = dependencies.fetchImpl ?? fetch
  const result = {
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
    response: await fetchExaResearchScoutResponse(
      input,
      apiKey,
      fetchImpl,
      dependencies.beforeRequest ?? null,
      dependencies.abortSignal ?? null,
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

  const fetchImpl = dependencies.fetchImpl ?? fetch
  const lanes: ResearchScoutBatchResult['lanes'] = []
  for (const lane of input.lanes) {
    lanes.push({
      label: lane.label,
      response: await fetchExaResearchScoutResponse(
        {
          profile: lane.profile,
          since: input.since,
          until: input.until,
          maxCandidates: input.maxCandidatesPerLane,
        },
        apiKey,
        fetchImpl,
        dependencies.beforeRequest ?? null,
        dependencies.abortSignal ?? null,
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

async function fetchExaResearchScoutResponse(
  input: ResearchScoutInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  beforeRequest: (() => Promise<void> | void) | null,
  abortSignal: AbortSignal | null,
): Promise<unknown> {
  await beforeRequest?.()
  const deadlineSignal = AbortSignal.timeout(DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS)
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, deadlineSignal])
    : deadlineSignal
  let response: Response
  try {
    response = await fetchImpl(new URL(
      EXA_RESEARCH_SCOUT_PATH,
      DEFAULT_EXA_API_BASE_URL,
    ), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(buildExaResearchScoutRequest(input)),
      signal,
    })
  } catch (error) {
    throw new VaultCliError(
      'research_exa_request_failed',
      `Exa research scout request failed: ${errorMessage(error)}.`,
    )
  }

  if (!response.ok) {
    throw new VaultCliError(
      'research_exa_request_failed',
      `Exa research scout request failed (${await describeFailedExaResponse(response)}).`,
    )
  }

  return await readBoundedExaJson(response)
}

async function readBoundedExaJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > MAX_EXA_RESPONSE_BYTES
  ) {
    throw new VaultCliError(
      'research_exa_request_failed',
      `Exa research scout response exceeded ${MAX_EXA_RESPONSE_BYTES} bytes.`,
    )
  }

  if (response.body === null) {
    throw new VaultCliError(
      'research_exa_request_failed',
      'Exa research scout returned an empty response.',
    )
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_EXA_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // The bounded failure below remains authoritative.
        }
        throw new VaultCliError(
          'research_exa_request_failed',
          `Exa research scout response exceeded ${MAX_EXA_RESPONSE_BYTES} bytes.`,
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof VaultCliError) throw error
    throw new VaultCliError(
      'research_exa_request_failed',
      `Exa research scout response failed while reading: ${errorMessage(error)}.`,
    )
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new VaultCliError(
      'research_exa_request_failed',
      'Exa research scout returned invalid JSON.',
    )
  }
}

async function describeFailedExaResponse(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`

  try {
    const payload = (await readBoundedExaJson(response)) as {
      error?: unknown
      message?: unknown
    }
    const message =
      typeof payload.message === 'string'
        ? normalizeNullableString(payload.message)
        : typeof payload.error === 'string'
          ? normalizeNullableString(payload.error)
          : null

    return message ? `${fallback}: ${message}` : fallback
  } catch {
    return fallback
  }
}
