import type {
  AutomationContinuityPolicy,
  AutomationSchedule,
} from '@murphai/contracts'
import type {
  AssistantOnboardingResumeContextResult,
  AssistantOnboardingCompletionReason,
} from '@murphai/operator-config/assistant-cli-contracts'
import { showAutomation } from '@murphai/query'

import {
  completeAssistantOnboarding,
  readAssistantOnboardingState,
} from './onboarding-state.js'
import { readAssistantOnboardingResumeContext } from './onboarding-resume-context.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'

export type MurphOnboardingFollowupAutomationSchedule = Exclude<
  AutomationSchedule,
  { kind: 'deviceActivity' }
>

export interface MurphOnboardingFollowupAutomationDefinition {
  continuityPolicy: AutomationContinuityPolicy
  instructions: string
  schedule: MurphOnboardingFollowupAutomationSchedule
  slug: string
  summary: string
  tags: readonly string[]
  title: string
}

export const MURPH_ONBOARDING_FOLLOWUP_AUTOMATION =
  {
    slug: 'finish-onboarding-followup',
    title: 'Finish Murph onboarding follow-up',
    summary: 'Daily aspiration-and-foundation continuation check until Murph onboarding is complete.',
    continuityPolicy: 'preserve',
    schedule: {
      kind: 'dailyLocal',
      localTime: '13:30',
    },
    tags: [
      'assistant',
      'scheduled',
      'murph-managed',
      'onboarding',
      'murph-managed:onboarding-followup',
    ],
    instructions: [
      'Goal: advance Murph onboarding through an anchored health aspiration, a finite health-context foundation, and a contextual return without turning it into a drip questionnaire or unsolicited plan. Ordinary health help remains available while onboarding is open. The first scheduled occurrence is intentionally deferred until the next local day after the relationship begins.',
      '',
      'Before deciding, load and follow the registered `murph-onboarding` skill with `murph.scheduled_read` action `skill_get`, then use the engine-supplied onboarding resume context and available recent user messages. The skill is the single owner of conversation order, checkpoint meaning, persistence, and completion; do not create a second state machine in this automation.',
      '',
      'Success criteria: onboarding is no longer open, or exactly one skill-approved, reply-oriented onboarding question usefully advances the relationship.',
      '',
      'If `onboarding.status` is `completed`, return skip. The managed-automation owner archives this follow-up deterministically.',
      '',
      'If the onboarding skill says the visible and saved evidence satisfies answered completion or shows an overall decline, call `murph.complete_onboarding` with the matching `user_answered` or `user_declined` reason, then return skip without messaging. The tool is bound to the exact prepared managed-automation revision and revalidates it before the idempotent write; never attempt another mutation path. The managed-automation owner retires this follow-up after completion.',
      '',
      'Otherwise use exactly the next unresolved step from the onboarding skill, including aspiration capture, explicit parking, foundation questions, contextual return, and its targeted-read rules for omitted, truncated, or errored evidence. If that step is only a reflection or parking transition, combine it with the next skill-approved question when the skill permits; otherwise return skip. Do not compress, reorder, or bypass that policy merely because this is a scheduled run.',
      '',
      'This automation never owns a promised check-in, reminder, or proactive support action. Those use the canonical plan and dedicated automation required by `behavior-followthrough`, which owns timing, due evaluation, delivery, retry, and skip behavior.',
      '',
      'Before sending, triple-check the snapshot and recent messages for an answer, skip, defer, or decline. Do not re-ask known or resolved context. If the latest onboarding question is unanswered, do not rotate to another setup question or repeat it through this daily automation; return skip. Honor requested timing, and return skip whenever there is no timely, useful onboarding continuation.',
      '',
      "Output: send one brief, natural, low-pressure in-chat continuation only when it advances unfinished onboarding. Every user-facing scheduled continuation must include exactly one easy, reply-oriented question; otherwise return skip. Do not mention internal state, setup completion, or this automation, and do not use a fixed script. The user's reply will be handled by the next normal Murph onboarding turn.",
    ].join('\n'),
  } satisfies MurphOnboardingFollowupAutomationDefinition

