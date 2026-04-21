import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it } from 'vitest'

import {
  markAssistantFirstContactSeen,
  resolveAssistantFirstContactStateDocIds,
} from '../src/assistant/first-contact.js'
import {
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.js'
import {
  resolveAssistantOnboardingInjectionPlan,
} from '../src/assistant/provider-turn-runner.js'
import {
  isAssistantSessionFreshForOnboarding,
  resolveAssistantTurnSharedPlan,
} from '../src/assistant/turn-plan.js'
import type {
  AssistantMessageInput,
} from '../src/assistant/service-contracts.js'

const target = createDefaultLocalAssistantModelTarget()
if (!target) {
  throw new Error('Expected a default assistant model target for onboarding tests.')
}

const tempVaults: string[] = []

afterEach(async () => {
  await Promise.all(
    tempVaults.splice(0).map((vault) => rm(vault, { force: true, recursive: true })),
  )
})

describe('assistant onboarding prompt injection', () => {
  it('ends onboarding eligibility after the first turn once first-contact state is seen', async () => {
    const vault = await createTempVault()
    const route = {
      actorId: 'actor-first',
      channel: 'linq',
      identityId: 'member-first',
      threadId: 'thread-first',
      threadIsDirect: true,
    } as const
    const resolved = await resolveAssistantSession({
      vault,
      target,
      ...route,
      now: new Date('2026-04-21T12:00:00.000Z'),
    })
    const stateDocIds = resolveAssistantFirstContactStateDocIds(route)
    await markAssistantFirstContactSeen({
      docIds: stateDocIds,
      seenAt: '2026-04-21T12:00:01.000Z',
      vault,
    })
    const sessionAfterWelcome = await saveAssistantSession(vault, {
      ...resolved.session,
      lastTurnAt: '2026-04-21T12:00:02.000Z',
      turnCount: 1,
      updatedAt: '2026-04-21T12:00:02.000Z',
    })

    const plan = await resolveAssistantTurnSharedPlan(
      createMessageInput(vault, route, 'Yea!'),
      {
        ...resolved,
        session: sessionAfterWelcome,
      },
    )

    expect(plan.firstContactStateDocIds).toEqual(stateDocIds)
    expect(plan.earlySessionOnboardingEligible).toBe(false)
  })

  it('does not inject onboarding for a later session in the same vault', async () => {
    const vault = await createTempVault()
    await resolveAssistantSession({
      vault,
      target,
      actorId: 'actor-first',
      channel: 'linq',
      identityId: 'member-first',
      threadId: 'thread-first',
      threadIsDirect: true,
      now: new Date('2026-04-21T12:00:00.000Z'),
    })
    const laterRoute = {
      actorId: 'actor-later',
      channel: 'linq',
      identityId: 'member-later',
      threadId: 'thread-later',
      threadIsDirect: true,
    } as const
    const laterSession = await resolveAssistantSession({
      vault,
      target,
      ...laterRoute,
      now: new Date('2026-04-21T12:05:00.000Z'),
    })

    const plan = await resolveAssistantTurnSharedPlan(
      createMessageInput(vault, laterRoute, 'hello'),
      laterSession,
    )

    expect(plan.firstContactStateDocIds.length).toBeGreaterThan(0)
    expect(plan.earlySessionOnboardingEligible).toBe(false)
  })

  it('preserves native resume even when the first-session onboarding gate is otherwise eligible', () => {
    expect(
      resolveAssistantOnboardingInjectionPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        earlySessionOnboardingEligible: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      earlySessionOnboardingInjected: false,
      resumeProviderSessionId: 'provider-session-1',
      shouldInjectBootstrapContext: false,
    })
    expect(
      resolveAssistantOnboardingInjectionPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        earlySessionOnboardingEligible: true,
        promptProfile: 'notification-decision',
      }),
    ).toEqual({
      earlySessionOnboardingInjected: false,
      resumeProviderSessionId: 'provider-session-1',
      shouldInjectBootstrapContext: false,
    })
  })

  it('treats only zero-turn sessions as fresh enough for onboarding', () => {
    expect(isAssistantSessionFreshForOnboarding({ turnCount: 0 })).toBe(true)
    expect(isAssistantSessionFreshForOnboarding({ turnCount: 1 })).toBe(false)
  })
})

async function createTempVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-onboarding-'))
  tempVaults.push(vault)
  return vault
}

function createMessageInput(
  vault: string,
  route: {
    actorId: string
    channel: string
    identityId: string
    threadId: string
    threadIsDirect: boolean
  },
  prompt: string,
): AssistantMessageInput {
  return {
    vault,
    ...route,
    includeEarlySessionOnboarding: true,
    prompt,
  }
}
