import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'

import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'

import type { AssistantToolContext } from '../src/assistant-cli-tools/shared.ts'
import {
  createDefaultAssistantCapabilityRegistry,
  createDefaultAssistantToolCatalog,
  createInboxRoutingAssistantToolCatalog,
  createProviderTurnAssistantCapabilityRuntime,
  createProviderTurnAssistantToolCatalog,
} from '../src/assistant-cli-tools/catalog-profiles.ts'
import {
  createAssistantRuntimeToolDefinitions,
  createOutwardSideEffectToolDefinitions,
  createQueryAndReadToolDefinitions,
  createWebFetchToolDefinitions,
  createWebPdfReadToolDefinitions,
  createWebSearchToolDefinitions,
  defineAssistantCapabilityTool,
} from '../src/assistant-cli-tools/capability-definitions.ts'
import {
  CliBackedCapabilityHost,
  NativeLocalCapabilityHost,
  createAssistantToolCatalogFromCapabilities,
} from '../src/model-harness.ts'
import { restoreEnvironmentVariable } from './test-helpers.js'

describe('assistant CLI tool catalogs', () => {
  const originalWebFetchEnabled = process.env.MURPH_WEB_FETCH_ENABLED
  const originalExaApiKey = process.env.EXA_API_KEY
  const originalSearchProvider = process.env.MURPH_WEB_SEARCH_PROVIDER

  afterEach(() => {
    restoreEnvironmentVariable(
      'MURPH_WEB_FETCH_ENABLED',
      originalWebFetchEnabled,
    )
    restoreEnvironmentVariable(
      'EXA_API_KEY',
      originalExaApiKey,
    )
    restoreEnvironmentVariable(
      'MURPH_WEB_SEARCH_PROVIDER',
      originalSearchProvider,
    )
  })

  it('gates configured web tools on runtime env flags', () => {
    expect(createWebSearchToolDefinitions()).toEqual([])
    expect(createWebFetchToolDefinitions()).toEqual([])
    expect(createWebPdfReadToolDefinitions()).toEqual([])

    process.env.EXA_API_KEY = 'test-exa-key'
    process.env.MURPH_WEB_FETCH_ENABLED = '1'

    expect(createWebSearchToolDefinitions().map((tool) => tool.name)).toEqual([
      'web.search',
    ])
    expect(createWebFetchToolDefinitions().map((tool) => tool.name)).toEqual([
      'web.fetch',
    ])
    expect(createWebPdfReadToolDefinitions().map((tool) => tool.name)).toEqual([
      'web.pdf.read',
    ])
  })

  it('applies package tool-catalog options to runtime, query, and outward tools', () => {
    const toolContext = createToolContext()

    expect(
      createAssistantRuntimeToolDefinitions(toolContext, {
        includeStatefulWriteTools: false,
      }).map((tool) => tool.name),
    ).toEqual([
      'assistant.knowledge.list',
      'assistant.knowledge.search',
      'assistant.knowledge.get',
      'assistant.knowledge.lint',
      'assistant.selfTarget.list',
      'assistant.selfTarget.show',
    ])

    expect(
      createQueryAndReadToolDefinitions(toolContext, {
        includeQueryTools: false,
        includeVaultTextReadTool: false,
        includeWebSearchTools: false,
      }),
    ).toEqual([])

    process.env.EXA_API_KEY = 'test-exa-key'
    process.env.MURPH_WEB_FETCH_ENABLED = '1'
    expect(
      createQueryAndReadToolDefinitions(toolContext, {
        includeQueryTools: false,
      }).map((tool) => tool.name),
    ).toEqual([
      'vault.fs.readText',
      'web.fetch',
      'web.pdf.read',
      'web.search',
    ])

    expect(createOutwardSideEffectToolDefinitions(toolContext)).toEqual([])

    const outwardNames = createOutwardSideEffectToolDefinitions({
      ...toolContext,
      executionContext: {
        hosted: {
          issueDeviceConnectLink: async ({ provider }) => ({
            provider,
            url: `https://example.com/connect/${provider}`,
          }),
          issueShareLink: async ({ recipientPhoneNumber }) => ({
            shareId: 'share_123',
            url: 'https://example.com/share/share_123',
            recipientPhoneNumber: recipientPhoneNumber ?? null,
          }),
        },
      } as NonNullable<AssistantToolContext['executionContext']>,
    }).map((tool) => tool.name)
    expect(outwardNames).toEqual([
      'murph.device.connect',
      'vault.share.createLink',
    ])
  })

  it('assembles default, inbox-routing, and provider-turn catalogs with the expected tool mix', () => {
    const defaultCatalog = createDefaultAssistantToolCatalog(
      createToolContext({
        vaultServices: createVaultServicesStub(),
      }),
    )
    expect(defaultCatalog.hasTool('assistant.knowledge.upsert')).toBe(true)
    expect(defaultCatalog.hasTool('vault.show')).toBe(true)
    expect(defaultCatalog.hasTool('web.search')).toBe(false)
    expect(defaultCatalog.hasTool('vault.fs.readText')).toBe(true)

    const inboxRoutingCatalog = createInboxRoutingAssistantToolCatalog(
      createToolContext({
        captureId: 'capture-123',
        inboxServices: createInboxServicesStub(),
        vaultServices: createVaultServicesStub(),
      }),
    )
    expect(inboxRoutingCatalog.hasTool('assistant.knowledge.upsert')).toBe(false)
    expect(inboxRoutingCatalog.hasTool('assistant.selfTarget.list')).toBe(false)
    expect(inboxRoutingCatalog.hasTool('vault.show')).toBe(false)
    expect(inboxRoutingCatalog.hasTool('web.fetch')).toBe(false)
    expect(inboxRoutingCatalog.hasTool('inbox.promote.journal')).toBe(true)

    process.env.EXA_API_KEY = 'test-exa-key'
    process.env.MURPH_WEB_FETCH_ENABLED = '1'

    const providerTurnCatalog = createProviderTurnAssistantToolCatalog(
      createToolContext(),
    )
    expect(providerTurnCatalog.hasTool('assistant.knowledge.list')).toBe(true)
    expect(providerTurnCatalog.hasTool('assistant.knowledge.upsert')).toBe(true)
    expect(providerTurnCatalog.hasTool('vault.cli.run')).toBe(true)
    expect(providerTurnCatalog.hasTool('vault.fs.readText')).toBe(true)
    expect(providerTurnCatalog.hasTool('vault.show')).toBe(false)
    expect(providerTurnCatalog.hasTool('web.fetch')).toBe(true)
    expect(providerTurnCatalog.hasTool('web.search')).toBe(true)

    const providerRuntime = createProviderTurnAssistantCapabilityRuntime(
      createToolContext(),
    )
    expect(providerRuntime.toolCatalog.listTools()).toEqual(
      providerTurnCatalog.listTools(),
    )
  })

  it('normalizes capability metadata, binds preferred hosts, and emits preview execution results', async () => {
    const cliCapability = defineAssistantCapabilityTool(
      {
        name: 'vault.cli.run',
        description: 'Execute Murph commands.',
        inputSchema: createEchoSchema(),
        inputExample: {
          value: 'hello',
        },
        execute: async ({ value }) => ({
          echoed: value,
        }),
      },
      {
        generatedFrom: null,
        localOnly: true,
        origin: 'cli-backed',
        policyWrappers: ['format-default'],
      },
      'cli-backed',
      'cli-wrapper',
    )

    const nativeCapability = defineAssistantCapabilityTool(
      {
        name: 'assistant.note.peek',
        description: 'Inspect an assistant note.',
        inputSchema: createEchoSchema(),
        executionBindings: {
          'native-local': async ({ value }) => ({
            native: value,
          }),
        },
      },
      {
        generatedFrom: null,
        localOnly: true,
        origin: 'hand-authored-helper',
        policyWrappers: [],
      },
      'native-local',
      'local-service',
    )

    const registry = createDefaultAssistantCapabilityRegistry(createToolContext())
    expect(registry.hasCapability('assistant.knowledge.list')).toBe(true)
    expect(registry.getCapability('assistant.knowledge.list')?.mutationSemantics).toBe(
      'read-only',
    )
    expect(registry.getCapability('assistant.knowledge.upsert')?.riskClass).toBe(
      'medium',
    )

    const catalog = createAssistantToolCatalogFromCapabilities(
      [cliCapability, nativeCapability],
      [new NativeLocalCapabilityHost(), new CliBackedCapabilityHost()],
    )

    const listed = catalog.listTools()
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'vault.cli.run',
        selectedHostKind: 'cli-backed',
        preferredHostKind: 'cli-backed',
        mutationSemantics: 'mixed',
        backendKind: 'cli-wrapper',
      }),
      expect.objectContaining({
        name: 'assistant.note.peek',
        selectedHostKind: 'native-local',
        preferredHostKind: 'native-local',
        mutationSemantics: 'read-only',
        backendKind: 'local-service',
      }),
    ])

    const previewed = await catalog.executeCalls({
      mode: 'preview',
      calls: [
        {
          tool: 'assistant.note.peek',
          input: {
            value: 'hello',
          },
        },
        {
          tool: 'missing.tool',
          input: {},
        },
      ],
      maxCalls: 1,
    })

    expect(previewed).toEqual([
      expect.objectContaining({
        tool: 'assistant.note.peek',
        status: 'previewed',
        result: {
          preview: true,
          tool: 'assistant.note.peek',
          input: {
            value: 'hello',
          },
        },
      }),
      expect.objectContaining({
        tool: 'missing.tool',
        status: 'skipped',
      }),
    ])
  })
})

