import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_RESEARCH_SCOUT_BATCH_CANDIDATES_PER_LANE,
  DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS,
  EXA_RESEARCH_SCOUT_ENDPOINT,
  EXA_RESEARCH_SCOUT_MODE,
  EXA_RESEARCH_SCOUT_PATH,
  EXA_RESEARCH_SCOUT_PROVIDER_NAME,
  MAX_RESEARCH_SCOUT_BATCH_LANES,
  MAX_RESEARCH_SCOUT_CANDIDATES,
  buildExaResearchScoutBatchLaneRequest,
  buildExaResearchScoutRequest,
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
      sentProfileKind: resolveResearchScoutProfileKind(input.profile),
      rawVaultValuesSent: false,
    },
    response: await fetchExaResearchScoutResponse(
      buildExaResearchScoutRequest(input),
      apiKey,
      fetchImpl,
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
        buildExaResearchScoutBatchLaneRequest({
          profile: lane.profile,
          since: input.since,
          until: input.until,
          maxCandidates: input.maxCandidatesPerLane,
        }),
        apiKey,
        fetchImpl,
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
  requestBody: ExaResearchScoutRequestBody,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
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
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS),
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

  return await response.json()
}

async function describeFailedExaResponse(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`

  try {
    const payload = (await response.json()) as {
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
