import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS,
} from '../src/assistant/onboarding-first-personal-read-automation.js'

async function readOnboardingSkill(): Promise<string> {
  const skillsRoot = resolveAssistantSkillsRoot()
  const raw = await readFile(
    path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'),
    'utf8',
  )
  return raw.replace(/\s+/gu, ' ')
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
        model: 'gpt-5.6-sol',
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
  })

  it('turns the zero-argument action into the code-owned request', () => {
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

    const modelAuthoredOverride = readAutomationDynamicToolRequest({
      arguments: {
        action: MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
        instructions: 'Use a weaker model-authored prompt instead.',
      },
      tool: 'automation',
    })
    expect(modelAuthoredOverride?.kind).toBe(
      'invalid-automation-arguments',
    )
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
    const automationTool: AssistantHostedAutomationTool = {
      async request(request) {
        received = request
        return {
          action: 'save',
          automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          created: true,
          lookupId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          routeBinding: 'current_conversation',
          status: 'active',
        }
      },
    }

    const result = await executeAutomationDynamicTool({
      automationTool,
      request: parsed,
    })

    expect(received).toEqual(
      buildOnboardingFirstPersonalReadAutomationSaveRequest({
        now: new Date('2026-08-06T21:00:00.000Z'),
      }),
    )
    expect(result.rpcResult.success).toBe(true)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"routeBinding":"current_conversation"',
    )
  })

  it('blocks generic save and patch from replacing the fixed prompt', () => {
    const genericSave = readAutomationDynamicToolRequest({
      arguments: {
        action: 'save',
        instructions: 'Replace the fixed policy.',
        schedule: {
          kind: 'at',
          at: '2026-08-06T21:02:00.000Z',
        },
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        title: 'Replacement',
      },
      tool: 'automation',
    })
    expect(genericSave?.kind).toBe('invalid-automation-arguments')

    const derivedSlugSave = readAutomationDynamicToolRequest({
      arguments: {
        action: 'save',
        instructions: 'Replace the fixed policy through a derived slug.',
        schedule: {
          kind: 'at',
          at: '2026-08-06T21:02:00.000Z',
        },
        title: 'Onboarding first personal read',
      },
      tool: 'automation',
    })
    expect(derivedSlugSave?.kind).toBe('invalid-automation-arguments')

    const genericPatch = readAutomationDynamicToolRequest({
      arguments: {
        action: 'patch',
        instructions: 'Replace the fixed policy.',
        lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
      },
      tool: 'automation',
    })
    expect(genericPatch?.kind).toBe('invalid-automation-arguments')
  })

  it('keeps the full evidence and interestingness policy in source code', () => {
    const prompt = MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS

    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(
      40_000,
    )
    expect(prompt).toContain(
      'It is better to send nothing than to manufacture a weak insight.',
    )
    expect(prompt).toContain(
      'I did not know that about me, that is interesting',
    )
    expect(prompt).toContain(
      'Suppress true-but-boring findings.',
    )
    expect(prompt).toContain(
      'Treat proprietary readiness, recovery, sleep, or strain scores as summaries, not independent evidence.',
    )
    expect(prompt).toContain(
      'Missing, stale, sparse, misclassified, contradictory, or still-importing data is not evidence',
    )
    expect(prompt).toContain(
      'Never infer alcohol use, medication changes, illness, adherence, or another sensitive explanation from a proxy pattern.',
    )
    expect(prompt).toContain(
      'Return skip when a substantive proactive health question, decision, or requested action from Murph is still waiting for the member.',
    )
    expect(prompt).toContain(
      'A generic closing invitation such as `anything else?` is not an unresolved task',
    )
    expect(prompt).toContain(
      'Read `vault-cli knowledge show weekly-health-insights`.',
    )
    expect(prompt).toContain(
      'vault-cli knowledge append-section weekly-health-insights',
    )
    expect(prompt).toContain(
      'A failed dedupe write must not make the member lose an otherwise sound first read.',
    )
    expect(prompt).toContain(
      'I took a deeper look across what you shared.',
    )
    expect(prompt).toContain(
      'at most one optional low-burden next action or question',
    )
    expect(prompt).toContain(
      'Do not diagnose, prescribe, alarm, shame, dump metrics, stack findings, create a habit, plan, experiment, reminder, or other action',
    )
    expect(prompt).toContain(
      'do not spawn a child; this scheduled turn owns the complete read, selection, and delivery',
    )
  })

  it('keeps onboarding responsible only for invoking the fixed action', async () => {
    const onboarding = await readOnboardingSkill()
    const firstReadIndex = onboarding.indexOf(
      `{"action":"${MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION}"}`,
    )
    const completionIndex = onboarding.indexOf(
      'vault-cli assistant onboarding complete --reason user_answered',
    )

    expect(firstReadIndex).toBeGreaterThan(-1)
    expect(completionIndex).toBeGreaterThan(firstReadIndex)
    expect(
      onboarding.match(
        new RegExp(MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION, 'gu'),
      ),
    ).toHaveLength(1)
    expect(onboarding).toContain(
      'The host owns the immutable automation identity, current-conversation route binding, two-minute delay, bounded active window, fresh continuity, Sol/high target, and complete first-read prompt.',
    )
    expect(onboarding).toContain(
      'Do not call generic `save`, provide instructions, calculate timestamps, choose a model, or add fields.',
    )
    expect(onboarding).toContain(
      'do not retry, block completion, or mention the failure',
    )
    expect(onboarding).toContain(
      'whether that\'s a pattern, a clearer interpretation, or what seems worth watching next',
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

  it('documents the structured action as fixed and fieldless', () => {
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'save_onboarding_first_personal_read creates the fixed code-owned private first-read one-shot after answered onboarding',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'it accepts no prompt, timing, model, route, or other fields',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'generic save or patch cannot replace it',
    )
  })

  it('rejects invalid builder dates', () => {
    expect(() =>
      buildOnboardingFirstPersonalReadAutomationSaveRequest({
        now: new Date(Number.NaN),
      }),
    ).toThrow('invalid current date')
  })
})
