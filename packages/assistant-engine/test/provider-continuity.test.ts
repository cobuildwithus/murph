import { describe, expect, it } from 'vitest'
import {
  normalizeAssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
  resolveAssistantOnboardingCompletionFallbackReason,
  resolveAssistantProviderTurnContinuityPlan,
} from '../src/assistant/provider-turn-runner.js'
import {
  resolveAssistantProviderPrompt,
} from '../src/assistant/providers/helpers.js'
import {
  resolveOpenAiCompatibleVercelStripeBillingHeaders,
  resolveOpenAiCompatibleProviderOptions,
  shouldUseOpenAiCompatibleProviderState,
} from '../src/assistant/providers/openai-compatible.js'
import {
  resolveAssistantProviderTargetExecutionCapabilities,
} from '../src/assistant/providers/registry.js'
import {
  createAssistantUsageAttribution,
} from '../src/assistant/usage-attribution.js'
import {
  resolveAssistantOnboardingGuidanceOpen,
} from '../src/assistant/turn-plan.js'

describe('assistant provider continuity planning', () => {
  it('keeps native resume ahead of bootstrap overlays while leaving onboarding guidance on', () => {
    expect(
      resolveAssistantProviderTurnContinuityPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        onboardingGuidanceOpen: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      onboardingGuidanceInjected: true,
      resumeProviderSessionId: 'provider-session-1',
      shouldInjectBootstrapContext: false,
    })
  })

  it('injects onboarding guidance on conversation turns without coupling it to bootstrap', () => {
    expect(
      resolveAssistantProviderTurnContinuityPlan({
        candidateResumeProviderSessionId: null,
        onboardingGuidanceOpen: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      onboardingGuidanceInjected: true,
      resumeProviderSessionId: null,
      shouldInjectBootstrapContext: true,
    })

    expect(
      resolveAssistantProviderTurnContinuityPlan({
        candidateResumeProviderSessionId: null,
        onboardingGuidanceOpen: true,
        promptProfile: 'notification-decision',
      }).onboardingGuidanceInjected,
    ).toBe(false)
  })

  it('treats onboarding guidance as gated by onboarding-open state', () => {
    expect(
      resolveAssistantOnboardingGuidanceOpen({
        includeOnboardingGuidance: true,
        onboardingOpen: true,
      }),
    ).toBe(true)

    expect(
      resolveAssistantOnboardingGuidanceOpen({
        includeOnboardingGuidance: true,
        onboardingOpen: false,
      }),
    ).toBe(false)

    expect(
      resolveAssistantOnboardingGuidanceOpen({
        includeOnboardingGuidance: false,
        onboardingOpen: true,
      }),
    ).toBe(false)
  })

  it('settles only clear declines or concrete requests when no command surface is available', () => {
    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: 'Can you help me understand my sleep debt?',
      }),
    ).toBe('concrete_request')

    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: "Call me Sam. I've been dealing with low energy lately.",
      }),
    ).toBeNull()

    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: 'Trying to sleep better',
      }),
    ).toBeNull()

    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: 'No thanks, skip that for now.',
      }),
    ).toBe('user_declined')

    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: 'Yea!',
      }),
    ).toBeNull()

    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: 'What?',
      }),
    ).toBeNull()

    expect(
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode: 'none',
        onboardingGuidanceInjected: true,
        prompt: "I'm curious.",
      }),
    ).toBeNull()
  })
})

