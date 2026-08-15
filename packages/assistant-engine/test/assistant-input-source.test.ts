import { readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AssistantInputCursor,
  type AssistantInputEventRecord,
  resolveAssistantInputEventPath,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import {
  recordHostedMailboxAssistantInputItem,
  readHostedMailboxAssistantInputItemDetails,
} from '../src/assistant/hosted-mailbox-input-items.ts'
import {
  createStoreBackedAssistantInputSource,
} from '../src/assistant/input-source.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('store-backed assistant input source', () => {
  it('lists stored input events as assistant-input accepted candidates', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-store-',
    )
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          attachmentDescriptors: [
            {
              attachmentId: 'att_1',
              contentType: 'audio/mp4',
              fileName: 'voice-note.m4a',
              kind: 'audio',
              sizeBytes: 1234,
            },
          ],
          text: 'stored input text',
          userMessageContent: [
            {
              text: 'stored input text',
              type: 'text',
            },
          ],
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'telegram',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: '2026-04-22T10:00:01.000Z',
        sourceMetadata: {
          kind: 'telegram',
          mediaGroupId: 'media_group_1',
          replyContext: 'Replying to: earlier message',
        },
        sourceRef: createHostedMailboxSourceRef({
          eventId: 'evt_store_source',
          laneSeq: '42',
        }),
      },
    })
    await recordHostedMailboxAssistantInputItem({
      inputId: stored.inputId,
      mailboxItemId: 'raw_mailbox_item_store',
      usageRunningLow: true,
      vault: vaultRoot,
    })
    await updateAssistantInputAttachmentEvidence({
      inputId: stored.inputId,
      vault: vaultRoot,
      attachmentEvidence: {
        attachments: [
          {
            byteSize: 1234,
            descriptorAttachmentId: 'att_1',
            derived: null,
            fileName: 'voice-note.m4a',
            inlineFragments: [],
            kind: 'audio',
            mime: 'audio/mp4',
            ordinal: 1,
            parseState: 'unsupported',
            raw: {
              byteSize: 1234,
              kind: 'vault-relative-file',
              mediaType: 'audio/mp4',
              path: 'raw/inbox/cap_1/attachments/voice-note.m4a',
              sha256: null,
            },
            sourceAttachmentId: 'att_source_1',
          },
        ],
        optionalInboxCaptureId: 'cap_1',
        reasonCode: null,
        source: 'local-inbox-import',
        status: 'available',
        updatedAt: null,
      },
    })
    const source = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })

    const result = await source.listInputCandidates({})

    expect(Object.hasOwn(stored, 'hostedMailboxItemId')).toBe(false)
    expect(result.inputs).toHaveLength(1)
    expect(result.inputs[0]).toMatchObject({
      acceptedInput: {
        acceptedAt: '2026-04-22T10:00:01.000Z',
        id: stored.inputId,
        source: 'assistant-input',
        captureIds: [],
        contentRef: {
          kind: 'assistant-input-event',
          refId: stored.inputId,
          version: 'murph.assistant-input-event.v1',
        },
      },
      event: {
        attachmentCount: 1,
        attachmentEvidence: {
          optionalInboxCaptureId: 'cap_1',
          source: 'local-inbox-import',
          status: 'available',
        },
        attachmentDescriptors: [
          {
            attachmentId: 'att_1',
            contentType: 'audio/mp4',
            fileName: 'voice-note.m4a',
            kind: 'audio',
            sizeBytes: 1234,
          },
        ],
        hostedMailboxItemId: 'raw_mailbox_item_store',
        inputId: stored.inputId,
        source: 'telegram',
        sourceMetadata: {
          kind: 'telegram',
          mediaGroupId: 'media_group_1',
          replyContext: 'Replying to: earlier message',
        },
        text: 'stored input text',
        transcriptText: 'stored input text',
        usageRunningLow: true,
      },
      projection: {
        captureId: null,
        reasonCode: null,
        status: 'not_attempted',
      },
    })
    expect(result.nextCursor).toEqual(stored.cursor)
    expect(result.inputs[0]?.event.groupParticipantAdded).toBeUndefined()
    expect(await readHostedMailboxAssistantInputItemDetails({
      inputIds: [stored.inputId],
      vault: vaultRoot,
    })).toEqual(new Map([
      [stored.inputId, {
        inputId: stored.inputId,
        mailboxItemId: 'raw_mailbox_item_store',
        usageRunningLow: true,
      }],
    ]))
  })

  it('uses occurredAt only when a legacy stored event has no receipt timestamp', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-legacy-reference-',
    )
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'legacy input text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: null,
        sourceRef: {
          captureId: 'cap_legacy_reference',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      },
    })

    const result = await createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    }).listInputCandidates({})

    expect(result.inputs[0]?.acceptedInput).toMatchObject({
      acceptedAt: stored.occurredAt,
      id: stored.inputId,
      source: 'assistant-input',
    })
  })

  it('projects literal group context from the sidecar without persisting it in the input event', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-participant-context-',
    )
    const groupReactionContext = [
      'Participant +15551110000 added a like reaction on: first message',
      'Participant +15552220000 added a laugh reaction on: second message',
    ].join('\n')
    const storedInput = createStoredHostedMailboxInput({
      eventId: 'evt_participant_context',
      laneSeq: '43',
      threadId: 'chat_group',
    })
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        ...storedInput,
        conversation: {
          ...storedInput.conversation,
          threadIsDirect: false,
        },
        sourceMetadata: {
          externalThreadRouteAuthorityPresent: true,
          kind: 'linq',
          partCount: 1,
          reactionEligible: true,
          replyToMessageId: null,
          service: 'iMessage',
        },
      },
    })
    await recordHostedMailboxAssistantInputItem({
      groupParticipantAdded: true,
      groupReactionContext,
      inputId: stored.inputId,
      mailboxItemId: 'raw_mailbox_item_participant_context',
      vault: vaultRoot,
    })

    const source = createStoreBackedAssistantInputSource({ vault: vaultRoot })
    const result = await source.listInputCandidates({})

    expect(result.inputs[0]?.event.groupParticipantAdded).toBe(true)
    expect(result.inputs[0]?.event.groupReactionContext).toBe(
      groupReactionContext,
    )
    expect(
      Object.hasOwn(
        result.inputs[0]?.event.sourceMetadata ?? {},
        'groupReactionContext',
      ),
    ).toBe(false)
    expect(await readHostedMailboxAssistantInputItemDetails({
      inputIds: [stored.inputId],
      vault: vaultRoot,
    })).toEqual(new Map([
      [stored.inputId, {
        groupParticipantAdded: true,
        groupReactionContext,
        inputId: stored.inputId,
        mailboxItemId: 'raw_mailbox_item_participant_context',
      }],
    ]))
    const storedEventFile = await readFile(
      resolveAssistantInputEventPath({
        inputId: stored.inputId,
        paths: resolveAssistantStatePaths(vaultRoot),
      }),
      'utf8',
    )
    expect(storedEventFile).not.toContain('groupParticipantAdded')
    expect(storedEventFile).not.toContain('groupReactionContext')
    expect(storedEventFile).not.toContain(
      groupReactionContext,
    )
  })

  it('filters stored input events by conversation and known input id', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-store-filter-',
    )
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_first',
        laneSeq: '1',
        threadId: 'chat_1',
      }),
    })
    const known = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_known',
        laneSeq: '2',
        threadId: 'chat_1',
      }),
    })
    await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_other',
        laneSeq: '3',
        threadId: 'chat_other',
      }),
    })
    await updateAssistantInputProjection({
      inputId: first.inputId,
      vault: vaultRoot,
      projection: {
        captureId: 'cap_projected',
        status: 'succeeded',
      },
    })
    const source = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })

    const result = await source.listNewConversationInputs({
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'chat_1',
        threadIsDirect: true,
      },
      knownInputIds: [known.inputId],
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      first.inputId,
    ])
    expect(result.inputs[0]?.acceptedInput).toMatchObject({
      captureIds: ['cap_projected'],
      contentRef: {
        kind: 'assistant-input-event',
        refId: first.inputId,
      },
      source: 'assistant-input',
    })
  })

  it('pages past known projected events to find later conversation input', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-store-known-page-',
    )
    const knownProjectionCaptureIds: string[] = []
    for (let index = 1; index <= 100; index += 1) {
      const stored = await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createStoredHostedMailboxInput({
          eventId: `evt_known_${index}`,
          laneSeq: String(index),
          threadId: 'chat_1',
        }),
      })
      const captureId = `cap_known_${index}`
      knownProjectionCaptureIds.push(captureId)
      await updateAssistantInputProjection({
        inputId: stored.inputId,
        vault: vaultRoot,
        projection: {
          captureId,
          status: 'succeeded',
        },
      })
    }
    const eligible = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_eligible_after_known_page',
        laneSeq: '101',
        threadId: 'chat_1',
      }),
    })
    const source = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })

    const result = await source.listNewConversationInputs({
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'chat_1',
        threadIsDirect: true,
      },
      knownProjectionCaptureIds,
      limit: 1,
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      eligible.inputId,
    ])
    expect(result.nextCursor).toEqual(eligible.cursor)
  })

  it('terminates mixed createdAt pagination after crossing the scan boundary', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-mixed-created-at-scan-',
    )
    const knownInputIds: string[] = []
    for (let index = 0; index < 100; index += 1) {
      const occurredAt = new Date(Date.UTC(2026, 3, 22, 9, 0, index))
        .toISOString()
      const stored = await upsertAssistantInputEvent({
        vault: vaultRoot,
        now: new Date(occurredAt),
        event: createStoredInboxInput({
          captureId: `scan_known_${String(index).padStart(3, '0')}`,
          occurredAt,
          text: `known scan input ${index}`,
          threadId: 'chat_1',
        }),
      })
      knownInputIds.push(stored.inputId)
    }
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:02.000Z'),
      event: createStoredInboxInput({
        captureId: 'scan_mixed_a',
        occurredAt: '2026-04-22T10:00:03.000Z',
        text: 'A created at 02 occurred at 03',
        threadId: 'chat_1',
      }),
    })
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:03.000Z'),
      event: createStoredInboxInput({
        captureId: 'scan_mixed_b',
        occurredAt: '2026-04-22T10:00:01.000Z',
        text: 'B created at 03 occurred at 01',
        threadId: 'chat_1',
      }),
    })
    const third = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:04.000Z'),
      event: createStoredInboxInput({
        captureId: 'scan_mixed_l',
        occurredAt: '2026-04-22T10:00:02.000Z',
        text: 'L legacy cursor occurred at 02',
        threadId: 'chat_1',
      }),
    })
    await writeAssistantInputEventRecord(vaultRoot, {
      ...third,
      cursor: {
        ...third.cursor,
        createdAt: null,
      },
    })
    const source = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })

    const orderedInputIds: string[] = []
    let afterCursor: AssistantInputCursor | null = null
    for (let pageCount = 0; pageCount < 5; pageCount += 1) {
      const page = await source.listInputCandidates({
        afterCursor,
        knownInputIds,
        limit: 1,
      })
      if (page.inputs.length === 0) {
        afterCursor = page.nextCursor
        break
      }
      orderedInputIds.push(page.inputs[0]!.event.inputId)
      afterCursor = page.nextCursor
    }

    expect(new Set(orderedInputIds).size).toBe(orderedInputIds.length)
    expect(orderedInputIds).toEqual([
      first.inputId,
      third.inputId,
      second.inputId,
    ])

    const finalPage = await source.listInputCandidates({
      afterCursor,
      knownInputIds,
      limit: 1,
    })
    expect(finalPage.inputs).toEqual([])
  })

  it('returns rapid staged conversation inputs after a cursor in one batch', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-store-rapid-',
    )
    const before = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_before_rapid',
        laneSeq: '40',
        threadId: 'chat_rapid',
      }),
    })
    const rapidInputs = []
    for (const laneSeq of ['41', '42', '43', '44', '45']) {
      rapidInputs.push(await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createStoredHostedMailboxInput({
          eventId: `evt_rapid_${laneSeq}`,
          laneSeq,
          threadId: 'chat_rapid',
        }),
      }))
    }
    await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_other_thread',
        laneSeq: '46',
        threadId: 'chat_other',
      }),
    })
    const source = createStoreBackedAssistantInputSource({
      vault: vaultRoot,
    })

    const result = await source.listNewConversationInputs({
      afterCursor: before.cursor,
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'chat_rapid',
        threadIsDirect: true,
      },
      limit: 10,
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual(
      rapidInputs.map((input) => input.inputId),
    )
    expect(result.nextCursor).toEqual(rapidInputs[rapidInputs.length - 1]!.cursor)
    expect(result.inputs.every(
      (candidate) =>
        candidate.acceptedInput.contentRef?.kind === 'assistant-input-event',
    )).toBe(true)
  })
})

