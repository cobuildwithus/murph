import { expect, test } from 'vitest'

import {
  DEFAULT_XAI_API_BASE_URL,
  DEFAULT_XAI_X_SEARCH_MODEL,
  resolveXaiApiBaseUrl,
  resolveXaiApiKey,
  resolveXaiXSearchModel,
} from '../src/xai-runtime.ts'

test('xai runtime resolves the API key only when present and non-blank', () => {
  expect(resolveXaiApiKey({})).toBeNull()
  expect(resolveXaiApiKey({ XAI_API_KEY: '   ' })).toBeNull()
  expect(resolveXaiApiKey({ XAI_API_KEY: ' xai-key ' })).toBe('xai-key')
})

test('xai runtime defaults the API base URL and honors overrides', () => {
  expect(resolveXaiApiBaseUrl({})).toBe(DEFAULT_XAI_API_BASE_URL)
  expect(resolveXaiApiBaseUrl({ XAI_API_BASE_URL: '  ' }))
    .toBe(DEFAULT_XAI_API_BASE_URL)
  expect(resolveXaiApiBaseUrl({ XAI_API_BASE_URL: 'https://xai.example.test' }))
    .toBe('https://xai.example.test')
})

test('xai runtime defaults the x_search model and honors overrides', () => {
  expect(resolveXaiXSearchModel({})).toBe(DEFAULT_XAI_X_SEARCH_MODEL)
  expect(resolveXaiXSearchModel({ XAI_X_SEARCH_MODEL: ' ' }))
    .toBe(DEFAULT_XAI_X_SEARCH_MODEL)
  expect(resolveXaiXSearchModel({ XAI_X_SEARCH_MODEL: 'grok-5' }))
    .toBe('grok-5')
})