function createToolContext(
  overrides: Partial<AssistantToolContext> = {},
): AssistantToolContext {
  return {
    vault: '/tmp/murph-vault',
    ...overrides,
  }
}

function createEchoSchema() {
  return z.object({
    value: z.string(),
  })
}

function createVaultServicesStub(): VaultServices {
  return {
    core: {
      addMeal: async () => ({ mealId: 'meal-1' }),
      ensureJournal: async () => ({ created: true }),
      appendJournal: async () => ({ updated: true }),
      createExperiment: async () => ({ experimentId: 'exp-1' }),
      upsertProvider: async () => ({ providerId: 'provider-1' }),
      upsertRecipe: async () => ({ recipeId: 'recipe-1' }),
      upsertFood: async () => ({ foodId: 'food-1' }),
      upsertEvent: async () => ({ eventId: 'event-1' }),
      addSamples: async () => ({ sampleCount: 1 }),
      projectAssessment: async () => ({ projected: true }),
      stopProtocol: async () => ({ protocolId: 'prot-1' }),
    },
    devices: {},
    importers: {
      importAssessmentResponse: async () => ({ assessmentId: 'assessment-1' }),
      importDocument: async () => ({ documentId: 'document-1' }),
    },
    query: {
      list: async () => ({ records: [] }),
      listFoods: async () => ({ foods: [] }),
      listRecipes: async () => ({ recipes: [] }),
      listWearableActivity: async () => ({ days: [] }),
      listWearableBodyState: async () => ({ days: [] }),
      listWearableRecovery: async () => ({ days: [] }),
      listWearableSleep: async () => ({ days: [] }),
      listWearableSources: async () => ({ sources: [] }),
      show: async () => ({ id: 'record-1' }),
      showFood: async () => ({ id: 'food-1' }),
      showRecipe: async () => ({ id: 'recipe-1' }),
      showWearableDay: async () => ({ date: '2026-04-08' }),
    },
  } as VaultServices
}

function createInboxServicesStub(): InboxServices {
  return {
    promoteDocument: async () => ({ ok: true }),
    promoteExperimentNote: async () => ({ ok: true }),
    promoteJournal: async () => ({ ok: true }),
    promoteMeal: async () => ({ ok: true }),
  } as InboxServices
}
