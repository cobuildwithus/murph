import assert from 'node:assert/strict'

import { test } from 'vitest'
import { z } from 'zod'

import {
  createProviderTurnAssistantCapabilityRuntime,
  createProviderTurnAssistantToolCatalog,
} from '../src/assistant-cli-tools.ts'
import { defineAssistantCapability } from '../src/model-harness.js'

test('defineAssistantCapability rejects capabilities with no execution bindings', () => {
  assert.throws(
    () =>
      defineAssistantCapability({
        name: 'test.no-bindings',
        description: 'missing bindings',
        inputSchema: z.object({}),
        executionBindings: {},
      }),
    /must declare at least one execution binding/u,
  )
})

test('defineAssistantCapability rejects capabilities whose preferred host is not bound', () => {
  assert.throws(
    () =>
      defineAssistantCapability({
        name: 'test.misaligned-preference',
        description: 'preferred host must be executable',
        inputSchema: z.object({}),
        preferredHostKind: 'cli-backed',
        executionBindings: {
          'native-local': async () => ({ ok: true }),
        },
      }),
    /prefers host "cli-backed" but does not declare a binding for it/u,
  )
})

test('createProviderTurnAssistantCapabilityRuntime matches the direct provider-turn tool catalog', () => {
  const input = {
    vault: '/tmp/murph-test-vault',
  }

  assert.deepEqual(
    createProviderTurnAssistantCapabilityRuntime(input).toolCatalog.listTools(),
    createProviderTurnAssistantToolCatalog(input).listTools(),
  )
})
