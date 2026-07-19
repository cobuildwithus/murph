import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  initializeVault,
  patchAutomation,
  readMemoryDocument,
  showAutomation,
  upsertAutomation,
  upsertMemory,
} from '@murphai/core'
import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  buildAssistantGroupChallengeDispatchCommit,
  ASSISTANT_GROUP_CHALLENGE_PREPARED_BODY_MAX_LENGTH,
} from '../src/assistant/group-challenge-dispatch.js'
import {
  buildAssistantGroupChallengePointerText,
  commitAssistantGroupChallengeSentDelivery,
} from '../src/assistant/cron/group-challenge-delivery-commit.js'
import {
  getKnowledgePage,
  upsertKnowledgePage,
} from '../src/knowledge.js'
import { buildKnowledgePageRelativePath } from '../src/knowledge/documents.js'
import { archiveKnowledgeChallenge } from '../src/knowledge/service.js'
import {
  executeScheduledReadDynamicTool,
  readScheduledReadDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/scheduled-read.js'

const tempRoots: string[] = []
const OCCURRENCE_AT = '2026-07-19T08:00:00.000Z'
const PROJECTION_SCOPE_KEY = 'steps-days.v0'

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('group challenge dispatch commit capture', () => {
  const authority = {
    automationId: 'automation_group_challenge',
    expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
    kind: 'group_challenge',
    projectionScopeKey: PROJECTION_SCOPE_KEY,
    slug: 'summer-steps',
  } as const

  it('requires an exact occurrence and bounded nonempty private run record', () => {
    expect(buildAssistantGroupChallengeDispatchCommit({
      authority,
      occurrenceAt: OCCURRENCE_AT,
      outboxAutomationAuthority: {
        automationId: authority.automationId,
        expectedUpdatedAt: authority.expectedUpdatedAt,
      },
      privateSummary: 'Medium: text\nFrame: courtroom ruling',
    })).toEqual({
      occurrenceAt: OCCURRENCE_AT,
      preparedBody: 'Medium: text\nFrame: courtroom ruling',
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: authority.slug,
        projectionScopeKey: PROJECTION_SCOPE_KEY,
      },
    })

    for (const invalid of [
      { occurrenceAt: null, privateSummary: 'Prepared.' },
      { occurrenceAt: 'not-an-instant', privateSummary: 'Prepared.' },
      { occurrenceAt: OCCURRENCE_AT, privateSummary: '   ' },
      {
        occurrenceAt: OCCURRENCE_AT,
        privateSummary: 'x'.repeat(
          ASSISTANT_GROUP_CHALLENGE_PREPARED_BODY_MAX_LENGTH + 1,
        ),
      },
    ]) {
      expect(() => buildAssistantGroupChallengeDispatchCommit({
        authority,
        outboxAutomationAuthority: {
          automationId: authority.automationId,
          expectedUpdatedAt: authority.expectedUpdatedAt,
        },
        ...invalid,
      })).toThrow()
    }

    expect(() => buildAssistantGroupChallengeDispatchCommit({
      authority,
      occurrenceAt: OCCURRENCE_AT,
      outboxAutomationAuthority: {
        automationId: 'automation_other_challenge',
        expectedUpdatedAt: authority.expectedUpdatedAt,
      },
      privateSummary: 'Medium: text\nFrame: courtroom ruling',
    })).toThrowError(expect.objectContaining({
      code: 'ASSISTANT_GROUP_CHALLENGE_AUTHORITY_INVALID',
    }))
  })
})