describe('flat prompt native resume', () => {
  const codexConfig = normalizeAssistantProviderConfig({
    model: 'gpt-5-codex',
    provider: 'codex-cli',
  })

  it('sends only the current user turn to resumed flat-prompt providers', () => {
    const prompt = resolveAssistantProviderPrompt({
      continuityContext: 'Do not resend this on native resume.',
      conversationMessages: [
        { role: 'user', content: 'Earlier user turn' },
        { role: 'assistant', content: 'Earlier assistant turn' },
      ],
      providerConfig: codexConfig,
      resumeProviderSessionId: 'codex-session-1',
      systemPrompt: 'System/bootstrap instructions.',
      userPrompt: 'Current user turn',
      workingDirectory: '/tmp',
    })

    expect(prompt).toBe('User message:\nCurrent user turn')
  })

  it('restores bootstrap prompt and transcript when a flat-prompt resume falls back fresh', () => {
    const prompt = resolveAssistantProviderPrompt({
      continuityContext: 'Fresh bootstrap context.',
      conversationMessages: [
        { role: 'user', content: 'Earlier user turn' },
        { role: 'assistant', content: 'Earlier assistant turn' },
      ],
      providerConfig: codexConfig,
      resumeProviderSessionId: null,
      systemPrompt: 'System/bootstrap instructions.',
      userPrompt: 'Current user turn',
      workingDirectory: '/tmp',
    })

    expect(prompt).toContain('System/bootstrap instructions.')
    expect(prompt).toContain('Conversation so far:')
    expect(prompt).toContain('User:\nEarlier user turn')
    expect(prompt).toContain('Assistant:\nEarlier assistant turn')
    expect(prompt).toContain('Fresh bootstrap context.')
    expect(prompt).toContain('User message:\nCurrent user turn')
  })
})

