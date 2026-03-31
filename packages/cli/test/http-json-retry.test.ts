import assert from 'node:assert/strict'

import { test } from 'vitest'

import type { JsonFetchResponse } from '../src/http-json-retry.js'
import { readJsonErrorResponse } from '../src/http-json-retry.js'

function createSingleUseResponse(
  body: string,
): Pick<JsonFetchResponse, 'json' | 'text'> {
  let consumed = false

  const consume = (): string => {
    if (consumed) {
      throw new TypeError('Body already consumed.')
    }

    consumed = true
    return body
  }

  return {
    async json() {
      return JSON.parse(consume()) as unknown
    },
    async text() {
      return consume()
    },
  }
}

test('readJsonErrorResponse preserves plain-text bodies after JSON parsing fails', async () => {
  const result = await readJsonErrorResponse(createSingleUseResponse('gateway unavailable'))

  assert.equal(result.payload, null)
  assert.equal(result.rawText, 'gateway unavailable')
})

test('readJsonErrorResponse still returns parsed JSON payloads when available', async () => {
  const result = await readJsonErrorResponse(
    createSingleUseResponse('{"message":"temporary outage"}'),
  )

  assert.deepEqual(result.payload, { message: 'temporary outage' })
  assert.equal(result.rawText, null)
})
