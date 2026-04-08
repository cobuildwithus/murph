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
      sourceThreadId: 'thread/42',
    }),
    'channel:telegram|identity:assistant%3Aprimary|thread:thread%2F42',
  )
})

test('resolveAssistantAliasKey prefers explicit aliases and otherwise derives a binding key', () => {
  assert.equal(
    resolveAssistantAliasKey({
      alias: 'chat:alice',
      channel: 'telegram',
      sourceThreadId: 'thread/42',
    }),
    'chat:alice',
  )

  assert.equal(
    resolveAssistantAliasKey({
      channel: 'telegram',
      identityId: 'assistant:primary',
      sourceThreadId: 'thread/42',
    }),
    'channel:telegram|identity:assistant%3Aprimary|thread:thread%2F42',
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
    sourceThreadId: 'chat-override',
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
  assert.deepEqual(
    normalizeProviderOptions({
      model: 'gpt-5.4',
      headers: {
        Authorization: 'Bearer token',
      },
    }),
    {
      approvalPolicy: null,
      headers: {
        Authorization: 'Bearer token',
      },
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
    },
  )

  const sessionId = createAssistantSessionId()
  assert.match(sessionId, /^asst_[a-f0-9]{32}$/u)
})
