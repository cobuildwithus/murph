import { describe, expect, it, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  createCatalogModel: vi.fn(({ capabilities, description, id, source }) => ({
    capabilities,
    description,
    id,
    label: id,
    source,
  })),
  resolveAssistantProviderRegistryCapabilities: vi.fn(),
  resolveAssistantProviderRegistryTargetCapabilities: vi.fn(),
  resolveAssistantProviderLabel: vi.fn((profile) =>
    (profile.target?.kind ?? profile.provider) === 'codex-cli'
      ? 'Codex CLI'
      : 'Unsupported provider',
  ),
  resolveAssistantProviderStaticModels: vi.fn((profile) =>
    (profile.target?.kind ?? profile.provider) === 'codex-cli'
      ? [
          {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            description: 'Frontier model',
            source: 'static',
            capabilities: {
              images: true,
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
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValueOnce({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: false,
    })

    expect(resolveAssistantProviderCapabilities('codex-cli')).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    expect(
      resolveAssistantTargetCapabilities({
        provider: 'codex-cli',
      }),
    ).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: false,
    })
  })

  it('normalizes provider profiles and builds model catalogs with current and static models', () => {
    providerMocks.resolveAssistantProviderLabel.mockImplementation((profile) =>
      (profile.target?.kind ?? profile.provider) === 'codex-cli'
        ? 'Codex CLI'
        : 'Unsupported provider',
    )
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveAssistantProviderStaticModels.mockImplementation((profile) =>
      (profile.target?.kind ?? profile.provider) === 'codex-cli'
        ? [
            {
              id: 'gpt-5.4',
              label: 'GPT-5.4',
              description: 'Frontier model',
              source: 'static',
              capabilities: {
                images: true,
                pdf: false,
                reasoning: true,
                streaming: true,
                tools: true,
              },
            },
          ]
        : [],
    )

    const profile = resolveAssistantProviderProfile({
      provider: 'codex-cli',
    })
    expect(profile).toMatchObject({
      target: {
        kind: 'codex-cli',
      },
      providerLabel: 'Codex CLI',
    })

    const catalog = resolveAssistantModelCatalog({
      currentModel: ' custom-current ',
      currentReasoningEffort: 'high',
      provider: 'codex-cli',
    })

    expect(catalog.providerLabel).toBe('Codex CLI')
    expect(catalog.models.map((model) => model.id)).toEqual([
      'custom-current',
      'gpt-5.4',
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
    ])
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

  it('handles empty Codex catalogs and uses the Codex current-model description branch', () => {
    providerMocks.resolveAssistantProviderLabel.mockReturnValue('Codex CLI')
    providerMocks.resolveAssistantProviderRegistryTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveAssistantProviderStaticModels.mockReturnValue([])

    const catalog = resolveAssistantModelCatalog({
      currentModel: 'custom-codex',
      provider: 'codex-cli',
    })

    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: 'custom-codex',
        description: 'Current Codex model.',
      }),
    ])
    expect(catalog.selectedModel?.id).toBe('custom-codex')
    expect(resolveAssistantCatalogReasoningOptions(null)).toEqual([])
    expect(findAssistantCatalogModelOptionIndex(null, [])).toBe(0)
  })
})
