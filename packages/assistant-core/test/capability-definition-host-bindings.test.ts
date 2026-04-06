import assert from 'node:assert/strict'
import { test as baseTest } from 'vitest'
import { z } from 'zod'
import {
  CliBackedCapabilityHost,
  NativeLocalCapabilityHost,
  createAssistantCapabilityRegistry,
} from '../src/model-harness.js'
import { defineAssistantCapabilityTool } from '../src/assistant-cli-tools/capability-definitions.js'

const test = baseTest.sequential

test('helper-defined capabilities can expose multiple execution bindings across hosts', async () => {
  const capability = defineAssistantCapabilityTool(
    {
      name: 'host.echo',
      description: 'Echo through CLI or native execution.',
      inputSchema: z.object({
        value: z.string().min(1),
      }),
      inputExample: {
        value: 'hello',
      },
      executionBindings: {
        'cli-backed': async ({ value }) => ({
          host: 'cli',
          value,
        }),
        'native-local': async ({ value }) => ({
          host: 'native',
          value,
        }),
      },
    },
    {
      origin: 'hand-authored-helper',
      localOnly: true,
      generatedFrom: null,
      policyWrappers: [],
    },
    'cli-backed',
    'local-service',
  )
  const registry = createAssistantCapabilityRegistry([capability])

  assert.deepEqual(registry.getCapability('host.echo'), {
    backendKind: 'local-service',
    name: 'host.echo',
    description: 'Echo through CLI or native execution.',
    inputExample: {
      value: 'hello',
    },
    mutationSemantics: 'read-only',
    riskClass: 'low',
    preferredHostKind: 'cli-backed',
    supportedHostKinds: ['cli-backed', 'native-local'],
    provenance: {
      origin: 'hand-authored-helper',
      localOnly: true,
      generatedFrom: null,
      policyWrappers: [],
    },
  })

  const preferredCatalog = registry.createToolCatalog([
    new CliBackedCapabilityHost(),
    new NativeLocalCapabilityHost(),
  ])
  const fallbackCatalog = registry.createToolCatalog([
    new NativeLocalCapabilityHost(),
  ])

  assert.equal(preferredCatalog.listTools()[0]?.selectedHostKind, 'cli-backed')
  assert.equal(fallbackCatalog.listTools()[0]?.selectedHostKind, 'native-local')

  const preferredResult = await preferredCatalog.executeCalls({
    calls: [
      {
        tool: 'host.echo',
        input: {
          value: 'hello',
        },
      },
    ],
  })
  const fallbackResult = await fallbackCatalog.executeCalls({
    calls: [
      {
        tool: 'host.echo',
        input: {
          value: 'hello',
        },
      },
    ],
  })

  assert.deepEqual(preferredResult[0]?.result, {
    host: 'cli',
    value: 'hello',
  })
  assert.deepEqual(fallbackResult[0]?.result, {
    host: 'native',
    value: 'hello',
  })
})
