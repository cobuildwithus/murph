import { rm } from 'node:fs/promises'

import type {
  HostedRuntimeNewsletterToolRequest,
  HostedRuntimeNewsletterToolResponse,
} from '@murphai/hosted-execution/runtime-control'
import {
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAssistantNewsletterOutboxTool } from '../src/assistant/newsletter-outbox.ts'
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const AUTHORITY = {
  automationId: 'automation_newsletter',
  occurrenceAt: '2026-07-12T13:00:00.000Z',
}
const AUTHORIZATION_PROOF = 'a'.repeat(64)
const CHANGED_AUTHORIZATION_PROOF = 'b'.repeat(64)
const DELIVERY_KEY =
  'group-newsletter:automation_newsletter:2026-07-12T13:00:00.000Z:group_123'
const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

describe('newsletter durable outbox capability', () => {
  it('closes the capability after a second prepare attempt', async () => {
    const vault = await createVault('newsletter-outbox-one-shot-')
    const request = vi.fn(async () => preparationResponse())
    const tool = createTool({ request, turnId: 'turn_one', vault })

    await expect(prepare(tool)).resolves.toEqual(preparationResponse())
    await expect(prepare(tool)).resolves.toEqual({
      action: 'prepare',
      result: {
        status: 'unavailable',
        unavailableReason: 'newsletter_capability_consumed',
      },
    })
    await expect(send(tool)).resolves.toEqual({
      action: 'send',
      result: {
        status: 'unavailable',
        unavailableReason: 'newsletter_capability_consumed',
      },
    })

    expect(await listAssistantOutboxIntents(vault)).toHaveLength(0)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('honors trusted capability closure after a no-recipient prepare', async () => {
    const vault = await createVault('newsletter-outbox-no-recipient-close-')
    const request = vi.fn(async () => preparationResponse({ participantIds: [] }))
    const tool = createTool({ request, turnId: 'turn_no_recipients', vault })

    await expect(prepare(tool)).resolves.toEqual(
      preparationResponse({ participantIds: [] }),
    )
    tool.closeCapability()
    await expect(send(tool)).resolves.toEqual({
      action: 'send',
      result: {
        status: 'unavailable',
        unavailableReason: 'newsletter_capability_consumed',
      },
    })

    expect(await listAssistantOutboxIntents(vault)).toHaveLength(0)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('allows one prepare and one send, then queues a proof-carrying parent', async () => {
    const vault = await createVault('newsletter-outbox-queue-')
    const request = vi.fn(async () => preparationResponse())
    const tool = createTool({ request, turnId: 'turn_one', vault })

    await prepare(tool)
    await expect(send(tool)).resolves.toMatchObject({
      action: 'send',
      result: { participantCount: 2, status: 'accepted' },
    })
    await expect(send(tool)).resolves.toMatchObject({
      action: 'send',
      result: { status: 'unavailable' },
    })

    const intents = await listAssistantOutboxIntents(vault)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      channel: 'email',
      deliveryIdempotencyKey: DELIVERY_KEY,
      emailHtml: '<p>Weekly</p>',
      message: 'Weekly',
      newsletterAuthorizationProof: AUTHORIZATION_PROOF,
      status: 'pending',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('returns terminal sent after the current proof parent and recipients are durable', async () => {
    const vault = await createVault('newsletter-outbox-terminal-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentSent(vault)
    await createRecipientIntent({ memberId: 'member_one', status: 'sent', vault })
    await createRecipientIntent({ memberId: 'member_two', status: 'sent', vault })

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toEqual({
      action: 'send',
      result: {
        participantCount: 2,
        skippedNoEmailMemberIds: ['member_no_email'],
        status: 'sent',
      },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(3)
  })

  it('does not requeue when duplicate-address fanout produced one sent child', async () => {
    const vault = await createVault('newsletter-outbox-duplicate-address-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentSent(vault)
    await createRecipientIntent({ memberId: 'member_one', status: 'sent', vault })

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toEqual({
      action: 'send',
      result: {
        participantCount: 2,
        skippedNoEmailMemberIds: ['member_no_email'],
        status: 'sent',
      },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(2)
  })

  it('does not replay a recipient with an ambiguous terminal delivery', async () => {
    const vault = await createVault('newsletter-outbox-ambiguous-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentSent(vault)
    await createRecipientIntent({
      errorCode: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      memberId: 'member_one',
      status: 'abandoned',
      vault,
    })

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toMatchObject({
      action: 'send',
      result: {
        failedRecipientCount: 1,
        sentRecipientCount: 0,
        status: 'partial_failure',
      },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(2)
  })

  it('does not restart an exhausted newsletter parent attempt', async () => {
    const vault = await createVault('newsletter-outbox-exhausted-parent-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentFailed(vault, 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED')

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toEqual({
      action: 'send',
      result: {
        failedRecipientCount: 2,
        participantCount: 2,
        sentRecipientCount: 0,
        skippedNoEmailMemberIds: ['member_no_email'],
        status: 'partial_failure',
      },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(1)
  })

  it('does not replay a recipient that exhausted its automatic retries', async () => {
    const vault = await createVault('newsletter-outbox-exhausted-recipient-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentSent(vault)
    await createRecipientIntent({
      errorCode: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      memberId: 'member_one',
      status: 'failed',
      vault,
    })

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toMatchObject({
      action: 'send',
      result: {
        failedRecipientCount: 1,
        sentRecipientCount: 0,
        status: 'partial_failure',
      },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(2)
  })

  it('retries a proven pre-provider recipient failure from the sent parent payload', async () => {
    const vault = await createVault('newsletter-outbox-safe-retry-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool, {
      html: '<p>Original weekly note</p>',
      subject: 'Original weekly note',
      text: 'Original weekly note',
    })
    await markOnlyIntentSent(vault)
    await createRecipientIntent({
      emailHtml: '<p>Original weekly note</p>',
      errorCode: 'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
      message: 'Original weekly note',
      memberId: 'member_one',
      status: 'abandoned',
      vault,
    })

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool, {
      html: '<p>Recomposed weekly note</p>',
      subject: 'Recomposed weekly note',
      text: 'Recomposed weekly note',
    })).resolves.toMatchObject({
      action: 'send',
      result: { status: 'accepted' },
    })
    const intents = await listAssistantOutboxIntents(vault)
    const parents = intents.filter((intent) =>
      parseHostedEmailThreadTarget(intent.explicitTarget)?.recipientMemberId === null
    )
    expect(parents).toHaveLength(1)

    const memberIntents = intents
      .filter((intent) =>
        parseHostedEmailThreadTarget(intent.explicitTarget)?.recipientMemberId
        === 'member_one'
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    expect(memberIntents).toHaveLength(2)
    const retryIntent = memberIntents[1]
    expect(retryIntent).toMatchObject({
      emailHtml: '<p>Original weekly note</p>',
      message: 'Original weekly note',
      newsletterAuthorizationProof: AUTHORIZATION_PROOF,
      status: 'pending',
      turnId: 'turn_first',
    })
    expect(parseHostedEmailThreadTarget(retryIntent?.explicitTarget ?? null))
      .toMatchObject({
        recipientMemberId: 'member_one',
        subject: 'Original weekly note',
      })
  })

  it('treats proof changes as terminal without re-planning a sent occurrence', async () => {
    const vault = await createVault('newsletter-outbox-proof-change-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse({ participantIds: ['member_one'] })),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentSent(vault)
    await createRecipientIntent({
      errorCode: 'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
      memberId: 'member_one',
      status: 'abandoned',
      vault,
    })

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse({
        authorizationProof: CHANGED_AUTHORIZATION_PROOF,
        participantIds: ['member_one'],
      })),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool, {
      html: '<p>Changed proof note</p>',
      subject: 'Changed proof note',
      text: 'Changed proof note',
    })).resolves.toMatchObject({
      action: 'send',
      result: {
        failedRecipientCount: 1,
        sentRecipientCount: 0,
        status: 'partial_failure',
      },
    })

    const intents = await listAssistantOutboxIntents(vault)
    expect(intents).toHaveLength(2)
    expect(intents.filter((intent) =>
      parseHostedEmailThreadTarget(intent.explicitTarget)?.recipientMemberId === null
    )).toHaveLength(1)
  })
})

function createTool(input: {
  request: (
    request: HostedRuntimeNewsletterToolRequest,
  ) => Promise<HostedRuntimeNewsletterToolResponse>
  turnId: string
  vault: string
}) {
  return createAssistantNewsletterOutboxTool({
    authority: AUTHORITY,
    newsletterTool: { request: input.request },
    sessionId: 'session_newsletter',
    turnId: input.turnId,
    vault: input.vault,
  })
}

function preparationResponse(input?: {
  authorizationProof?: string
  participantIds?: string[]
}): HostedRuntimeNewsletterToolResponse {
  const participantIds = input?.participantIds ?? ['member_one', 'member_two']
  return {
    action: 'prepare',
    result: {
      authorizationProof: input?.authorizationProof ?? AUTHORIZATION_PROOF,
      groupId: 'group_123',
      missingEmailParticipants: [
        { authorizedShares: [], hasEmail: false, memberId: 'member_no_email' },
      ],
      participants: [
        ...participantIds.map((memberId) => ({
          authorizedShares: [],
          hasEmail: true,
          memberId,
        })),
        { authorizedShares: [], hasEmail: false, memberId: 'member_no_email' },
      ],
      status: 'ok',
    },
  }
}

async function prepare(tool: ReturnType<typeof createTool>) {
  return await tool.request({ action: 'prepare', groupId: 'group_123' })
}

async function send(
  tool: ReturnType<typeof createTool>,
  input?: {
    html?: string
    subject?: string
    text?: string
  },
) {
  return await tool.request({
    action: 'send',
    groupId: 'group_123',
    html: input?.html ?? '<p>Weekly</p>',
    subject: input?.subject ?? 'Weekly health note',
    text: input?.text ?? 'Weekly',
  })
}

async function createVault(prefix: string): Promise<string> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(prefix)
  tempRoots.push(parentRoot)
  await ensureAssistantState(resolveAssistantStatePaths(vaultRoot))
  return vaultRoot
}

async function markOnlyIntentSent(vault: string): Promise<void> {
  const [intent] = await listAssistantOutboxIntents(vault)
  if (!intent) {
    throw new Error('Expected a newsletter parent intent.')
  }
  await saveAssistantOutboxIntent(vault, {
    ...intent,
    nextAttemptAt: null,
    sentAt: '2026-07-12T13:01:00.000Z',
    status: 'sent',
    updatedAt: '2026-07-12T13:01:00.000Z',
  })
}

async function markOnlyIntentFailed(vault: string, errorCode: string): Promise<void> {
  const [intent] = await listAssistantOutboxIntents(vault)
  if (!intent) {
    throw new Error('Expected a newsletter parent intent.')
  }
  await saveAssistantOutboxIntent(vault, {
    ...intent,
    lastError: {
      code: errorCode,
      message: 'terminal delivery state',
    },
    nextAttemptAt: null,
    status: 'failed',
    updatedAt: '2026-07-12T13:01:00.000Z',
  })
}

async function createRecipientIntent(input: {
  authorizationProof?: string
  emailHtml?: string
  errorCode?: string
  memberId: string
  message?: string
  status: 'abandoned' | 'failed' | 'sent'
  vault: string
}): Promise<void> {
  const created = await createAssistantOutboxIntent({
    channel: 'email',
    dedupeToken: `recipient:${input.memberId}`,
    deliveryIdempotencyKey: DELIVERY_KEY,
    emailHtml: input.emailHtml ?? '<p>Weekly</p>',
    explicitTarget: serializeHostedEmailThreadTarget({
      groupId: 'group_123',
      recipientMemberId: input.memberId,
      subject: 'Weekly health note',
      targetKind: 'group',
    }),
    message: input.message ?? 'Weekly',
    newsletterAuthorizationProof: input.authorizationProof ?? AUTHORIZATION_PROOF,
    sessionId: 'session_newsletter',
    threadIsDirect: false,
    turnId: `turn_recipient_${input.memberId}`,
    vault: input.vault,
  })
  await saveAssistantOutboxIntent(input.vault, {
    ...created,
    lastError: input.errorCode
      ? { code: input.errorCode, message: 'terminal delivery state' }
      : null,
    nextAttemptAt: null,
    sentAt: input.status === 'sent' ? '2026-07-12T13:02:00.000Z' : null,
    status: input.status,
    updatedAt: '2026-07-12T13:02:00.000Z',
  })
}