async function createAssistantInputSourceVault(prefix: string): Promise<{
  parentRoot: string
  vaultRoot: string
}> {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

function createStoredHostedMailboxInput(input: {
  eventId: string
  laneSeq: string
  threadId: string
}) {
  const occurredAt = new Date(
    Date.UTC(2026, 3, 22, 10, 0, Number(input.laneSeq)),
  ).toISOString()
  return {
    content: {
      text: `${input.eventId} text`,
    },
    conversation: {
      accountId: 'acct_1',
      actorId: 'actor_1',
      actorIsSelf: false,
      source: 'linq',
      threadId: input.threadId,
      threadIsDirect: true,
    },
    occurredAt,
    receivedAt: occurredAt,
    sourceRef: createHostedMailboxSourceRef({
      eventId: input.eventId,
      laneSeq: input.laneSeq,
    }),
  }
}

function createStoredInboxInput(input: {
  captureId: string
  occurredAt: string
  text: string
  threadId: string
}) {
  return {
    content: {
      text: input.text,
    },
    conversation: {
      accountId: 'acct_1',
      actorId: 'actor_1',
      actorIsSelf: false,
      source: 'linq',
      threadId: input.threadId,
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.occurredAt,
    sourceRef: {
      captureId: input.captureId,
      kind: 'inbox-capture' as const,
      source: 'linq',
      version: null,
    },
  }
}

async function writeAssistantInputEventRecord(
  vaultRoot: string,
  record: AssistantInputEventRecord,
): Promise<void> {
  const paths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    resolveAssistantInputEventPath({
      inputId: record.inputId,
      paths,
    }),
    `${JSON.stringify({
      schema: 'murph.assistant-input-event.v1',
      schemaVersion: 1,
      value: record,
    })}\n`,
    { mode: 0o600 },
  )
}

function createHostedMailboxSourceRef(input: {
  eventId: string
  itemId?: string
  laneSeq: string
}) {
  return {
    dedupeKey: `${input.eventId}_dedupe`,
    eventId: input.eventId,
    itemId: input.itemId ?? `${input.eventId}_item`,
    kind: 'hosted-mailbox' as const,
    lane: 'conversation' as const,
    laneSeq: input.laneSeq,
    payloadSchema: 'murph.hosted-payload.v1',
    payloadSource: 'sidecar' as const,
    source: 'hosted-mailbox' as const,
    wakeSchema: 'murph.hosted-wake.v1',
  }
}
