import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it } from 'vitest'

import {
  markAssistantFirstContactSeen,
  markAssistantOnboardingBootstrapSeen,
  resolveAssistantOnboardingBootstrapStateDocIds,
  resolveAssistantFirstContactStateDocIds,
} from '../src/assistant/first-contact.js'
import {
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.js'
import {
  resolveAssistantProviderThreadPlan,
} from '../src/assistant/provider-turn-runner.js'
import {
  resolveAssistantOnboardingGuidanceOpen,
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
  it('does not keep onboarding eligible past the first assistant turn when the bootstrap marker is missing', async () => {
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
    const bootstrapDocIds = resolveAssistantOnboardingBootstrapStateDocIds(route)
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
    expect(plan.onboardingBootstrapStateDocIds).toEqual(bootstrapDocIds)
    expect(plan.onboardingGuidanceOpen).toBe(false)
  })

  it('stops onboarding eligibility for later routes once the vault bootstrap marker exists', async () => {
    const vault = await createTempVault()
    const firstRoute = {
      actorId: 'actor-first',
      channel: 'linq',
      identityId: 'member-first',
      threadId: 'thread-first',
      threadIsDirect: true,
    } as const
    await resolveAssistantSession({
      vault,
      target,
      ...firstRoute,
      now: new Date('2026-04-21T12:00:00.000Z'),
    })
    await markAssistantOnboardingBootstrapSeen({
      docIds: resolveAssistantOnboardingBootstrapStateDocIds(firstRoute),
      seenAt: '2026-04-21T12:00:01.000Z',
      vault,
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
    expect(plan.onboardingBootstrapStateDocIds.length).toBeGreaterThan(0)
    expect(plan.onboardingGuidanceOpen).toBe(false)
  })

  it('stops onboarding eligibility once the vault bootstrap marker is recorded', async () => {
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

    await markAssistantOnboardingBootstrapSeen({
      docIds: resolveAssistantOnboardingBootstrapStateDocIds(route),
      seenAt: '2026-04-21T12:00:01.000Z',
      vault,
    })

    const plan = await resolveAssistantTurnSharedPlan(
      createMessageInput(vault, route, 'tell me about sleep debt'),
      resolved,
    )

    expect(plan.onboardingGuidanceOpen).toBe(false)
  })

  it('uses one committed assistant turn as the onboarding fallback window', () => {
    expect(
      resolveAssistantOnboardingGuidanceOpen({
        includeOnboardingGuidance: true,
        onboardingBootstrapMarkerResolvable: false,
        onboardingBootstrapSeen: false,
        sessionTurnCount: 0,
      }),
    ).toBe(true)
    expect(
      resolveAssistantOnboardingGuidanceOpen({
        includeOnboardingGuidance: true,
        onboardingBootstrapMarkerResolvable: false,
        onboardingBootstrapSeen: false,
        sessionTurnCount: 1,
      }),
    ).toBe(false)
    expect(
      resolveAssistantOnboardingGuidanceOpen({
        includeOnboardingGuidance: true,
        onboardingBootstrapMarkerResolvable: true,
        onboardingBootstrapSeen: false,
        sessionTurnCount: 10,
      }),
    ).toBe(false)
  })

  it('preserves native resume while keeping onboarding guidance open on conversation turns', () => {
    expect(
      resolveAssistantProviderThreadPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        onboardingGuidanceOpen: true,
        promptProfile: 'conversation',
      }),
    ).toEqual({
      onboardingGuidanceInjected: true,
      resumeProviderSessionId: 'provider-session-1',
      shouldInjectBootstrapContext: false,
    })
    expect(
      resolveAssistantProviderThreadPlan({
        candidateResumeProviderSessionId: 'provider-session-1',
        onboardingGuidanceOpen: true,
        promptProfile: 'notification-decision',
      }),
    ).toEqual({
      onboardingGuidanceInjected: false,
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
    includeEarlySessionOnboarding: true,
    prompt,
  }
}
