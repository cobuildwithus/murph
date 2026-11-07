import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildHostedMemberChannelWelcomeDeliveryIdentity,
  buildHostedMemberSignupWelcomeNotificationWake,
  buildHostedExecutionMemberActivatedWake,
} from '@murphai/hosted-execution'
import { executeHostedAssistantNotificationWake, executeHostedMemberActivatedWake } from '../src/hosted-runtime/events/assistant-notification.ts'
import { createEmptyHostedMailboxImportState, writeHostedMailboxImportState } from '../src/hosted-runtime/mailbox-state.ts'

const send = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ decision: { kind: 'send_message' } })))
vi.mock('@murphai/assistant-engine', async (original) => ({
  ...await original<typeof import('@murphai/assistant-engine')>(),
  sendAssistantNotification: send,
}))
const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(channel: 'email' | 'linq', conversation: string) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-channel-greeting-'))
  roots.push(vaultRoot)
  const state = createEmptyHostedMailboxImportState()
  state.watermarks = { conversation, system: '900' }
  await writeHostedMailboxImportState({ state, vaultRoot })
  const identityId = `synthetic-${channel}-identity`
  const wake = buildHostedMemberSignupWelcomeNotificationWake({
    memberId: 'synthetic-member', occurredAt: '2026-09-12T10:00:00.000Z',
    deliveryIdentity: buildHostedMemberChannelWelcomeDeliveryIdentity({
      memberId: 'synthetic-member', channel, destinationLookupKey: identityId,
    }),
    text: 'Welcome to Murph. What would you like help with first?',
    route: { actorId: null, channel, identityId, threadId: null, threadIsDirect: true,
      delivery: { kind: 'explicit', target: 'synthetic-destination' } },
  })
  return { wake, vaultRoot, executionContext: { hosted: { memberId: 'synthetic-member', userEnvKeys: [] } } }
}

describe('connected channel greeting execution policy', () => {
  it.each(['email', 'linq'] as const)('uses current inbound evidence when the %s wake executes', async (channel) => {
    const input = await fixture(channel, '0')
    await executeHostedAssistantNotificationWake(input)
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('connectedChannelGreeting')
    // The same queued welcome sees a reply admitted after it was queued.
    const state = createEmptyHostedMailboxImportState()
    state.watermarks.conversation = '1'
    await writeHostedMailboxImportState({ state, vaultRoot: input.vaultRoot })
    await executeHostedAssistantNotificationWake(input)
    expect(send.mock.calls[1]?.[0]).toMatchObject({ connectedChannelGreeting: true })
  })

  it.each(['member', 'destination', 'group'] as const)('does not expose conversation context for mismatched %s authority', async (mismatch) => {
    const input = await fixture('email', '4')
    if (mismatch === 'member') input.executionContext.hosted.memberId = 'another-member'
    if (mismatch === 'destination') input.wake.notification.route.identityId = 'another-identity'
    if (mismatch === 'group') input.wake.notification.route.threadIsDirect = false
    await executeHostedAssistantNotificationWake(input)
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('connectedChannelGreeting')
  })

  it('preserves retry ownership when contextual authoring fails', async () => {
    const input = await fixture('linq', '2')
    send.mockRejectedValueOnce(new Error('synthetic provider unavailable'))
    await expect(executeHostedAssistantNotificationWake(input)).rejects.toThrow('synthetic provider unavailable')
    await executeHostedAssistantNotificationWake(input)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0]).toMatchObject({ connectedChannelGreeting: true })
  })

  it('applies execution-time conversation evidence to retained embedded activation welcomes', async () => {
    const input = await fixture('email', '3')
    const wake = buildHostedExecutionMemberActivatedWake({
      memberId: 'synthetic-member', eventId: 'synthetic-retained-activation',
      occurredAt: input.wake.occurredAt, onboardingFollowupEnrollment: false,
      memberChannels: { email: true, linq: false, telegram: false },
      signupWelcome: { route: input.wake.notification.route, text: 'Welcome to Murph.' },
    })
    await executeHostedMemberActivatedWake({ ...input, wake })
    expect(send.mock.calls[0]?.[0]).toMatchObject({ connectedChannelGreeting: true })
  })
})
