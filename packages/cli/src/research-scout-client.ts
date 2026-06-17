import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_EXA_RESEARCH_SCOUT_TIMEOUT_MS,
  EXA_RESEARCH_SCOUT_ENDPOINT,
  EXA_RESEARCH_SCOUT_MODE,
  EXA_RESEARCH_SCOUT_PROVIDER_NAME,
  buildExaResearchScoutRequest,
  exaResearchScoutStructuredOutputSchema,
  researchCandidateSchema,
  researchScoutInputSchema,
  researchScoutResultSchema,
  type ExaResearchScoutStructuredCandidate,
  type ResearchCandidate,
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

interface ExaSearchResponse {
  output?: {
    content?: unknown
  }
  results?: ExaSearchResult[]
}

interface ExaSearchResult {
  author?: unknown
  publishedDate?: unknown
  title?: unknown
  url?: unknown
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

  const payload = (await response.json()) as ExaSearchResponse
  return normalizeExaResearchScoutResponse(payload, input)
}

export function candidateClearsResearchScoutGate(candidate: ResearchCandidate): boolean {
  if (candidate.hypeRisk === 'high') return false
  if (candidate.evidenceStrength === 'weak') return false
  if (candidate.studyType === 'preclinical') return false
  if (candidate.studyType === 'news_or_commentary') return false
  if (candidate.matchedProfileTags.length === 0) return false
  return true
}

function normalizeExaResearchScoutResponse(
  payload: ExaSearchResponse,
  input: ResearchScoutInput,
): ResearchScoutResult {
  const structuredOutput = parseExaStructuredOutput(payload.output?.content)
  const results = Array.isArray(payload.results) ? payload.results : []
  const warnings: string[] = []
  const candidates: ResearchCandidate[] = []
  let droppedCandidateCount = 0

  for (const candidate of structuredOutput.candidates) {
    const normalized = normalizeExaResearchCandidate(candidate, results)
    if (!candidateClearsResearchScoutGate(normalized)) {
      droppedCandidateCount += 1
      continue
    }
    candidates.push(normalized)
  }

  if (droppedCandidateCount > 0) {
    warnings.push(
      `Dropped ${droppedCandidateCount} weak, generic, or unlinked research candidate${droppedCandidateCount === 1 ? '' : 's'}.`,
    )
  }

  const result = {
    provider: {
      name: EXA_RESEARCH_SCOUT_PROVIDER_NAME,
      endpoint: EXA_RESEARCH_SCOUT_ENDPOINT,
      mode: EXA_RESEARCH_SCOUT_MODE,
    },
    candidates: candidates.slice(0, input.maxCandidates),
    privacy: {
      tokenSource: 'env',
      persistedByTool: false,
      sentProfileKind: 'tag_profile',
      rawVaultValuesSent: false,
    },
    warnings,
  } satisfies ResearchScoutResult

  return researchScoutResultSchema.parse(result)
}

function parseExaStructuredOutput(content: unknown) {
  let parsed = content
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content)
    } catch {
      throw invalidExaResponseError()
    }
  }

  const output = exaResearchScoutStructuredOutputSchema.safeParse(parsed)
  if (!output.success) {
    throw invalidExaResponseError()
  }

  return output.data
}

function normalizeExaResearchCandidate(
  candidate: ExaResearchScoutStructuredCandidate,
  results: readonly ExaSearchResult[],
): ResearchCandidate {
  const source = results[candidate.resultIndex]
  const sourceUrl = typeof source?.url === 'string' ? normalizeNullableString(source.url) : null
  if (!sourceUrl || !isValidHttpUrl(sourceUrl)) {
    throw invalidExaResponseError()
  }

  const title = truncateString(
    normalizeNullableString(typeof source?.title === 'string' ? source.title : undefined)
      ?? 'Untitled research result',
    300,
  )
  const sourceName = truncateString(
    normalizeNullableString(typeof source?.author === 'string' ? source.author : undefined)
      ?? readHostnameLabel(sourceUrl)
      ?? '',
    120,
  )
  const publishedAt = truncateString(
    normalizeNullableString(
      typeof source?.publishedDate === 'string' ? source.publishedDate : undefined,
    ) ?? '',
    80,
  )

  const normalized = {
    title,
    sourceUrl,
    sourceName: sourceName || undefined,
    publishedAt: publishedAt || undefined,
    studyType: candidate.studyType,
    topics: candidate.matchedProfileTags.map((tag) => truncateString(tag, 80)),
    matchedProfileTags: candidate.matchedProfileTags,
    keyFinding: candidate.keyFinding,
    whyItMayMatter: candidate.whyItMayMatter,
    evidenceStrength: candidate.evidenceStrength,
    actionOrQuestion: candidate.actionOrQuestion,
    doNotOverinterpret: candidate.doNotOverinterpret,
    clinicianDiscussionOnly: true,
    hypeRisk: candidate.hypeRisk,
  } satisfies ResearchCandidate

  const parsed = researchCandidateSchema.safeParse(normalized)
  if (!parsed.success) {
    throw invalidExaResponseError()
  }
  return parsed.data
}

function readHostnameLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function truncateString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function invalidExaResponseError(): VaultCliError {
  return new VaultCliError(
    'research_exa_invalid_response',
    'Exa research scout returned an invalid structured response.',
  )
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
