import { normalizeNullableString } from './text/shared.js'

export const DEFAULT_XAI_X_SEARCH_MODEL = 'grok-4.5'

export function resolveXaiApiKey(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.XAI_API_KEY)
}

export function resolveXaiXSearchModel(env: NodeJS.ProcessEnv): string {
  return normalizeNullableString(env.XAI_X_SEARCH_MODEL) ??
    DEFAULT_XAI_X_SEARCH_MODEL
}
