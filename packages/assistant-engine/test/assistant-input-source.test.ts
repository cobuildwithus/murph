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
      }],
    ]))
  })

  it('projects literal participant context from the sidecar without persisting it in the input event', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-participant-context-',
    )
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
      inputId: stored.inputId,
      mailboxItemId: 'raw_mailbox_item_participant_context',
      vault: vaultRoot,
    })

    const source = createStoreBackedAssistantInputSource({ vault: vaultRoot })
    const result = await source.listInputCandidates({})

    expect(result.inputs[0]?.event.groupParticipantAdded).toBe(true)
    expect(await readHostedMailboxAssistantInputItemDetails({
      inputIds: [stored.inputId],
      vault: vaultRoot,
    })).toEqual(new Map([
      [stored.inputId, {
        groupParticipantAdded: true,
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

  it('filters a delivery route before the fixed candidate budget', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-route-budget-',
    )
    for (let index = 1; index <= 101; index += 1) {
      await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createStoredHostedMailboxInput({
          eventId: `evt_unrelated_route_${index}`,
          laneSeq: String(index),
          replyTarget: {
            channel: 'linq',
            messageId: `message_unrelated_${index}`,
            threadId: `provider_unrelated_${index}`,
          },
          threadId: `hidden_unrelated_${index}`,
        }),
      })
    }
    await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        accountId: 'acct_wrong',
        eventId: 'evt_wrong_account_same_target',
        laneSeq: '102',
        replyTarget: {
          channel: 'linq',
          messageId: 'message_wrong_account',
          threadId: 'provider_matching',
        },
        threadId: 'hidden_matching',
      }),
    })
    const matching = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        eventId: 'evt_matching_route',
        laneSeq: '103',
        replyTarget: {
          channel: 'linq',
          messageId: 'message_matching',
          threadId: 'provider_matching',
        },
        threadId: 'hidden_matching',
      }),
    })
    const source = createStoreBackedAssistantInputSource({ vault: vaultRoot })

    const result = await source.listInputCandidates({
      actionableLimit: 1,
      deliveryRoute: {
        channel: 'linq',
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'hidden_initial',
          threadIsDirect: true,
        },
        target: 'provider_matching',
      },
      limit: 2,
      sourceId: 'linq',
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      matching.inputId,
    ])
    expect(result.nextCursor).toEqual(matching.cursor)

    const abortController = new AbortController()
    const abortReason = new Error('stop bounded route discovery')
    abortController.abort(abortReason)
    await expect(source.listInputCandidates({
      deliveryRoute: {
        channel: 'linq',
        conversation: result.inputs[0]!.event.conversation!,
        target: 'provider_matching',
      },
      signal: abortController.signal,
    })).rejects.toBe(abortReason)
  })

  it('retains only causal newest deferred context within route and global bounds', async () => {
    const { vaultRoot } = await createAssistantInputSourceVault(
      'assistant-input-source-context-bounds-',
    )
    const baseOccurredAt = Date.parse('2026-04-22T10:00:00.000Z')
    let laneSequence = 1
    const nextLaneSeq = () => String(laneSequence++).padStart(4, '0')
    const contextsByGroup: AssistantInputEventRecord[][] = []

    for (let groupIndex = 0; groupIndex < 9; groupIndex += 1) {
      const groupContexts: AssistantInputEventRecord[] = []
      const contextCount = groupIndex === 0 ? 33 : groupIndex === 8 ? 28 : 29
      for (let contextIndex = 0; contextIndex < contextCount; contextIndex += 1) {
        groupContexts.push(await upsertAssistantInputEvent({
          vault: vaultRoot,
          event: createStoredHostedMailboxInput({
            actorId: `actor_context_${groupIndex}_${contextIndex}`,
            contextOnly: true,
            eventId: `evt_context_${groupIndex}_${contextIndex}`,
            laneSeq: nextLaneSeq(),
            occurredAt: new Date(
              baseOccurredAt + ((groupIndex * 100) + contextIndex) * 1_000,
            ).toISOString(),
            replyTarget: null,
            threadId: `hidden_group_${groupIndex}`,
            threadIsDirect: false,
          }),
        }))
      }
      contextsByGroup.push(groupContexts)
    }

    const actionables: AssistantInputEventRecord[] = []
    for (let groupIndex = 0; groupIndex < 9; groupIndex += 1) {
      actionables.push(await upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createStoredHostedMailboxInput({
          actorId: `actor_actionable_${groupIndex}`,
          eventId: `evt_actionable_${groupIndex}`,
          laneSeq: nextLaneSeq(),
          occurredAt: new Date(
            baseOccurredAt + ((groupIndex * 100) + 90) * 1_000,
          ).toISOString(),
          replyTarget: {
            channel: 'linq',
            messageId: `message_actionable_${groupIndex}`,
            threadId: `provider_group_${groupIndex}`,
          },
          threadId: `hidden_group_${groupIndex}`,
          threadIsDirect: false,
        }),
      }))
    }

    const lateCursorCausalContext = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        actorId: 'actor_context_8_late_cursor',
        contextOnly: true,
        eventId: 'evt_context_8_late_cursor',
        laneSeq: nextLaneSeq(),
        occurredAt: new Date(baseOccurredAt + 828_000).toISOString(),
        replyTarget: null,
        threadId: 'hidden_group_8',
        threadIsDirect: false,
      }),
    })
    contextsByGroup[8]!.push(lateCursorCausalContext)
    const nonCausalContext = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createStoredHostedMailboxInput({
        actorId: 'actor_context_0_too_late',
        contextOnly: true,
        eventId: 'evt_context_0_too_late',
        laneSeq: nextLaneSeq(),
        occurredAt: new Date(baseOccurredAt + 10_000_000).toISOString(),
        replyTarget: null,
        threadId: 'hidden_group_0',
        threadIsDirect: false,
      }),
    })
    const source = createStoreBackedAssistantInputSource({ vault: vaultRoot })

    const routeResult = await source.listInputCandidates({
      actionableLimit: 1,
      deliveryRoute: {
        channel: 'linq',
        conversation: actionables[0]!.conversation!,
        target: 'provider_group_0',
      },
      limit: 100,
      sourceId: 'linq',
    })
    expect(routeResult.inputs
      .filter((candidate) => candidate.event.sourceMetadata?.kind === 'linq'
        && candidate.event.sourceMetadata.contextOnly === true)
      .map((candidate) => candidate.event.inputId)).toEqual(
        contextsByGroup[0]!.slice(-32).map((context) => context.inputId),
      )
    expect(routeResult.inputs.at(-1)?.event.inputId).toBe(actionables[0]!.inputId)

    const globalResult = await source.listInputCandidates({
      actionableLimit: actionables.length,
      limit: 400,
      sourceId: 'linq',
    })
    const globalContextIds = globalResult.inputs
      .filter((candidate) => candidate.event.sourceMetadata?.kind === 'linq'
        && candidate.event.sourceMetadata.contextOnly === true)
      .map((candidate) => candidate.event.inputId)
    expect(globalContextIds).toEqual([
      ...contextsByGroup[0]!.slice(9).map((context) => context.inputId),
      ...contextsByGroup.slice(1).flat().map((context) => context.inputId),
    ])
    expect(globalContextIds).toHaveLength(256)
    expect(globalContextIds).toContain(lateCursorCausalContext.inputId)
    expect(globalContextIds).not.toContain(nonCausalContext.inputId)
    expect(globalResult.inputs.map((candidate) => candidate.event.inputId))
      .toEqual(expect.arrayContaining(
        actionables.map((actionable) => actionable.inputId),
      ))
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
  accountId?: string
  actorId?: string
  contextOnly?: boolean
  eventId: string
  laneSeq: string
  occurredAt?: string
  replyTarget?: {
    channel: string
    messageId: string
    threadId: string
  } | null
  threadId: string
  threadIsDirect?: boolean
}) {
  const occurredAt = input.occurredAt ?? new Date(
    Date.UTC(2026, 3, 22, 10, 0, Number(input.laneSeq)),
  ).toISOString()
  return {
    content: {
      text: `${input.eventId} text`,
    },
    conversation: {
      accountId: input.accountId ?? 'acct_1',
      actorId: input.actorId ?? 'actor_1',
      actorIsSelf: false,
      source: 'linq',
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect ?? true,
    },
    occurredAt,
    receivedAt: occurredAt,
    ...(input.replyTarget === undefined ? {} : { replyTarget: input.replyTarget }),
    ...(input.contextOnly
      ? {
          sourceMetadata: {
            contextOnly: true,
            kind: 'linq' as const,
            partCount: 1,
            reactionEligible: false,
            replyToMessageId: null,
            service: null,
          },
        }
      : {}),
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
