import { normalizeNullableString } from './text/shared.js'

export const DEFAULT_XAI_API_BASE_URL = 'https://api.x.ai'
export const DEFAULT_XAI_X_SEARCH_MODEL = 'grok-4.5'

export function resolveXaiApiKey(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.XAI_API_KEY)
}

export function resolveXaiApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return normalizeNullableString(env.XAI_API_BASE_URL) ??
    DEFAULT_XAI_API_BASE_URL
}

export function resolveXaiXSearchModel(env: NodeJS.ProcessEnv): string {
  return normalizeNullableString(env.XAI_X_SEARCH_MODEL) ??
    DEFAULT_XAI_X_SEARCH_MODEL
}
