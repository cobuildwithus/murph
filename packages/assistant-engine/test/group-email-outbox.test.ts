import { rm } from 'node:fs/promises'

import type {
  HostedRuntimeGroupEmailEffectRequest,
  HostedRuntimeGroupEmailEffectResponse,
} from '@murphai/hosted-execution/runtime-control'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAssistantGroupEmailOutboxTool } from '../src/assistant/group-email-outbox.ts'
import {
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
const OUTBOX_AUTOMATION_AUTHORITY = {
  automationId: 'automation_newsletter',
  expectedUpdatedAt: '2026-07-12T11:00:00.000Z',
}
const AUTHORIZATION_PROOF = 'a'.repeat(64)
const DELIVERY_KEY =
  'group-email-effect:automation_newsletter:2026-07-12T13:00:00.000Z:group_123'
const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

describe('group email durable outbox capability', () => {
  it('closes the capability after a second prepare attempt', async () => {
    const vault = await createVault('newsletter-outbox-one-shot-')
    const request = vi.fn(async () => preparationResponse())
    const tool = createTool({ request, turnId: 'turn_one', vault })

    await expect(prepare(tool)).resolves.toEqual(preparationResponse())
    await expect(prepare(tool)).resolves.toEqual({
      action: 'prepare_email',
      result: {
        status: 'unavailable',
        unavailableReason: 'group_email_capability_consumed',
      },
    })
    await expect(send(tool)).resolves.toEqual({
      action: 'send_email',
      result: {
        status: 'unavailable',
        unavailableReason: 'group_email_capability_consumed',
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
      action: 'send_email',
      result: {
        status: 'unavailable',
        unavailableReason: 'group_email_capability_consumed',
      },
    })

    expect(await listAssistantOutboxIntents(vault)).toHaveLength(0)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('allows one prepare and one send, then queues a proof-carrying parent', async () => {
    const vault = await createVault('newsletter-outbox-queue-')
    const request = vi.fn(async () => preparationResponse())
    const recordPendingDeliveryIntentId = vi.fn()
    const tool = createTool({
      recordPendingDeliveryIntentId,
      request,
      turnId: 'turn_one',
      vault,
    })

    await prepare(tool)
    await expect(send(tool)).resolves.toMatchObject({
      action: 'send_email',
      result: { participantCount: 2, status: 'accepted' },
    })
    await expect(send(tool)).resolves.toMatchObject({
      action: 'send_email',
      result: { status: 'unavailable' },
    })

    const intents = await listAssistantOutboxIntents(vault)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      automationAuthority: OUTBOX_AUTOMATION_AUTHORITY,
      channel: 'email',
      deliveryIdempotencyKey: DELIVERY_KEY,
      emailHtml: '<p>Weekly</p>',
      message: 'Weekly',
      groupEmailAuthorizationProof: AUTHORIZATION_PROOF,
      status: 'pending',
    })
    expect(recordPendingDeliveryIntentId).toHaveBeenCalledWith(
      intents[0]?.intentId,
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reattaches an existing active parent to deterministic cron settlement', async () => {
    const vault = await createVault('newsletter-outbox-active-parent-')
    const firstPendingIntent = vi.fn()
    const firstTool = createTool({
      recordPendingDeliveryIntentId: firstPendingIntent,
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)

    const retryPendingIntent = vi.fn()
    const retryTool = createTool({
      recordPendingDeliveryIntentId: retryPendingIntent,
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toMatchObject({
      action: 'send_email',
      result: { status: 'accepted' },
    })

    const intents = await listAssistantOutboxIntents(vault)
    expect(intents).toHaveLength(1)
    expect(firstPendingIntent).toHaveBeenCalledWith(intents[0]?.intentId)
    expect(retryPendingIntent).toHaveBeenCalledWith(intents[0]?.intentId)
  })

  it('returns terminal sent as soon as Web has durably planned recipient fanout', async () => {
    const vault = await createVault('newsletter-outbox-terminal-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentSent(vault)

    const recordPendingDeliveryIntentId = vi.fn()
    const retryTool = createTool({
      recordPendingDeliveryIntentId,
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toEqual({
      action: 'send_email',
      result: {
        participantCount: 2,
        skippedNoEmailMemberIds: ['member_no_email'],
        status: 'sent',
      },
    })
    expect(await listAssistantOutboxIntents(vault)).toHaveLength(1)
    expect(recordPendingDeliveryIntentId).not.toHaveBeenCalled()
  })

  it('does not restart a terminal group email parent', async () => {
    const vault = await createVault('group-email-outbox-failed-parent-')
    const firstTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_first',
      vault,
    })
    await prepare(firstTool)
    await send(firstTool)
    await markOnlyIntentFailed(vault, 'ASSISTANT_GROUP_EMAIL_FANOUT_REJECTED')

    const retryTool = createTool({
      request: vi.fn(async () => preparationResponse()),
      turnId: 'turn_retry',
      vault,
    })
    await prepare(retryTool)
    await expect(send(retryTool)).resolves.toEqual({
      action: 'send_email',
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
})

function createTool(input: {
  recordPendingDeliveryIntentId?: (intentId: string) => void
  request: (
    request: HostedRuntimeGroupEmailEffectRequest,
  ) => Promise<HostedRuntimeGroupEmailEffectResponse>
  turnId: string
  vault: string
}) {
  return createAssistantGroupEmailOutboxTool({
    automationAuthority: OUTBOX_AUTOMATION_AUTHORITY,
    authority: AUTHORITY,
    groupTool: {
      request: async (request) => {
        if (request.action !== 'prepare_email') {
          throw new Error('Expected group email preparation request.')
        }
        const response = await input.request(request)
        if (response.action !== 'prepare_email') {
          throw new Error('Expected group email preparation response.')
        }
        return response
      },
    },
    recordPendingDeliveryIntentId: input.recordPendingDeliveryIntentId,
    sessionId: 'session_newsletter',
    turnId: input.turnId,
    vault: input.vault,
  })
}

function preparationResponse(input?: {
  authorizationProof?: string
  participantIds?: string[]
}): HostedRuntimeGroupEmailEffectResponse {
  const participantIds = input?.participantIds ?? ['member_one', 'member_two']
  return {
    action: 'prepare_email',
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
  return await tool.request({ action: 'prepare_email', projectionScopes: [] })
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
    action: 'send_email',
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
