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
  it('keeps onboarding eligible in the first session after the signup welcome marked first contact seen', async () => {
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

    expect(plan.firstTurnCheckInStateDocIds).toEqual(stateDocIds)
    expect(plan.firstTurnCheckInEligible).toBe(true)
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

    expect(plan.firstTurnCheckInStateDocIds.length).toBeGreaterThan(0)
    expect(plan.firstTurnCheckInEligible).toBe(false)
  })

  it('forces a bootstrap prompt instead of native resume whenever first-session onboarding is eligible', () => {
    expect(
      resolveAssistantOnboardingInjectionPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        firstTurnCheckInEligible: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      firstTurnCheckInInjected: true,
      resumeProviderSessionId: null,
      shouldInjectBootstrapContext: true,
    })
    expect(
      resolveAssistantOnboardingInjectionPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        firstTurnCheckInEligible: true,
        promptProfile: 'notification-decision',
      }),
    ).toEqual({
      firstTurnCheckInInjected: false,
      resumeProviderSessionId: 'provider-session-1',
      shouldInjectBootstrapContext: false,
    })
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
    includeFirstTurnCheckIn: true,
    prompt,
  }
}
