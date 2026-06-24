import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS,
  EXA_RESEARCH_SCOUT_ENDPOINT,
  EXA_RESEARCH_SCOUT_MODE,
  EXA_RESEARCH_SCOUT_PROVIDER_NAME,
  buildExaResearchScoutRequest,
  researchScoutInputSchema,
  researchScoutResultSchema,
  type ResearchScoutInput,
  type ResearchScoutResult,
} from '@murphai/contracts'

export { buildExaResearchScoutRequest } from '@murphai/contracts'

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
  let response: Response
  try {
    response = await fetchImpl(new URL('/search', DEFAULT_EXA_API_BASE_URL), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(buildExaResearchScoutRequest(input)),
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
    response: await response.json(),
  } satisfies ResearchScoutResult

  return researchScoutResultSchema.parse(result)
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
