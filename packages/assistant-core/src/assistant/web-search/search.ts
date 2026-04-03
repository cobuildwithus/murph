import {
  createAssistantWebSearchRuntimeContext,
  normalizeAssistantWebSearchRequest,
  resolveAssistantWebSearchProvider,
} from './config.js'
import {
  applyDomainFilterToAssistantSearchResults,
  dedupeAssistantWebSearchResults,
} from './results.js'
import { searchWithAssistantWebSearchProvider } from './providers.js'
import type {
  AssistantWebSearchRequest,
  AssistantWebSearchResponse,
} from './types.js'

export async function searchAssistantWeb(
  request: AssistantWebSearchRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantWebSearchResponse> {
  const normalizedRequest = normalizeAssistantWebSearchRequest(request, env)
  const provider = resolveAssistantWebSearchProvider({
    env,
    requestedProvider: normalizedRequest.provider,
  })
  const runtime = createAssistantWebSearchRuntimeContext(env)

  const providerResponse = await searchWithAssistantWebSearchProvider({
    provider,
    request: normalizedRequest,
    runtime,
  })
  const filteredResults = applyDomainFilterToAssistantSearchResults(
    providerResponse.results,
    normalizedRequest.domainFilter,
  )
  const boundedResults = dedupeAssistantWebSearchResults(filteredResults).slice(
    0,
    normalizedRequest.count,
  )

  return {
    provider,
    query: normalizedRequest.query,
    resultCount: boundedResults.length,
    results: boundedResults,
    filters: {
      country: normalizedRequest.country,
      language: normalizedRequest.language,
      freshness: normalizedRequest.freshness,
      dateAfter: normalizedRequest.dateAfter,
      dateBefore: normalizedRequest.dateBefore,
      domainFilter: normalizedRequest.domainFilter,
    },
    warnings: [
      ...normalizedRequest.warnings,
      ...providerResponse.warnings,
    ],
  }
}
