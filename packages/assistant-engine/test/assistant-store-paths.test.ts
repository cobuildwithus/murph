import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'

import {
  bindingInputFromLocator,
  bindingPatchFromLocator,
  createAssistantSessionId,
  normalizeProviderOptions,
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantConversationLookupKey,
} from '../src/assistant/store/paths.ts'
import { restoreEnvironmentVariable } from './test-helpers.js'

test('resolveAssistantConversationLookupKey ignores aliases and derives a stable routing key', () => {
  assert.equal(
    resolveAssistantConversationLookupKey({
      alias: 'chat:alice',
      channel: 'telegram',
      identityId: 'assistant:primary',
      threadId: 'thread/42',
    }),
    'channel:telegram|identity:assistant%3Aprimary|audience:indeterminate|thread:thread%2F42',
  )
})

test('resolveAssistantAliasKey prefers explicit aliases and otherwise derives a binding key', () => {
  assert.equal(
    resolveAssistantAliasKey({
      alias: 'chat:alice',
      channel: 'telegram',
      threadId: 'thread/42',
    }),
    'chat:alice',
  )

  assert.equal(
    resolveAssistantAliasKey({
      channel: 'telegram',
      identityId: 'assistant:primary',
      threadId: 'thread/42',
    }),
    'channel:telegram|identity:assistant%3Aprimary|audience:indeterminate|thread:thread%2F42',
  )
})

test('binding locator helpers merge conversation defaults with explicit overrides', () => {
  const input = {
    conversation: {
      channel: 'telegram',
      directness: 'group' as const,
      identityId: 'assistant:primary',
      participantId: 'contact:base',
      threadId: 'chat-base',
    },
    actorId: 'contact:override',
    threadId: 'chat-override',
    threadIsDirect: true,
  }

  assert.deepEqual(bindingInputFromLocator(input), {
    actorId: 'contact:override',
    channel: 'telegram',
    deliveryKind: null,
    identityId: 'assistant:primary',
    threadId: 'chat-override',
    threadIsDirect: true,
  })
  assert.deepEqual(bindingPatchFromLocator(input), {
    actorId: 'contact:override',
    channel: 'telegram',
    deliveryKind: 'thread',
    deliveryTarget: 'chat-override',
    identityId: 'assistant:primary',
    threadId: 'chat-override',
    threadIsDirect: true,
  })
  assert.deepEqual(
    bindingPatchFromLocator({
      conversation: {
        channel: 'telegram',
      },
      deliveryKind: null,
    }),
    {
      channel: 'telegram',
      deliveryKind: null,
    },
  )
})

test('binding patch preserves blinded Linq thread ids while binding raw delivery routes', () => {
  assert.deepEqual(
    bindingPatchFromLocator({
      bindingDeliveryTarget: 'linq-chat-real',
      conversation: {
        channel: 'linq',
        directness: 'direct',
        identityId: 'hid_linq_identity',
        participantId: 'hid_linq_actor',
        threadId: 'hid_linq_thread',
      },
    }),
    {
      actorId: 'hid_linq_actor',
      channel: 'linq',
      deliveryKind: 'thread',
      deliveryTarget: 'linq-chat-real',
      identityId: 'hid_linq_identity',
      threadId: 'hid_linq_thread',
      threadIsDirect: true,
    },
  )
})

test('redactAssistantDisplayPath leaves sibling prefixes alone and falls back to absolute paths when HOME is unset', () => {
  const originalHome = process.env.HOME
  const homeRoot = path.join('/tmp', 'murph-home')
  const siblingPath = path.join('/tmp', 'murph-home-sibling', 'vault')
  const nestedPath = path.join(homeRoot, 'vault', 'assistant')

  process.env.HOME = homeRoot

  try {
    assert.equal(redactAssistantDisplayPath(homeRoot), '~')
    assert.equal(
      redactAssistantDisplayPath(nestedPath),
      path.join('~', 'vault', 'assistant'),
    )
    assert.equal(redactAssistantDisplayPath(siblingPath), path.resolve(siblingPath))
    delete process.env.HOME
    assert.equal(
      redactAssistantDisplayPath(path.join(homeRoot, 'vault')),
      path.resolve(homeRoot, 'vault'),
    )
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('normalizeProviderOptions and createAssistantSessionId keep assistant identifiers normalized', () => {
  const normalized = normalizeProviderOptions({
    model: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
  })
  assert.equal(normalized.approvalPolicy, null)
  assert.match(normalized.continuityFingerprint ?? '', /^sha256:[a-f0-9]{64}$/u)
  assert.equal(normalized.executionDriver, 'codex-app-server')
  assert.equal(normalized.model, 'gpt-5.6-terra')
  assert.equal(normalized.oss, false)
  assert.equal(normalized.profile, null)
  assert.equal(normalized.reasoningEffort, 'medium')
  assert.equal(normalized.resumeKind, 'codex-thread')
  assert.equal(normalized.sandbox, null)

  const sessionId = createAssistantSessionId()
  assert.match(sessionId, /^asst_[a-f0-9]{32}$/u)
})
