import { describe, expect, it, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  createCatalogModel: vi.fn(({ capabilities, description, id, source }) => ({
    capabilities,
    description,
    id,
    label: id,
    source,
  })),
  discoverAssistantProviderModelsWithRegistry: vi.fn(),
  resolveAssistantProviderRegistryCapabilities: vi.fn(),
  resolveAssistantProviderRegistryTargetCapabilities: vi.fn(),
  resolveAssistantProviderLabel: vi.fn((profile) =>
    profile.provider === 'codex-cli' ? 'Codex CLI' : 'OpenAI Compatible',
  ),
  resolveAssistantProviderStaticModels: vi.fn((profile) =>
    profile.provider === 'codex-cli'
      ? [
          {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            description: 'Frontier model',
            source: 'static',
            capabilities: {
              images: false,
              pdf: false,
              reasoning: true,
              streaming: true,
              tools: true,
            },
          },
        ]
      : [],
  ),
}))

vi.mock('../src/assistant-provider.js', () => ({
  createCatalogModel: providerMocks.createCatalogModel,
  discoverAssistantProviderModels:
    providerMocks.discoverAssistantProviderModelsWithRegistry,
  resolveAssistantProviderTargetCapabilities:
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities,
  resolveAssistantProviderCapabilities:
    providerMocks.resolveAssistantProviderRegistryCapabilities,
  resolveAssistantProviderLabel: providerMocks.resolveAssistantProviderLabel,
  resolveAssistantProviderStaticModels: providerMocks.resolveAssistantProviderStaticModels,
}))

import {
  DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS,
  DEFAULT_ASSISTANT_REASONING_OPTIONS,
  defaultDiscoverOpenAICompatibleModels,
  discoverAssistantProviderModels,
  findAssistantCatalogModelOptionIndex,
  findAssistantCatalogReasoningOptionIndex,
  resolveAssistantCatalogReasoningOptions,
  resolveAssistantModelCatalog,
  resolveAssistantProviderCapabilities,
  resolveAssistantProviderProfile,
  resolveAssistantTargetCapabilities,
} from '../src/assistant/provider-catalog.ts'

