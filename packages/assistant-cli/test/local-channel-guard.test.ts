import assert from 'node:assert/strict'

import { test } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  assertLocalAssistantLinqIMessageChannelSupported,
  LOCAL_ASSISTANT_LINQ_IMESSAGE_ERROR,
  normalizeAssistantLocalChannel,
} from '../src/assistant/local-channel-guard.js'

test('local channel guard normalizes local aliases consistently', () => {
  assert.equal(normalizeAssistantLocalChannel(undefined), null)
  assert.equal(normalizeAssistantLocalChannel(null), null)
  assert.equal(normalizeAssistantLocalChannel('  telegram  '), 'telegram')
  assert.equal(normalizeAssistantLocalChannel(' iMessage '), 'linq')
  assert.equal(normalizeAssistantLocalChannel('i-message'), 'linq')
  assert.equal(normalizeAssistantLocalChannel(' LINQ '), 'linq')
})

test('local channel guard rejects local Linq and iMessage routes with shared text', () => {
  assert.throws(
    () => assertLocalAssistantLinqIMessageChannelSupported('imessage'),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.message, LOCAL_ASSISTANT_LINQ_IMESSAGE_ERROR)
      return true
    },
  )
})