describe('group challenge terminal sent commit', () => {
  it('logs exact accepted text with locator-free media and closes only the final occurrence', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    const intent = assistantOutboxIntentSchema.parse({
      ...buildSentIntent(fixture.automation),
      media: [
        {
          alt: 'A playful finish-line comic',
          kind: 'image',
          source: 'scheduled challenge image',
          url: 'https://imagedelivery.net/account/image/public',
        },
        {
          filename: 'member-private-id.mp3',
          kind: 'voice_memo',
          transcript: 'private transcript',
          transport: {
            attachmentId: 'private-attachment-id',
            kind: 'linq_attachment',
          },
        },
        {
          approvalGeneration: null,
          approvalId: null,
          contentType: 'application/pdf',
          filename: 'member-private-id.pdf',
          kind: 'vault_file',
          ref: 'raw/captures/private-report.pdf',
          sha256: 'a'.repeat(64),
          sizeBytes: 2048,
        },
      ],
    })

    const committed = await commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })
    expect(committed).toEqual({
      closeoutApplied: true,
      dispatchRecord: 'recorded',
      pointerRecordsRemoved: 1,
    })

    const page = (await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page
    expect(page.status).toBe('archived')
    expect(page.body).toContain(`## Delivered dispatch ${OCCURRENCE_AT}`)
    expect(page.body).toContain('Medium: image')
    expect(page.body).toContain('"message": "Summer Steps standings are in—today is close-out day."')
    expect(page.body).toContain('"alt": "A playful finish-line comic"')
    expect(page.body).toContain('"source": "accepted-image"')
    expect(page.body).not.toContain('imagedelivery.net')
    expect(page.body).not.toContain('scheduled challenge image')
    expect(page.body).not.toContain('private-attachment-id')
    expect(page.body).not.toContain('member-private-id')
    expect(page.body).not.toContain('private transcript')
    expect(page.body).not.toContain('raw/captures')
    expect(page.body).not.toContain('a'.repeat(64))
    expect(page.body).toContain('"contentType": "application/pdf"')
    expect(page.body).toContain('"sizeBytes": 2048')
    expect((await readMemoryDocument(fixture.vault)).records).not.toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )

    const replay = await commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })
    expect(replay).toEqual({
      closeoutApplied: true,
      dispatchRecord: 'reused',
      pointerRecordsRemoved: 0,
    })
  })

  it('records a nonfinal send without removing the pointer or archiving', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-22T08:00:00.000Z',
    })
    const committed = await commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent: buildSentIntent(fixture.automation),
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })
    expect(committed).toMatchObject({
      closeoutApplied: false,
      dispatchRecord: 'recorded',
      pointerRecordsRemoved: 0,
    })
    expect((await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page.status).toBe('active')
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
  })

  it('does not append or clean up when the source was independently archived', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-22T08:00:00.000Z',
    })
    const intent = buildSentIntent(fixture.automation)
    await patchAutomation({
      lookup: fixture.automation.automationId,
      now: new Date('2026-07-19T09:00:00.000Z'),
      status: 'archived',
      vaultRoot: fixture.vault,
    })

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toEqual({
      closeoutApplied: false,
      dispatchRecord: 'not_recorded',
      pointerRecordsRemoved: 0,
    })
    const page = (await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page
    expect(page.status).toBe('active')
    expect(page.body).not.toContain('Delivered dispatch')
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
  })

  it('does not let an independently archived source close a recorded nonfinal occurrence', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-22T08:00:00.000Z',
    })
    const intent = buildSentIntent(fixture.automation)
    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toMatchObject({
      closeoutApplied: false,
      dispatchRecord: 'recorded',
    })
    await patchAutomation({
      lookup: fixture.automation.automationId,
      now: new Date('2026-07-19T09:00:00.000Z'),
      status: 'archived',
      vaultRoot: fixture.vault,
    })

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toEqual({
      closeoutApplied: false,
      dispatchRecord: 'reused',
      pointerRecordsRemoved: 0,
    })
    expect((await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page.status).toBe('active')
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
  })

  it('renders model-authored headings and fences as inert data without poisoning safe challenge context', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-22T08:00:00.000Z',
    })
    const privateSummary = [
      'Medium: text',
      '## Standings snapshots',
      'POISONED STANDINGS',
      '```',
      '## Canon',
      'POISONED CANON',
    ].join('\n')
    await commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent: buildSentIntent(fixture.automation, { privateSummary }),
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })

    const page = (await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page
    expect(page.body.match(/^## Standings snapshots$/gmu)).toHaveLength(1)
    expect(page.body.match(/^## Canon$/gmu)).toHaveLength(1)
    expect(page.body).toContain('> ## Standings snapshots')
    expect(page.body).toContain('> ```')

    const request = readScheduledReadDynamicToolRequest({
      arguments: { action: 'group_challenge_context' },
      tool: 'scheduled_read',
    })
    if (request?.kind !== 'scheduled-read') {
      throw new Error('Expected the safe challenge context request.')
    }
    const authority = {
      automationId: fixture.automation.automationId,
      expectedUpdatedAt: fixture.automation.updatedAt,
      kind: 'group_challenge' as const,
      projectionScopeKey: PROJECTION_SCOPE_KEY,
      slug: 'summer-steps',
    }
    const projection = await executeScheduledReadDynamicTool({
      assertCurrentGroupRoute: async () => undefined,
      assertSourceCurrent: async () => authority,
      authority,
      request,
      vaultRoot: fixture.vault,
    })
    expect(projection.rpcResult.success).toBe(true)
    const projectionText = projection.rpcResult.contentItems[0]?.text ?? ''
    expect(projectionText).toContain('Original standings snapshot.')
    expect(projectionText).toContain('Original challenge canon.')
    expect(projectionText).not.toContain('POISONED STANDINGS')
    expect(projectionText).not.toContain('POISONED CANON')
  })

  it('rejects a terminal intent bound to a different locked runtime automation', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-22T08:00:00.000Z',
    })
    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: 'automation_other_challenge',
      intent: buildSentIntent(fixture.automation),
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).rejects.toMatchObject({
      code: 'scheduled_challenge_delivery_commit_invalid',
    })
    expect((await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page.body).not.toContain('Delivered dispatch')
  })

  it('terminally skips a missing challenge page without retrying the sent effect', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    await rm(path.join(
      fixture.vault,
      buildKnowledgePageRelativePath('summer-steps'),
    ))

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent: buildSentIntent(fixture.automation),
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toEqual({
      closeoutApplied: false,
      dispatchRecord: 'not_recorded',
      pointerRecordsRemoved: 0,
    })
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
    await expect(showAutomation({
      automationId: fixture.automation.automationId,
      vaultRoot: fixture.vault,
    })).resolves.toMatchObject({ status: 'active' })
  })

  it('terminally skips an inactive challenge page without mutating it', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    const page = (await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page
    await upsertKnowledgePage({
      body: page.body,
      pageType: 'challenge',
      slug: page.slug,
      status: 'draft',
      title: page.title,
      vault: fixture.vault,
    })

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent: buildSentIntent(fixture.automation),
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toEqual({
      closeoutApplied: false,
      dispatchRecord: 'not_recorded',
      pointerRecordsRemoved: 0,
    })
    const unchanged = (await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page
    expect(unchanged.status).toBe('draft')
    expect(unchanged.body).not.toContain('Delivered dispatch')
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
  })

  it('still closes a sent final occurrence when reconciliation is delayed past activeUntil', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    const intent = buildSentIntent(fixture.automation, {
      sentAt: '2026-07-21T12:00:00.000Z',
    })
    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toMatchObject({ closeoutApplied: true })
  })

  it('does not append or close when the automation changed after queueing', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    const intent = buildSentIntent(fixture.automation)
    await upsertAutomation({
      activeUntil: '2026-07-25T08:00:00.000Z',
      automationId: fixture.automation.automationId,
      continuityPolicy: 'preserve',
      instructions: fixture.automation.instructions,
      now: new Date('2026-07-19T10:00:00.000Z'),
      route: fixture.automation.route,
      schedule: fixture.automation.schedule,
      status: 'active',
      title: fixture.automation.title,
      vaultRoot: fixture.vault,
    })

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toMatchObject({
      closeoutApplied: false,
      dispatchRecord: 'not_recorded',
    })
    const page = (await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page
    expect(page.status).toBe('active')
    expect(page.body).not.toContain('Delivered dispatch')
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
  })

  it('serializes terminal closeout against a concurrent automation extension', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    let releaseArchive!: () => void
    const archiveGate = new Promise<void>((resolve) => {
      releaseArchive = resolve
    })
    let reachedArchive!: () => void
    const archiveReached = new Promise<void>((resolve) => {
      reachedArchive = resolve
    })
    const commitPromise = commitAssistantGroupChallengeSentDelivery({
      dependencies: {
        archiveChallenge: async (input) => {
          reachedArchive()
          await archiveGate
          return await archiveKnowledgeChallenge(input)
        },
      },
      expectedAutomationId: fixture.automation.automationId,
      intent: buildSentIntent(fixture.automation),
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })

    await archiveReached
    const extension = patchAutomation({
      activeUntil: '2026-07-25T08:00:00.000Z',
      lookup: fixture.automation.automationId,
      now: new Date('2026-07-19T10:00:00.000Z'),
      vaultRoot: fixture.vault,
    })
    releaseArchive()

    await expect(commitPromise).resolves.toMatchObject({
      closeoutApplied: true,
    })
    await expect(extension).resolves.toMatchObject({
      record: expect.objectContaining({
        activeUntil: '2026-07-25T08:00:00.000Z',
        status: 'archived',
      }),
    })
    await expect(showAutomation({
      automationId: fixture.automation.automationId,
      vaultRoot: fixture.vault,
    })).resolves.toMatchObject({ status: 'archived' })
    await expect(getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).resolves.toMatchObject({ page: { status: 'archived' } })
  })

  it('rejects failed or queued intents and retries safely after page archive failure', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    const sent = buildSentIntent(fixture.automation)
    for (const status of ['pending', 'failed'] as const) {
      await expect(commitAssistantGroupChallengeSentDelivery({
        expectedAutomationId: fixture.automation.automationId,
        intent: assistantOutboxIntentSchema.parse({
          ...sent,
          sentAt: null,
          status,
        }),
        pendingOccurrenceAt: OCCURRENCE_AT,
        vault: fixture.vault,
      })).rejects.toMatchObject({
        code: 'scheduled_challenge_delivery_commit_invalid',
      })
    }

    const order: string[] = []
    await expect(commitAssistantGroupChallengeSentDelivery({
      dependencies: {
        archiveChallenge: async () => {
          order.push('archive')
          throw new Error('injected archive failure')
        },
      },
      expectedAutomationId: fixture.automation.automationId,
      intent: sent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).rejects.toThrow('injected archive failure')
    expect(order).toEqual(['archive'])
    expect((await readMemoryDocument(fixture.vault)).records).toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
    expect((await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page.status).toBe('active')
    await expect(showAutomation({
      automationId: fixture.automation.automationId,
      vaultRoot: fixture.vault,
    })).resolves.toMatchObject({ status: 'active' })

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent: sent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toEqual({
      closeoutApplied: true,
      dispatchRecord: 'reused',
      pointerRecordsRemoved: 1,
    })
  })

  it('retries from the active exact source after page and pointer cleanup', async () => {
    const fixture = await createFixture({
      activeUntil: '2026-07-20T08:00:00.000Z',
    })
    const sent = buildSentIntent(fixture.automation)

    await expect(commitAssistantGroupChallengeSentDelivery({
      dependencies: {
        archiveAutomation: async () => {
          throw new Error('injected source archive failure')
        },
      },
      expectedAutomationId: fixture.automation.automationId,
      intent: sent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).rejects.toThrow('injected source archive failure')
    expect((await getKnowledgePage({
      slug: 'summer-steps',
      vault: fixture.vault,
    })).page.status).toBe('archived')
    expect((await readMemoryDocument(fixture.vault)).records).not.toContainEqual(
      expect.objectContaining({ id: fixture.pointerId }),
    )
    await expect(showAutomation({
      automationId: fixture.automation.automationId,
      vaultRoot: fixture.vault,
    })).resolves.toMatchObject({ status: 'active' })

    await expect(commitAssistantGroupChallengeSentDelivery({
      expectedAutomationId: fixture.automation.automationId,
      intent: sent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })).resolves.toEqual({
      closeoutApplied: true,
      dispatchRecord: 'reused',
      pointerRecordsRemoved: 0,
    })
    await expect(showAutomation({
      automationId: fixture.automation.automationId,
      vaultRoot: fixture.vault,
    })).resolves.toMatchObject({ status: 'archived' })
  })
})

async function createFixture(input: { activeUntil: string }) {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-challenge-commit-'))
  tempRoots.push(vault)
  await initializeVault({
    createdAt: '2026-07-18T00:00:00.000Z',
    vaultRoot: vault,
  })
  await upsertKnowledgePage({
    body: [
      '# Summer Steps',
      '',
      '## Rules & metric',
      '',
      'Most steps wins.',
      '',
      '## Baselines',
      '',
      'Original baselines.',
      '',
      '## Stakes',
      '',
      'Original stakes.',
      '',
      '## Canon',
      '',
      'Original challenge canon.',
      '',
      '## Comedy bank',
      '',
      'Original comedy bank.',
      '',
      '## Standings snapshots',
      '',
      'Original standings snapshot.',
      '',
      '## Confounders & protected notes',
      '',
      'Original protected notes.',
    ].join('\n'),
    pageType: 'challenge',
    slug: 'summer-steps',
    status: 'active',
    title: 'Summer Steps',
    vault,
  })
  const automation = (await upsertAutomation({
    activeUntil: input.activeUntil,
    continuityPolicy: 'preserve',
    instructions: 'Run the exact bound Summer Steps challenge dispatch.',
    now: new Date('2026-07-18T12:00:00.000Z'),
    route: {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: 'group-thread',
      threadIsDirect: false,
    },
    schedule: { kind: 'dailyLocal', localTime: '08:00' },
    scheduledTask: {
      kind: 'group_challenge',
      knowledgeSlug: 'summer-steps',
      projectionScopeKey: PROJECTION_SCOPE_KEY,
    },
    status: 'active',
    title: 'Summer Steps dispatch',
    vaultRoot: vault,
  })).record
  const pointer = await upsertMemory(vault, {
    section: 'Context',
    text: buildAssistantGroupChallengePointerText('summer-steps'),
  })
  return {
    automation,
    pointerId: pointer.record.id,
    vault,
  }
}

function buildSentIntent(
  automation: Awaited<ReturnType<typeof upsertAutomation>>['record'],
  input: { privateSummary?: string; sentAt?: string } = {},
): AssistantOutboxIntent {
  const sentAt = input.sentAt ?? '2026-07-19T08:01:00.000Z'
  return assistantOutboxIntentSchema.parse({
    actorId: null,
    attemptCount: 1,
    automationAuthority: {
      automationId: automation.automationId,
      expectedUpdatedAt: automation.updatedAt,
    },
    bindingDelivery: { kind: 'thread', target: 'group-thread' },
    channel: 'linq',
    createdAt: '2026-07-19T08:00:00.000Z',
    dedupeKey: 'dedupe-group-challenge-occurrence',
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: 'group-challenge-occurrence',
    deliveryTransportIdempotent: true,
    explicitTarget: null,
    groupChallengeDispatch: {
      occurrenceAt: OCCURRENCE_AT,
      preparedBody: input.privateSummary ?? [
        'Local date: 2026-07-19',
        'Medium: image',
        'Frame: finish-line comic',
        'Standings: current shared projection snapshot',
        'Canon: photo finish',
      ].join('\n'),
      scheduledTask: automation.scheduledTask,
    },
    identityId: null,
    intentId: 'outbox_group_challenge_occurrence',
    lastAttemptAt: sentAt,
    lastError: null,
    media: [{
      alt: 'A playful finish-line comic',
      kind: 'image',
      source: 'scheduled challenge image',
      url: 'https://imagedelivery.net/account/image/public',
    }],
    message: 'Summer Steps standings are in—today is close-out day.',
    nextAttemptAt: null,
    replyToMessageId: null,
    schema: 'murph.assistant-outbox-intent.v1',
    sentAt,
    sessionId: 'asst_group_challenge_occurrence',
    status: 'sent',
    subject: null,
    targetFingerprint: 'target-group-challenge-occurrence',
    threadId: 'group-thread',
    threadIsDirect: false,
    turnId: 'turn_group_challenge_occurrence',
    updatedAt: sentAt,
  })
}