describe('assistant provider catalog', () => {
  it('maps static codex models into default chat-model options', () => {
    expect(DEFAULT_ASSISTANT_CHAT_MODEL_OPTIONS).toEqual([
      {
        value: 'gpt-5.4',
        description: 'Frontier model',
      },
    ])
  })

  it('forwards provider capability resolution through the registry helpers', () => {
    providerMocks.resolveAssistantProviderRegistryCapabilities.mockReturnValueOnce({
      supportsReasoningEffort: true,
    })
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValueOnce({
      supportsReasoningEffort: false,
    })

    expect(resolveAssistantProviderCapabilities('codex-cli')).toEqual({
      supportsReasoningEffort: true,
    })
    expect(
      resolveAssistantTargetCapabilities({
        provider: 'openai-compatible',
      }),
    ).toEqual({
      supportsReasoningEffort: false,
    })
  })

  it('normalizes provider profiles and builds model catalogs with current, static, and discovered models', () => {
    providerMocks.resolveAssistantProviderLabel.mockImplementation((profile) =>
      profile.provider === 'codex-cli' ? 'Codex CLI' : 'OpenAI Compatible',
    )
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValue({
      supportsReasoningEffort: true,
    })
    providerMocks.resolveAssistantProviderStaticModels.mockImplementation((profile) =>
      profile.provider === 'codex-cli'
        ? [
            {
              id: 'gpt-5.4',
              label: 'GPT-5.4',
              description: 'Frontier model',
              source: 'static',
              capabilities: {
                images: false,
                pdf: false,
                reasoning: true,
                streaming: true,
                tools: true,
              },
            },
          ]
        : [
            {
              id: 'omni-small',
              label: 'Omni Small',
              description: 'Static compatible model',
              source: 'static',
              capabilities: {
                images: false,
                pdf: false,
                reasoning: false,
                streaming: true,
                tools: true,
              },
            },
          ],
    )

    const profile = resolveAssistantProviderProfile({
      provider: 'codex-cli',
    })
    expect(profile).toMatchObject({
      provider: 'codex-cli',
      providerLabel: 'Codex CLI',
    })

    const catalog = resolveAssistantModelCatalog({
      currentModel: ' custom-current ',
      currentReasoningEffort: 'high',
      discoveredModels: ['gpt-5.4', 'gpt-5.4-mini'],
      provider: 'codex-cli',
    })

    expect(catalog.providerLabel).toBe('Codex CLI')
    expect(catalog.models.map((model) => model.id)).toEqual([
      'custom-current',
      'gpt-5.4',
      'gpt-5.4-mini',
    ])
    expect(catalog.selectedModel?.id).toBe('custom-current')
    expect(catalog.reasoningOptions).toEqual(DEFAULT_ASSISTANT_REASONING_OPTIONS)
    expect(catalog.modelOptions).toEqual([
      {
        value: 'custom-current',
        description: 'Current Codex model.',
      },
      {
        value: 'gpt-5.4',
        description: 'Frontier model',
      },
      {
        value: 'gpt-5.4-mini',
        description: 'Discovered from Codex CLI.',
      },
    ])
  })

  it('normalizes discovery capabilities for non-codex providers and discovers compatible models', async () => {
    providerMocks.resolveAssistantProviderLabel.mockReturnValue('OpenAI Compatible')
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValue({
      supportsReasoningEffort: false,
    })
    providerMocks.resolveAssistantProviderStaticModels.mockReturnValue([
      {
        id: 'omni-small',
        label: 'Omni Small',
        description: 'Static compatible model',
        source: 'static',
        capabilities: {
          images: false,
          pdf: false,
          reasoning: false,
          streaming: true,
          tools: true,
        },
      },
    ])
    providerMocks.discoverAssistantProviderModelsWithRegistry
      .mockResolvedValueOnce({
        status: 'ok',
        message: null,
        models: [
          {
            id: 'omni-large',
            label: 'Omni Large',
            description: 'Discovered compatible model',
            source: 'discovered',
            capabilities: {
              images: true,
              pdf: true,
              reasoning: true,
              streaming: true,
              tools: true,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'ok',
        message: null,
        models: [
          {
            id: 'omni-large',
            label: 'Omni Large',
            description: 'Discovered compatible model',
            source: 'discovered',
            capabilities: {
              images: true,
              pdf: true,
              reasoning: true,
              streaming: true,
              tools: true,
            },
          },
        ],
      })

    await expect(
      discoverAssistantProviderModels({
        provider: 'openai-compatible',
        baseUrl: 'https://models.example.com',
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      models: [expect.objectContaining({ id: 'omni-large' })],
    })

    await expect(
      defaultDiscoverOpenAICompatibleModels('https://models.example.com', {
        apiKeyEnv: 'OPENAI_API_KEY',
      }),
    ).resolves.toEqual(['omni-large'])

    const catalog = resolveAssistantModelCatalog({
      currentModel: 'omni-large',
      discovery: {
        status: 'ok',
        message: null,
        models: [
          {
            id: 'omni-large',
            label: 'Omni Large',
            description: 'Discovered compatible model',
            source: 'discovered',
            capabilities: {
              images: true,
              pdf: true,
              reasoning: true,
              streaming: true,
              tools: true,
            },
          },
        ],
      },
      provider: 'openai-compatible',
    })

    expect(catalog.selectedModel?.id).toBe('omni-large')
    expect(catalog.selectedModel?.capabilities).toEqual({
      images: false,
      pdf: false,
      reasoning: false,
      streaming: true,
      tools: true,
    })
    expect(resolveAssistantCatalogReasoningOptions(catalog.selectedModel)).toEqual([])
  })

  it('finds stable fallback indexes for model and reasoning selections', () => {
    expect(
      findAssistantCatalogModelOptionIndex('missing', [
        { value: 'gpt-5.4', description: 'Frontier' },
        { value: 'gpt-5.4-mini', description: 'Mini' },
      ]),
    ).toBe(0)
    expect(
      findAssistantCatalogModelOptionIndex(' gpt-5.4-mini ', [
        { value: 'gpt-5.4', description: 'Frontier' },
        { value: 'gpt-5.4-mini', description: 'Mini' },
      ]),
    ).toBe(1)

    expect(findAssistantCatalogReasoningOptionIndex(null, [])).toBe(0)
    expect(
      findAssistantCatalogReasoningOptionIndex('missing', DEFAULT_ASSISTANT_REASONING_OPTIONS),
    ).toBe(1)
    expect(
      findAssistantCatalogReasoningOptionIndex('high', DEFAULT_ASSISTANT_REASONING_OPTIONS),
    ).toBe(2)
  })

  it('handles empty catalogs and uses the openai-compatible current-model description branch', () => {
    providerMocks.resolveAssistantProviderLabel.mockReturnValue('OpenAI Compatible')
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValue({
      supportsReasoningEffort: true,
    })
    providerMocks.resolveAssistantProviderStaticModels.mockReturnValue([])

    const catalog = resolveAssistantModelCatalog({
      currentModel: 'custom-compatible',
      provider: 'openai-compatible',
      providerName: 'compatible',
    })

    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: 'custom-compatible',
        description: 'Current model from OpenAI Compatible.',
      }),
    ])
    expect(catalog.selectedModel?.id).toBe('custom-compatible')
    expect(resolveAssistantCatalogReasoningOptions(null)).toEqual([])
    expect(findAssistantCatalogModelOptionIndex(null, [])).toBe(0)
  })
})
