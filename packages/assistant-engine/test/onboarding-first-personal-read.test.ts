import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  executeAutomationDynamicTool,
  MURPH_AUTOMATION_TOOL,
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.js'
import type {
  AssistantHostedAutomationTool,
  AssistantHostedAutomationToolRequest,
} from '../src/assistant/execution-context.js'
import {
  automationAssistantTargetOverrideToProviderConfigInput,
} from '../src/assistant/automation/target-override.js'
import {
  resolveAssistantExecutionPlan,
} from '../src/assistant/execution-plan.js'
import {
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS,
} from '../src/assistant/onboarding-first-personal-read-automation.js'

async function readOnboardingCompletionGuidance(): Promise<string> {
  const skillsRoot = resolveAssistantSkillsRoot()
  const raw = await readFile(
    path.join(
      skillsRoot,
      'murph-onboarding',
      'references',
      'return-launch-completion.md',
    ),
    'utf8',
  )
  return raw.replace(/\s+/gu, ' ')
}

function expectContainsAll(actual: string, expected: readonly string[]): void {
  for (const value of expected) {
    expect(actual).toContain(value)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('onboarding first personal read', () => {
  it('builds one fixed route-bound high-reasoning automation request', () => {
    const request = buildOnboardingFirstPersonalReadAutomationSaveRequest({
      now: new Date('2026-08-06T21:00:00.000Z'),
    })

    expect(request).toEqual({
      action: 'save',
      activeUntil: '2026-08-06T22:02:00.000Z',
      assistantTargetOverride: {
        reasoningEffort: 'high',
      },
      automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
      continuityPolicy: 'fresh',
      instructions: MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS,
      schedule: {
        kind: 'at',
        at: '2026-08-06T21:02:00.000Z',
      },
      slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
      status: 'active',
      summary:
        'One private first read across the context and health data collected during onboarding.',
      tags: [
        'assistant',
        'scheduled',
        'onboarding',
        'first-personal-read',
      ],
      title: 'First personal health read',
    })
    expect(
      isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest(request),
    ).toBe(true)
    expect(
      isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest({
        ...request,
        title: 'Model-authored replacement',
      }),
    ).toBe(false)
  })

  it('inherits every selected model and provider while applying high reasoning', () => {
    const override = automationAssistantTargetOverrideToProviderConfigInput(
      buildOnboardingFirstPersonalReadAutomationSaveRequest({
        now: new Date('2026-08-06T21:00:00.000Z'),
      }).assistantTargetOverride,
    )
    for (const selected of [
      { model: 'murph-custom-r7', modelProvider: 'hosted-custom-inference' },
      { model: 'gpt-5.6-luna', modelProvider: 'openai' },
      { model: 'gpt-5.6-terra', modelProvider: 'openai' },
      { model: 'gpt-5.6-sol', modelProvider: 'openai' },
    ]) {
      const sessionTarget = createAssistantModelTarget({
        model: selected.model,
        modelProvider: selected.modelProvider,
        provider: 'codex-cli',
        reasoningEffort: 'medium',
      })
      if (!sessionTarget) {
        throw new TypeError('Expected a selected assistant target.')
      }

      expect(resolveAssistantExecutionPlan({
        defaults: null,
        override,
        sessionTarget,
      }).primaryTarget).toMatchObject({
        model: selected.model,
        modelProvider: selected.modelProvider,
        reasoningEffort: 'high',
      })
    }
  })

  it('turns the fieldless action into the code-owned request', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T21:00:00.000Z'))

    const parsed = readAutomationDynamicToolRequest({
      arguments: {
        action: MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
      },
      tool: 'automation',
    })
    expect(parsed?.kind).toBe('automation')
    if (parsed?.kind !== 'automation') {
      throw new TypeError('Expected a parsed automation request.')
    }
    expect(parsed.request).toEqual(
      buildOnboardingFirstPersonalReadAutomationSaveRequest({
        now: new Date('2026-08-06T21:00:00.000Z'),
      }),
    )

    expect(
      readAutomationDynamicToolRequest({
        arguments: {
          action: MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
          instructions: 'Use a model-authored prompt instead.',
        },
        tool: 'automation',
      })?.kind,
    ).toBe('invalid-automation-arguments')
  })

  it('passes only the code-owned request through the hosted tool boundary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T21:00:00.000Z'))

    const parsed = readAutomationDynamicToolRequest({
      arguments: {
        action: MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
      },
      tool: 'automation',
    })
    if (parsed?.kind !== 'automation') {
      throw new TypeError('Expected a parsed automation request.')
    }

    let received: AssistantHostedAutomationToolRequest | null = null
    let receivedContext:
      | Parameters<AssistantHostedAutomationTool['request']>[1]
      | null = null
    const automationTool: AssistantHostedAutomationTool = {
      async request(request, context) {
        if (request.action !== 'save') {
          throw new Error('Expected an automation save request.')
        }
        received = request
        receivedContext = context
        return {
          action: 'save',
          automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          created: true,
          effectiveTimeZone: null,
          lookupId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          nextOccurrenceAt: '2026-08-07T13:00:00.000Z',
          routeBinding: 'current_conversation',
          schedule: request.schedule,
          status: 'active',
          timingVerified: true,
        }
      },
    }

    const result = await executeAutomationDynamicTool({
      automationTool,
      onboardingFirstReadCompletionTransitionAvailable: true,
      request: parsed,
    })

    expect(received).toEqual(
      buildOnboardingFirstPersonalReadAutomationSaveRequest({
        now: new Date('2026-08-06T21:00:00.000Z'),
      }),
    )
    expect(result.rpcResult.success).toBe(true)
    expect(receivedContext).toEqual({
      onboardingFirstReadCompletionTransition: true,
      signal: null,
    })
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"routeBinding":"current_conversation"',
    )
  })

  it('rejects the fieldless action outside a trusted completion transition', async () => {
    const parsed = readAutomationDynamicToolRequest({
      arguments: {
        action: MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
      },
      tool: 'automation',
    })
    if (parsed?.kind !== 'automation') {
      throw new TypeError('Expected a parsed automation request.')
    }
    const request = vi.fn<AssistantHostedAutomationTool['request']>()

    const result = await executeAutomationDynamicTool({
      automationTool: { request },
      onboardingFirstReadCompletionTransitionAvailable: false,
      request: parsed,
    })

    expect(request).not.toHaveBeenCalled()
    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'unavailable outside its completion transition',
    )
  })

  it('protects the fixed definition while allowing explicit cancellation', () => {
    const invalidRequests = [
      {
        action: 'patch',
        instructions: 'Replace the fixed policy.',
        lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
      },
      {
        action: 'patch',
        lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        status: 'paused',
      },
    ]

    for (const request of invalidRequests) {
      expect(
        readAutomationDynamicToolRequest({
          arguments: request,
          tool: 'automation',
        })?.kind,
      ).toBe('invalid-automation-arguments')
    }

    const cancellation = readAutomationDynamicToolRequest({
      arguments: {
        action: 'patch',
        lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        status: 'archived',
      },
      tool: 'automation',
    })
    expect(cancellation).toEqual({
      kind: 'automation',
      request: {
        action: 'patch',
        lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        status: 'archived',
      },
    })
  })

  it('keeps the complete evidence and interestingness policy in source code', () => {
    const prompt = MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS

    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(
      40_000,
    )
    expectContainsAll(prompt, [
      'It is better to send nothing than to manufacture a weak insight.',
      'I did not know that about me, that is interesting',
      'Suppress true-but-boring findings.',
      'Treat proprietary readiness, recovery, sleep, or strain scores as summaries, not independent evidence.',
      'Missing, stale, sparse, misclassified, contradictory, or still-importing data is not evidence',
      'Never infer alcohol use, medication changes, illness, adherence, or another sensitive explanation from a proxy pattern.',
      'Return skip unless the scheduled occurrence context and current route are for one private member conversation.',
      'Return skip if the member asked not to receive this read, requested no follow-up, or otherwise revoked this proactive outreach.',
      'A generic closing invitation such as `anything else?` is not an unresolved task',
      'return skip if the page itself is malformed or unreadable',
      'use its compact `claim:`, `evidence:`, `uncertainty:`, and canonical source paths only as the same occurrence\'s semantic candidate',
      'revalidate the candidate against current canonical sources',
      'redo the bounded evidence pass from canonical sources instead of treating transport formatting as a terminal skip',
      'If any other section heading begins `First read `, return skip; this one-shot never sends a second first personal read.',
      'vault-cli knowledge append-section weekly-health-insights',
      'Use the exact ISO instant from the Scheduled occurrence context so only a retry of this occurrence can reuse its semantic candidate.',
      'Do not store the outbound message or any transport framing in this page.',
      'A failed dedupe write must not make the member lose an otherwise sound first read.',
      'The page owns semantic non-repeat only; the existing occurrence-scoped cron/outbox identity freezes and replays exact member-facing text after an outbox intent exists.',
      'I took a deeper look across what you shared.',
      'at most one optional low-burden next action or question',
      'Do not diagnose, prescribe, alarm, shame, dump metrics, stack findings, create a habit, plan, experiment, reminder, or other action',
      'do not spawn a child; this scheduled turn owns the complete read, selection, and delivery',
    ])
    expect(prompt).not.toContain('schema: murph.first-personal-read.v1')
    expect(prompt).not.toContain('outbound_text_utf8_bytes')
    expect(prompt).not.toContain('MURPH FIRST READ OUTBOUND')
    expect(prompt).not.toContain('First read <Occurrence local date>')
  })

  it('keeps onboarding responsible only for invoking the fixed action', async () => {
    const onboarding = await readOnboardingCompletionGuidance()
    const firstReadIndex = onboarding.indexOf(
      `{"action":"${MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION}"}`,
    )
    const completionIndex = onboarding.indexOf(
      'vault-cli assistant onboarding complete --reason user_answered',
    )

    expect(firstReadIndex).toBeGreaterThan(-1)
    expect(firstReadIndex).toBeGreaterThan(completionIndex)
    expect(
      onboarding.match(
        new RegExp(MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION, 'gu'),
      ),
    ).toHaveLength(1)
    expectContainsAll(onboarding, [
      'The host owns the immutable automation identity, current-conversation route binding, two-minute delay, bounded active window, fresh continuity, selected model with high reasoning, and complete first-read prompt.',
      'Do not call generic `save`, provide instructions, calculate timestamps, choose a model, or add fields.',
      'The host accepts the action only on the single trusted ordinary foreground turn that began with onboarding open and has just completed it with `user_answered`',
      'Never arm it when the current message says the member asked not to receive this read, requested no follow-up, or otherwise revoked this proactive outreach.',
      'do not retry, block completion, roll back completion, or mention the failure',
      'If I find something genuinely useful—whether that\'s a pattern, a clearer interpretation, or something worth watching next—I\'ll send it over.',
    ])
    expect(onboarding).not.toContain(
      'then send you the most useful thing I find',
    )
    expect(onboarding).not.toContain(
      'slug: "onboarding-first-personal-read"',
    )
    expect(onboarding).not.toContain(
      'schedule the occurrence for two minutes later',
    )
    expect(onboarding).not.toContain(
      'assistantTargetOverride: { "model": "gpt-5.6-sol"',
    )
  })

  it('documents the fixed action and cancellation boundary', () => {
    expectContainsAll(MURPH_AUTOMATION_TOOL.description, [
      'save_onboarding_first_personal_read creates the fixed code-owned private first-read one-shot for the answered-onboarding completion turn',
      'it accepts no prompt, timing, model, route, or other fields',
      'Generic save cannot replace it',
      'generic patch may only archive the existing record when the member cancels',
    ])
  })

  it('rejects invalid builder dates', () => {
    expect(() =>
      buildOnboardingFirstPersonalReadAutomationSaveRequest({
        now: new Date(Number.NaN),
      }),
    ).toThrow('invalid current date')
  })
})
