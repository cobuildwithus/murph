import { describe, expect, it } from 'vitest'
import {
  normalizeAssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
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
  resolveAssistantEarlySessionOnboardingEligibility,
} from '../src/assistant/turn-plan.js'

describe('assistant provider continuity planning', () => {
  it('keeps native resume ahead of onboarding/bootstrap overlays', () => {
    expect(
      resolveAssistantProviderTurnContinuityPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        earlySessionOnboardingEligible: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      earlySessionOnboardingInjected: false,
      resumeProviderSessionId: 'provider-session-1',
      shouldInjectBootstrapContext: false,
    })
  })

  it('injects onboarding only on conversation bootstrap turns', () => {
    expect(
      resolveAssistantProviderTurnContinuityPlan({
        candidateResumeProviderSessionId: null,
        earlySessionOnboardingEligible: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      earlySessionOnboardingInjected: true,
      resumeProviderSessionId: null,
      shouldInjectBootstrapContext: true,
    })

    expect(
      resolveAssistantProviderTurnContinuityPlan({
        candidateResumeProviderSessionId: null,
        earlySessionOnboardingEligible: true,
        promptProfile: 'notification-decision',
      }).earlySessionOnboardingInjected,
    ).toBe(false)
  })

  it('treats onboarding as first-turn and first-contact only', () => {
    expect(
      resolveAssistantEarlySessionOnboardingEligibility({
        firstContactAlreadySeen: false,
        includeEarlySessionOnboarding: true,
        isFirstSessionForOnboarding: true,
        sessionTurnCount: 0,
      }),
    ).toBe(true)

    expect(
      resolveAssistantEarlySessionOnboardingEligibility({
        firstContactAlreadySeen: false,
        includeEarlySessionOnboarding: true,
        isFirstSessionForOnboarding: true,
        sessionTurnCount: 1,
      }),
    ).toBe(false)

    expect(
      resolveAssistantEarlySessionOnboardingEligibility({
        firstContactAlreadySeen: true,
        includeEarlySessionOnboarding: true,
        isFirstSessionForOnboarding: true,
        sessionTurnCount: 0,
      }),
    ).toBe(false)
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
  })
})