export type PreparedOnboardingFollowupScheduledTurn =
  | { kind: 'continue' }
  | {
      kind: 'continue'
      promptContext: AssistantOnboardingResumeContextResult
      scheduledTaskAuthority: {
        automationId: string
        expectedUpdatedAt: string
        kind: 'onboarding_followup'
      }
    }
  | { kind: 'skip'; reason: string }

/**
 * Parent-owned admission for the managed onboarding continuation.
 *
 * Prepared context is ephemeral and returned only after this owner recomputes
 * the complete managed definition and current onboarding state. Mutable tag
 * or slug matching alone never grants a scheduled mutation.
 */
export async function prepareOnboardingFollowupScheduledTurn(input: {
  automation: {
    activeUntil: string | null
    automationId: string
    continuityPolicy: AutomationContinuityPolicy
    instructions: string
    schedule: AutomationSchedule
    scheduledTask?: unknown
    slug: string
    status: string
    summary: string | null
    supportKind?: unknown
    tags: readonly string[]
    title: string
    updatedAt: string
  }
  readDeviceAccounts?: (() => Promise<readonly unknown[]>) | null
  vault: string
}): Promise<PreparedOnboardingFollowupScheduledTurn> {
  if (!isExactManagedOnboardingFollowup(input.automation)) {
    return { kind: 'continue' }
  }

  const onboarding = await readAssistantOnboardingState(input.vault)
  if (onboarding.status === 'completed') {
    return {
      kind: 'skip',
      reason: 'onboarding is already complete',
    }
  }

  return {
    kind: 'continue',
    promptContext: await readAssistantOnboardingResumeContext({
      readDeviceAccounts: input.readDeviceAccounts ?? null,
      vault: input.vault,
    }),
    scheduledTaskAuthority: {
      automationId: input.automation.automationId,
      expectedUpdatedAt: input.automation.updatedAt,
      kind: 'onboarding_followup',
    },
  }
}

/** Revalidate the exact prepared source revision immediately before writing. */
export async function completePreparedOnboardingFollowup(input: {
  automationId: string
  expectedUpdatedAt: string
  reason: Exclude<AssistantOnboardingCompletionReason, 'manual'>
  vault: string
}) {
  return withAssistantRuntimeWriteLock(input.vault, async () => {
    const existing = await readAssistantOnboardingState(input.vault)
    if (existing.status === 'completed') {
      return existing
    }

    const automation = await showAutomation(input.vault, input.automationId)
    if (
      !automation ||
      automation.updatedAt !== input.expectedUpdatedAt ||
      !isExactManagedOnboardingFollowup(automation)
    ) {
      throw new Error('Scheduled onboarding authority is no longer current.')
    }

    return completeAssistantOnboarding({
      reason: input.reason,
      vault: input.vault,
    })
  })
}

function isExactManagedOnboardingFollowup(
  automation: Parameters<typeof prepareOnboardingFollowupScheduledTurn>[0]['automation'],
): boolean {
  const expected = MURPH_ONBOARDING_FOLLOWUP_AUTOMATION
  return automation.automationId.trim().length > 0 &&
    isAutomationActiveAtCurrentTime(automation.activeUntil) &&
    automation.status === 'active' &&
    automation.slug === expected.slug &&
    automation.title === expected.title &&
    automation.summary === expected.summary &&
    automation.instructions === expected.instructions &&
    automation.continuityPolicy === expected.continuityPolicy &&
    automation.schedule.kind === expected.schedule.kind &&
    automation.schedule.kind === 'dailyLocal' &&
    automation.schedule.localTime === expected.schedule.localTime &&
    automation.scheduledTask == null &&
    automation.supportKind == null &&
    automation.tags.length === expected.tags.length &&
    automation.tags.every((tag, index) => tag === expected.tags[index])
}

function isAutomationActiveAtCurrentTime(activeUntil: string | null): boolean {
  if (activeUntil === null) {
    return true
  }

  const activeUntilMs = Date.parse(activeUntil)
  return Number.isFinite(activeUntilMs) && Date.now() < activeUntilMs
}
