import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeVault } from '@murphai/core'
import {
  buildHostedMemberChannelWelcomeDeliveryIdentity,
  buildHostedMemberSignupWelcomeInstructions,
} from '@murphai/hosted-execution'
import { sendAssistantNotificationLocal, type AssistantNotificationInput } from '../src/assistant/notification-turn.js'
import { listAssistantOutboxIntents } from '../src/assistant/outbox.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(channel: 'email' | 'linq') {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-welcome-replay-'))
  roots.push(vault)
  await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
  const text = 'Welcome to Murph. What would you like help with first?'
  const input: AssistantNotificationInput = {
    actorId: channel === 'linq' ? 'synthetic-phone-actor' : null,
    bindingDeliveryTarget: channel === 'email' ? 'member@example.test' : '+12025550123',
    channel, deliveryDispatchMode: 'queue-only',
    deliveryKind: channel === 'linq' ? 'participant' : null,
    deliverySource: channel === 'linq' ? { kind: 'linq', fromPhoneNumber: '+12025550124' } : null,
    deliveryTarget: channel === 'email' ? 'member@example.test' : null,
    executionContext: { hosted: { memberId: 'synthetic-member', userEnvKeys: [] } },
    firstContactPolicy: { markSeenOnDeliveryAccepted: true }, identityId: `synthetic-${channel}-identity`,
    instructions: buildHostedMemberSignupWelcomeInstructions(text),
    responsePolicy: { kind: 'require_send_exact_text', text },
    threadId: null, threadIsDirect: true, vault,
  }
  const key = buildHostedMemberChannelWelcomeDeliveryIdentity({
    memberId: 'synthetic-member', channel, destinationLookupKey: input.identityId!,
  })
  const legacyKey = `signup-welcome:synthetic-member${channel === 'linq' ? ':linq' : ''}`
  return { input, key, legacyKey, vault }
}

describe('channel welcome durable replay', () => {
  it.each([
    ['email', true], ['email', false], ['linq', true], ['linq', false],
  ] as const)('reuses the same %s delivery across legacy/new order legacyFirst=%s', async (channel, legacyFirst) => {
    const { input, key, legacyKey, vault } = await fixture(channel)
    const firstKey = legacyFirst ? legacyKey : key
    const nextKey = legacyFirst ? key : legacyKey
    const first = await sendAssistantNotificationLocal({ ...input, deliveryDedupeToken: firstKey, deliveryIdempotencyKey: firstKey })
    const second = await sendAssistantNotificationLocal({
      ...input, deliveryDedupeToken: nextKey, deliveryIdempotencyKey: nextKey,
      // Even if conversation occurred between attempts, accepted copy is immutable.
      connectedChannelGreeting: true,
      onProviderRequestStarted: () => { throw new Error('Replay must never invoke a provider') },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(1)
    expect(first.deliveryOutcome?.kind).toBe('queued')
    expect(second.deliveryOutcome).toEqual(first.deliveryOutcome)
  })

  it.each(['email', 'linq'] as const)('permits a different verified %s destination without reusing old first contact', async (channel) => {
    const { input, key, vault } = await fixture(channel)
    await sendAssistantNotificationLocal({ ...input, deliveryDedupeToken: key, deliveryIdempotencyKey: key })
    const identityId = `synthetic-other-${channel}-identity`
    const nextKey = buildHostedMemberChannelWelcomeDeliveryIdentity({
      memberId: 'synthetic-member', channel, destinationLookupKey: identityId,
    })
    await sendAssistantNotificationLocal({
      ...input, identityId, actorId: channel === 'linq' ? 'synthetic-other-phone-actor' : null,
      bindingDeliveryTarget: channel === 'email' ? 'other@example.test' : '+12025550125',
      deliveryTarget: channel === 'email' ? 'other@example.test' : null,
      deliveryDedupeToken: nextKey, deliveryIdempotencyKey: nextKey,
    })
    const intents = await listAssistantOutboxIntents(vault)
    expect(intents).toHaveLength(2)
    expect(new Set(intents.map((intent) => intent.deliveryIdempotencyKey)).size).toBe(2)
  })
})
