import assert from 'node:assert/strict'

import { assistantPersonalitySettingIds } from '@murphai/contracts'
import { test } from 'vitest'

import {
  assistantPersonalityResultSchema,
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingSchema,
  assistantPersonalitySettingsResultSchema,
} from '../src/assistant-style-cli-contracts.ts'

const TEST_RESULT = {
  vault: '/tmp/vault',
  preferencesPath: 'bank/preferences.json',
  updated: true,
  recordedAt: '2026-07-10T12:00:00.000Z',
  settings: {
    humor: { value: 9, source: 'custom' },
    push: { value: 3, source: 'default' },
    detail: { value: 5, source: 'default' },
  },
} as const

test('assistant personality CLI contracts expose the closed setting and score domains', () => {
  assert.deepEqual(
    Object.keys(assistantPersonalitySettingsResultSchema.shape),
    [...assistantPersonalitySettingIds],
  )
  assert.equal(assistantPersonalitySettingSchema.parse('humor'), 'humor')
  assert.equal(assistantPersonalityScoreSchema.parse(0), 0)
  assert.equal(assistantPersonalityScoreSchema.parse(10), 10)
  assert.throws(() => assistantPersonalitySettingSchema.parse('honesty'))
  assert.throws(() => assistantPersonalityScoreSchema.parse(-1))
  assert.throws(() => assistantPersonalityScoreSchema.parse(11))
  assert.throws(() => assistantPersonalityScoreSchema.parse(3.5))
})

test('assistant personality results require every effective setting and reject extra state', () => {
  assert.deepEqual(assistantPersonalityResultSchema.parse(TEST_RESULT), TEST_RESULT)

  assert.throws(() =>
    assistantPersonalityResultSchema.parse({
      ...TEST_RESULT,
      settings: {
        humor: TEST_RESULT.settings.humor,
        push: TEST_RESULT.settings.push,
      },
    }),
  )
  assert.throws(() =>
    assistantPersonalityResultSchema.parse({
      ...TEST_RESULT,
      settings: {
        ...TEST_RESULT.settings,
        honesty: { value: 10, source: 'custom' },
      },
    }),
  )
})