describe('OpenAI-compatible native resume retention options', () => {
  it('stores Responses API turns only when native resume is enabled without ZDR', () => {
    const openAiConfig = normalizeAssistantProviderConfig({
      model: 'gpt-5',
      presetId: 'openai',
      provider: 'openai-compatible',
    })

    expect(shouldUseOpenAiCompatibleProviderState(openAiConfig)).toBe(true)
    expect(
      resolveOpenAiCompatibleProviderOptions({
        providerConfig: openAiConfig,
        resumeProviderSessionId: 'resp_123',
        usesResponsesApi: true,
      })?.openai,
    ).toMatchObject({
      previousResponseId: 'resp_123',
      store: true,
    })

    const zeroDataRetentionConfig = normalizeAssistantProviderConfig({
      model: 'openai/gpt-5',
      presetId: 'vercel-ai-gateway',
      provider: 'openai-compatible',
      zeroDataRetention: true,
    })

    expect(
      resolveAssistantProviderTargetExecutionCapabilities(zeroDataRetentionConfig)
        .supportsNativeResume,
    ).toBe(false)
    expect(shouldUseOpenAiCompatibleProviderState(zeroDataRetentionConfig)).toBe(
      false,
    )
    expect(
      resolveOpenAiCompatibleProviderOptions({
        providerConfig: zeroDataRetentionConfig,
        resumeProviderSessionId: 'resp_123',
        usesResponsesApi: true,
      })?.openai,
    ).toEqual({
      store: false,
    })
  })

  it('attaches anonymized gateway reporting metadata for Vercel AI Gateway turns', () => {
    const usageAttribution = createAssistantUsageAttribution({
      credentialSource: 'platform',
      environment: ' Production ',
      featureKey: ' Assistant Reply ',
      memberId: 'member_123',
      reportingSecret: 'reporting-secret',
      surface: ' Hosted Web ',
      stripeCustomerId: 'cus_123',
      stripeMeterSource: 'vercel-ai-gateway',
      triggerKind: ' Manual Ask ',
      zeroDataRetention: true,
    })

    expect(usageAttribution).toMatchObject({
      credentialSource: 'platform',
      environment: 'production',
      featureKey: 'assistant_reply',
      gatewayTags: [
        'env:production',
        'feature:assistant_reply',
        'surface:hosted_web',
        'trigger:manual_ask',
        'credential:platform',
        'zdr:on',
      ],
      reportingUserId: expect.stringMatching(/^musr_[A-Za-z0-9_-]{32}$/),
      surface: 'hosted_web',
      triggerKind: 'manual_ask',
    })
    expect(usageAttribution.reportingUserId).not.toContain('member_123')

    const providerOptions = resolveOpenAiCompatibleProviderOptions({
      providerConfig: normalizeAssistantProviderConfig({
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        gatewayOnlyProviders: ['openai'],
        model: 'openai/gpt-5',
        presetId: 'vercel-ai-gateway',
        provider: 'openai-compatible',
        providerName: 'vercel-ai-gateway',
        zeroDataRetention: true,
      }),
      resumeProviderSessionId: null,
      usageAttribution,
      usesResponsesApi: true,
    })

    expect(providerOptions?.gateway).toEqual({
      only: ['openai'],
      tags: [
        'env:production',
        'feature:assistant_reply',
        'surface:hosted_web',
        'trigger:manual_ask',
        'credential:platform',
        'zdr:on',
      ],
      user: usageAttribution.reportingUserId,
      zeroDataRetention: true,
    })
    expect(JSON.stringify(providerOptions)).not.toContain('member_123')
  })

  it('withholds gateway provider options for custom endpoints even when stale gateway metadata remains', () => {
    const usageAttribution = createAssistantUsageAttribution({
      credentialSource: 'platform',
      environment: 'production',
      featureKey: 'assistant_reply',
      memberId: 'member_123',
      reportingSecret: 'reporting-secret',
      surface: 'hosted_web',
      stripeCustomerId: 'cus_123',
      stripeMeterSource: 'vercel-ai-gateway',
      triggerKind: 'manual_ask',
      zeroDataRetention: true,
    })

    const providerOptions = resolveOpenAiCompatibleProviderOptions({
      providerConfig: normalizeAssistantProviderConfig({
        baseUrl: 'https://proxy.example.com/v1',
        gatewayOnlyProviders: ['openai'],
        model: 'openai/gpt-5',
        presetId: 'vercel-ai-gateway',
        provider: 'openai-compatible',
        providerName: 'vercel-ai-gateway',
        zeroDataRetention: true,
      }),
      resumeProviderSessionId: null,
      usageAttribution,
      usesResponsesApi: true,
    })

    expect(providerOptions).toEqual({
      openai: {
        store: false,
      },
    })
  })

  it('delegates Stripe token billing headers only for platform-funded Vercel gateway turns with a valid customer id', () => {
    expect(
      resolveOpenAiCompatibleVercelStripeBillingHeaders({
        billingContext: {
          credentialSource: 'platform',
          stripeCustomerId: ' cus_123 ',
        },
        env: {
          HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: ' rk_test_123 ',
          HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: '1',
        },
        providerTarget: {
          baseUrl: 'https://ai-gateway.vercel.sh/v1',
          providerName: 'vercel-ai-gateway',
          presetId: 'vercel-ai-gateway',
        },
      }),
    ).toEqual({
      'stripe-customer-id': 'cus_123',
      'stripe-restricted-access-key': 'rk_test_123',
    })

    expect(
      resolveOpenAiCompatibleVercelStripeBillingHeaders({
        billingContext: {
          credentialSource: 'member',
          stripeCustomerId: 'cus_123',
        },
        env: {
          HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'rk_test_123',
          HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: '1',
        },
        providerTarget: {
          baseUrl: 'https://ai-gateway.vercel.sh/v1',
          providerName: 'vercel-ai-gateway',
          presetId: 'vercel-ai-gateway',
        },
      }),
    ).toBeNull()

    expect(
      resolveOpenAiCompatibleVercelStripeBillingHeaders({
        billingContext: {
          credentialSource: 'platform',
          stripeCustomerId: 'customer_123',
        },
        env: {
          HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'sk_test_123',
          HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: '1',
        },
        providerTarget: {
          baseUrl: 'https://ai-gateway.vercel.sh/v1',
          providerName: 'vercel-ai-gateway',
          presetId: 'vercel-ai-gateway',
        },
      }),
    ).toBeNull()

    expect(
      resolveOpenAiCompatibleVercelStripeBillingHeaders({
        billingContext: {
          credentialSource: 'platform',
          stripeCustomerId: 'cus_123',
        },
        env: {
          HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'rk_test_123',
          HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: '1',
        },
        providerTarget: {
          baseUrl: 'https://proxy.example.com/v1',
          providerName: 'vercel-ai-gateway',
          presetId: 'vercel-ai-gateway',
        },
      }),
    ).toBeNull()
  })
})
