import { rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import {
  createAssistantInputEventId,
  listAssistantInputEvents,
  readAssistantInputEvent,
  readLatestAssistantInputCursor,
  resolveAssistantInputEventPath,
  resolveAssistantInputEventsDirectory,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
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

describe('assistant input event store', () => {
  it('creates deterministic ids and treats identical replays as idempotent', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-idempotent-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_1',
      itemId: 'item_1',
      laneSeq: '42',
    })

    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:02.000Z'),
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
          text: 'decoded hosted text',
          transcriptText: 'Linq: decoded hosted text',
          userMessageContent: [
            {
              text: 'decoded hosted text',
              type: 'text',
            },
          ],
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: '2026-04-22T10:00:03.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'msg_1',
          threadId: 'chat_1',
        },
        sourceRef,
      },
    })
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:05:00.000Z'),
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
          text: 'decoded hosted text',
          transcriptText: 'Linq: decoded hosted text',
          userMessageContent: [
            {
              text: 'decoded hosted text',
              type: 'text',
            },
          ],
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: '2026-04-22T10:00:01.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'msg_1',
          threadId: 'chat_1',
        },
        sourceRef,
      },
    })

    expect(first.inputId).toBe(createAssistantInputEventId({ sourceRef }))
    expect(second).toEqual(first)
    await expect(
      readAssistantInputEvent({
        inputId: first.inputId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual(first)

    const inputPath = resolveAssistantInputEventPath({
      inputId: first.inputId,
      paths: resolveAssistantStatePaths(vaultRoot),
    })
    expect((await stat(inputPath)).mode & 0o077).toBe(0)
  })

  it('treats safe descriptor filename additions as compatible with old staged input', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-filename-replay-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_filename_replay',
      itemId: 'item_filename_replay',
      laneSeq: '42',
    })
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          attachmentDescriptors: [
            {
              attachmentId: 'att_1',
              contentType: 'audio/mp4',
              fileName: null,
              kind: 'audio',
              sizeBytes: 1234,
            },
          ],
          text: 'decoded hosted text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef,
      },
    })

    const replay = await upsertAssistantInputEvent({
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
          text: 'decoded hosted text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef,
      },
    })

    expect(replay).toEqual(first)
    expect(replay.content.attachmentDescriptors[0]?.fileName).toBeNull()
  })

  it('uses source-neutral ids for stored inbox source refs', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-inbox-id-',
    )
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'capture projection text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef: {
          captureId: 'cap_1',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      },
    })

    expect(stored.inputId).toBe(
      createAssistantInputEventId({
        sourceRef: {
          captureId: 'cap_1',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      }),
    )
    expect(stored.cursor).toMatchObject({
      inputId: stored.inputId,
      sourceKind: 'inbox-capture',
      sourcePosition: 'inbox-capture:linq:cap_1',
    })
  })

  it('rejects changed immutable content for the same source reference', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-conflict-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_conflict',
      laneSeq: '42',
    })
    await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'original text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef,
      },
    })

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'changed text',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef,
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_INPUT_EVENT_CONFLICT',
    })
  })

  it('rejects changed source metadata for the same source reference', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-source-metadata-conflict-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_source_metadata_conflict',
      laneSeq: '42',
    })
    await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'metadata-sensitive text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceMetadata: {
          kind: 'telegram',
          mediaGroupId: null,
          replyContext: 'replying to earlier photo',
        },
        sourceRef,
      },
    })

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'metadata-sensitive text',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceMetadata: {
            kind: 'telegram',
            mediaGroupId: 'album_1',
            replyContext: 'replying to earlier photo',
          },
          sourceRef,
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_INPUT_EVENT_CONFLICT',
    })
  })

  it('keys hosted mailbox events by dedupe identity, not mailbox row or projection metadata', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-hosted-identity-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_same_mailbox',
      itemId: 'item_same_mailbox',
      laneSeq: '42',
    })
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'same mailbox text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef,
      },
    })

    const duplicateMailboxRow = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'same mailbox text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef: {
          ...sourceRef,
          eventId: 'evt_duplicate_projection',
          itemId: 'item_duplicate_projection',
          laneSeq: '43',
          payloadSchema: 'murph.changed-payload.v1',
          payloadSource: 'inline',
        },
      },
    })

    expect(duplicateMailboxRow).toEqual(stored)
    expect(
      createAssistantInputEventId({
        sourceRef: {
          ...sourceRef,
          eventId: 'evt_duplicate_projection',
          itemId: 'item_duplicate_projection',
          laneSeq: '43',
          payloadSchema: 'murph.changed-payload.v1',
          payloadSource: 'inline',
        },
      }),
    ).toBe(stored.inputId)
    expect(stored.sourceRef).toEqual(sourceRef)
    expect(stored.cursor.sourcePosition).toBe(
      'hosted-mailbox:conversation:000000000000000000000000000000000000042:item_same_mailbox',
    )
  })

  it('keeps hosted mailbox lanes distinct even when dedupe identity matches', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-hosted-lane-identity-',
    )
    const conversationRef = createHostedMailboxSourceRef({
      dedupeKey: 'dedupe_shared',
      eventId: 'evt_lane_shared',
      lane: 'conversation',
      laneSeq: '42',
    })
    const systemRef = createHostedMailboxSourceRef({
      dedupeKey: 'dedupe_shared',
      eventId: 'evt_lane_shared',
      lane: 'system',
      laneSeq: '43',
    })

    const conversation = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'conversation lane text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef: conversationRef,
      },
    })
    const system = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'system lane text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef: systemRef,
      },
    })

    expect(conversation.inputId).not.toBe(system.inputId)
    expect(
      createAssistantInputEventId({
        sourceRef: conversationRef,
      }),
    ).not.toBe(
      createAssistantInputEventId({
        sourceRef: systemRef,
      }),
    )
    expect(conversationRef.lane).toBe('conversation')
    expect(systemRef.lane).toBe('system')
    await expect(
      readAssistantInputEvent({
        inputId: conversation.inputId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual(conversation)
    await expect(
      readAssistantInputEvent({
        inputId: system.inputId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual(system)
  })

  it('falls back to hosted event identity when dedupe identity is absent', async () => {
    const first = createHostedMailboxSourceRef({
      dedupeKey: null,
      eventId: 'evt_no_dedupe',
      itemId: 'item_no_dedupe_a',
      laneSeq: '42',
    })
    const duplicateItem = createHostedMailboxSourceRef({
      dedupeKey: null,
      eventId: 'evt_no_dedupe',
      itemId: 'item_no_dedupe_b',
      laneSeq: '43',
    })
    const differentEvent = createHostedMailboxSourceRef({
      dedupeKey: null,
      eventId: 'evt_no_dedupe_other',
      itemId: 'item_no_dedupe_a',
      laneSeq: '42',
    })

    expect(createAssistantInputEventId({ sourceRef: duplicateItem })).toBe(
      createAssistantInputEventId({ sourceRef: first }),
    )
    expect(createAssistantInputEventId({ sourceRef: differentEvent })).not.toBe(
      createAssistantInputEventId({ sourceRef: first }),
    )
  })

  it('defaults missing source metadata on older assistant input records', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-legacy-source-metadata-',
    )
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_legacy_no_source_metadata',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: '42',
        text: 'legacy metadata text',
        threadId: 'chat_1',
      }),
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const recordWithoutSourceMetadata = Object.fromEntries(
      Object.entries(stored).filter(([key]) => key !== 'sourceMetadata'),
    )
    await writeFile(
      resolveAssistantInputEventPath({
        inputId: stored.inputId,
        paths,
      }),
      `${JSON.stringify({
        schema: 'murph.assistant-input-event.v1',
        schemaVersion: 1,
        value: recordWithoutSourceMetadata,
      })}\n`,
      { mode: 0o600 },
    )

    await expect(
      readAssistantInputEvent({
        inputId: stored.inputId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      ...stored,
      sourceMetadata: null,
    })
  })

  it('rejects stored input records whose id does not match source identity', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-hard-cut-hosted-identity-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_hard_cut_identity',
      itemId: 'item_hard_cut_identity',
      laneSeq: '42',
    })
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'hard cut identity text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef,
      },
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const mismatchedRecord = {
      ...stored,
      cursor: {
        ...stored.cursor,
        inputId: 'ain_00000000000000000000000000000000',
      },
      inputId: 'ain_00000000000000000000000000000000',
    }
    await writeFile(
      resolveAssistantInputEventPath({
        inputId: stored.inputId,
        paths,
      }),
      `${JSON.stringify({
        schema: 'murph.assistant-input-event.v1',
        schemaVersion: 1,
        value: mismatchedRecord,
      })}\n`,
      { mode: 0o600 },
    )

    await expect(
      readAssistantInputEvent({
        inputId: stored.inputId,
        vault: vaultRoot,
      }),
    ).rejects.toThrow('inputId must match its sourceRef')
    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'hard cut identity text',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef,
        },
      }),
    ).rejects.toThrow('inputId must match its sourceRef')
  })

  it('rejects stored input records whose cursor id does not match input id', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-hard-cut-cursor-identity-',
    )
    const sourceRef = createHostedMailboxSourceRef({
      eventId: 'evt_hard_cut_cursor_identity',
      itemId: 'item_hard_cut_cursor_identity',
      laneSeq: '42',
    })
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'hard cut cursor identity text',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef,
      },
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(
      resolveAssistantInputEventPath({
        inputId: stored.inputId,
        paths,
      }),
      `${JSON.stringify({
        schema: 'murph.assistant-input-event.v1',
        schemaVersion: 1,
        value: {
          ...stored,
          cursor: {
            ...stored.cursor,
            inputId: 'ain_00000000000000000000000000000000',
          },
        },
      })}\n`,
      { mode: 0o600 },
    )

    await expect(
      readAssistantInputEvent({
        inputId: stored.inputId,
        vault: vaultRoot,
      }),
    ).rejects.toThrow('cursor inputId must match its inputId')
    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'hard cut cursor identity text',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef,
        },
      }),
    ).rejects.toThrow('cursor inputId must match its inputId')
  })

  it('lists inputs by conversation and leaves projection failures listable', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-list-',
    )
    const matchingFirst = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_first',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:1',
        text: 'first',
        threadId: 'chat_1',
      }),
    })
    const otherConversation = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:20.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_other',
        occurredAt: '2026-04-22T10:01:00.000Z',
        laneSeq: 'conversation:2',
        text: 'other',
        threadId: 'chat_2',
      }),
    })
    const matchingSecond = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:30.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_second',
        occurredAt: '2026-04-22T10:02:00.000Z',
        laneSeq: 'conversation:3',
        text: 'second',
        threadId: 'chat_1',
      }),
    })

    await updateAssistantInputProjection({
      inputId: matchingFirst.inputId,
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:40.000Z'),
      projection: {
        reasonCode: 'conversation_import.capture_persist_failed',
        status: 'failed',
      },
    })

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'chat_1',
        threadIsDirect: true,
      },
    })

    expect(listed.events.map((event) => event.inputId)).toEqual([
      matchingFirst.inputId,
      matchingSecond.inputId,
    ])
    expect(listed.events[0]?.projection).toMatchObject({
      captureId: null,
      reasonCode: 'conversation_import.capture_persist_failed',
      status: 'failed',
    })
    expect(listed.nextCursor).toEqual(matchingSecond.cursor)

    const afterFirst = await listAssistantInputEvents({
      vault: vaultRoot,
      afterCursor: matchingFirst.cursor,
    })
    expect(afterFirst.events.map((event) => event.inputId)).toEqual([
      otherConversation.inputId,
      matchingSecond.inputId,
    ])
  })

  it('records succeeded projection status without changing immutable content', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-projection-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_projection',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:42',
        text: 'projection',
        threadId: 'chat_1',
      }),
    })

    const updated = await updateAssistantInputProjection({
      inputId: input.inputId,
      vault: vaultRoot,
      now: new Date('2026-04-22T10:01:00.000Z'),
      projection: {
        captureId: 'cap_1',
        lastAttemptedAt: '2026-04-22T10:00:59.000Z',
        status: 'succeeded',
      },
    })

    expect(updated.content).toEqual(input.content)
    expect(updated.projection).toEqual({
      captureId: 'cap_1',
      lastAttemptedAt: '2026-04-22T10:00:59.000Z',
      reasonCode: null,
      status: 'succeeded',
      updatedAt: '2026-04-22T10:01:00.000Z',
    })

    const replayed = await updateAssistantInputProjection({
      inputId: input.inputId,
      vault: vaultRoot,
      now: new Date('2026-04-22T10:02:00.000Z'),
      projection: {
        captureId: null,
        lastAttemptedAt: null,
        status: 'succeeded',
      },
    })
    expect(replayed.projection).toEqual({
      captureId: 'cap_1',
      lastAttemptedAt: '2026-04-22T10:00:59.000Z',
      reasonCode: null,
      status: 'succeeded',
      updatedAt: '2026-04-22T10:02:00.000Z',
    })

    await expect(
      updateAssistantInputProjection({
        inputId: input.inputId,
        vault: vaultRoot,
        projection: {
          reasonCode: 'conversation_import.retry',
          status: 'failed',
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_INPUT_PROJECTION_TERMINAL',
    })
  })

  it('rejects legacy projection retry scheduling fields when reading stored input', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-legacy-projection-retry-',
    )
    const event = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_legacy_projection_retry',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:40',
        text: 'legacy projection retry',
        threadId: 'chat_1',
      }),
    })
    const failed = await updateAssistantInputProjection({
      inputId: event.inputId,
      vault: vaultRoot,
      projection: {
        reasonCode: 'conversation_import.capture_persist_failed',
        status: 'failed',
      },
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const inputPath = resolveAssistantInputEventPath({
      inputId: event.inputId,
      paths,
    })

    await expect(
      updateAssistantInputProjection({
        inputId: event.inputId,
        vault: vaultRoot,
        projection: {
          // @ts-expect-error legacy retry scheduling is no longer part of the update contract.
          nextAttemptAfter: '2026-04-22T10:10:00.000Z',
          status: 'pending',
        },
      }),
    ).rejects.toThrow(/nextAttemptAfter/u)

    await writeFile(
      inputPath,
      `${JSON.stringify({
        schema: 'murph.assistant-input-event.v1',
        schemaVersion: 1,
        value: {
          ...failed,
          projection: {
            ...failed.projection,
            nextAttemptAfter: '2026-04-22T10:10:00.000Z',
          },
        },
      })}\n`,
      { mode: 0o600 },
    )

    await expect(
      readAssistantInputEvent({
        inputId: event.inputId,
        vault: vaultRoot,
      }),
    ).rejects.toThrow(/nextAttemptAfter/u)
  })

  it('uses source position to order same-timestamp hosted mailbox inputs', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-source-position-',
    )
    const laneSeqPosition = (laneSeq: string) => laneSeq.padStart(39, '0')
    const laterSourcePosition = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_later_position',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: '2',
        text: 'later position',
        threadId: 'chat_1',
      }),
    })
    const earlierSourcePosition = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:20.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_earlier_position',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: '10',
        text: 'earlier position',
        threadId: 'chat_1',
      }),
    })

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'chat_1',
        threadIsDirect: true,
      },
    })

    expect(listed.events.map((event) => event.inputId)).toEqual([
      laterSourcePosition.inputId,
      earlierSourcePosition.inputId,
    ])
    expect(listed.events.map((event) => event.occurredAt)).toEqual([
      '2026-04-22T10:00:00.000Z',
      '2026-04-22T10:00:00.000Z',
    ])
    expect(listed.events.map((event) => event.cursor.sourcePosition)).toEqual([
      `hosted-mailbox:conversation:${laneSeqPosition('2')}:evt_later_position_item`,
      `hosted-mailbox:conversation:${laneSeqPosition('10')}:evt_earlier_position_item`,
    ])
  })

  it('uses hosted mailbox lane position before timestamps within the same lane', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-hosted-lane-position-',
    )
    const laneSeqPosition = (laneSeq: string) => laneSeq.padStart(39, '0')
    const laneSeqTen = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:01.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_lane_seq_ten',
        occurredAt: '2026-04-22T10:00:01.000Z',
        laneSeq: '10',
        text: 'sequence ten',
        threadId: 'chat_1',
      }),
    })
    const laneSeqTwo = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:20.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_lane_seq_two',
        occurredAt: '2026-04-22T10:00:20.000Z',
        laneSeq: '2',
        text: 'sequence two',
        threadId: 'chat_1',
      }),
    })

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'chat_1',
        threadIsDirect: true,
      },
    })
    const afterLaneSeqTwo = await listAssistantInputEvents({
      afterCursor: laneSeqTwo.cursor,
      vault: vaultRoot,
    })

    expect(listed.events.map((event) => event.inputId)).toEqual([
      laneSeqTwo.inputId,
      laneSeqTen.inputId,
    ])
    expect(listed.events.map((event) => event.cursor.sourcePosition)).toEqual([
      `hosted-mailbox:conversation:${laneSeqPosition('2')}:evt_lane_seq_two_item`,
      `hosted-mailbox:conversation:${laneSeqPosition('10')}:evt_lane_seq_ten_item`,
    ])
    expect(afterLaneSeqTwo.events.map((event) => event.inputId)).toContain(
      laneSeqTen.inputId,
    )
  })

  it('uses source position ordering only within the same hosted mailbox lane', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-cross-lane-cursor-',
    )
    const systemEvent = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_system_first',
        lane: 'system',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: '1',
        text: 'system first',
        threadId: 'chat_1',
      }),
    })
    const conversationEvent = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:20.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_conversation_later',
        lane: 'conversation',
        occurredAt: '2026-04-22T10:01:00.000Z',
        laneSeq: '1',
        text: 'conversation later',
        threadId: 'chat_1',
      }),
    })

    const afterSystem = await listAssistantInputEvents({
      vault: vaultRoot,
      afterCursor: systemEvent.cursor,
    })

    expect(afterSystem.events.map((event) => event.inputId)).toEqual([
      conversationEvent.inputId,
    ])
  })

  it('uses timestamps before source kind when comparing hosted and inbox cursors', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-mixed-source-cursor-',
    )
    const inboxEvent = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: {
        content: {
          text: 'inbox first',
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: '2026-04-22T10:00:10.000Z',
        sourceRef: {
          captureId: 'cap_mixed_source_first',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      },
    })
    const hostedEvent = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:01:10.000Z'),
      event: createHostedMailboxEventInput({
        eventId: 'evt_hosted_later',
        lane: 'conversation',
        occurredAt: '2026-04-22T10:01:00.000Z',
        laneSeq: '1',
        text: 'hosted later',
        threadId: 'chat_1',
      }),
    })

    const afterInbox = await listAssistantInputEvents({
      vault: vaultRoot,
      afterCursor: inboxEvent.cursor,
    })

    expect(afterInbox.events.map((event) => event.inputId)).toEqual([
      hostedEvent.inputId,
    ])
  })

  it('uses inbox source position to avoid skipping same-timestamp captures', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-inbox-same-timestamp-',
    )
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: {
        content: {
          text: 'first same timestamp capture',
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: '2026-04-22T10:00:00.000Z',
        sourceRef: {
          captureId: 'cap_a',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      },
    })
    const second = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: {
        content: {
          text: 'second same timestamp capture',
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        receivedAt: '2026-04-22T10:00:00.000Z',
        sourceRef: {
          captureId: 'cap_b',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      },
    })

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    })
    const afterFirst = await listAssistantInputEvents({
      afterCursor: first.cursor,
      vault: vaultRoot,
    })

    expect(listed.events.map((event) => event.inputId)).toEqual([
      first.inputId,
      second.inputId,
    ])
    expect(listed.events.map((event) => event.cursor.sourcePosition)).toEqual([
      'inbox-capture:linq:cap_a',
      'inbox-capture:linq:cap_b',
    ])
    expect(afterFirst.events.map((event) => event.inputId)).toEqual([
      second.inputId,
    ])
  })

  it('uses timestamps before inbox capture ids when listing after a cursor', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-inbox-hash-cursor-',
    )
    const first = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:10.000Z'),
      event: {
        content: {
          text: 'first capture',
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
        receivedAt: '2026-04-22T10:00:10.000Z',
        sourceRef: {
          captureId: 'cap_71cca0bc171dc05ce6b6c9a5a9',
          kind: 'inbox-capture',
          source: 'telegram',
          version: null,
        },
      },
    })
    const laterHashBeforeFirst = await upsertAssistantInputEvent({
      vault: vaultRoot,
      now: new Date('2026-04-22T10:00:20.000Z'),
      event: {
        content: {
          text: 'later capture',
        },
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'telegram',
          threadId: 'chat_1',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:20.000Z',
        receivedAt: '2026-04-22T10:00:20.000Z',
        sourceRef: {
          captureId: 'cap_39b5f2e5167ce4dcbb445e7831',
          kind: 'inbox-capture',
          source: 'telegram',
          version: null,
        },
      },
    })

    const afterFirst = await listAssistantInputEvents({
      afterCursor: first.cursor,
      vault: vaultRoot,
    })

    expect(afterFirst.events.map((event) => event.inputId)).toEqual([
      laterHashBeforeFirst.inputId,
    ])
  })

  it('rejects excessive attachment descriptors', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-attachment-count-',
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            attachmentDescriptors: Array.from({ length: 33 }, (_, index) => ({
              attachmentId: `att_${index}`,
              contentType: 'audio/mp4',
              fileName: `audio-${index}.m4a`,
              kind: 'audio',
              sizeBytes: 1,
            })),
            text: 'too many attachments',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_many_attachments',
            laneSeq: '42',
          }),
        },
      }),
    ).rejects.toThrow(/at most 32|Too big/iu)
  })

  it('rejects raw path or URL shaped attachment descriptors', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-path-guard-',
    )
    const unsafeDescriptor = {
      attachmentId: 'att_unsafe',
      contentType: null,
      fileName: null,
      kind: 'audio',
      path: '/tmp/raw-audio.m4a',
      url: 'https://example.invalid/signed-url',
    }

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            attachmentDescriptors: [unsafeDescriptor],
            text: 'unsafe attachment',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_unsafe',
            laneSeq: '42',
          }),
        },
      }),
    ).rejects.toThrow(/unrecognized key/iu)

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            attachmentDescriptors: [
              {
                attachmentId: 'https://example.invalid/signed-url',
                contentType: 'audio/mp4',
                fileName: '/tmp/raw-audio.m4a',
                kind: 'audio',
              },
            ],
            text: 'unsafe attachment values',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_unsafe_values',
            laneSeq: '43',
          }),
        },
      }),
    ).rejects.toThrow(/paths or URLs/iu)

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            attachmentDescriptors: [
              {
                attachmentId: 'att_control_char',
                contentType: 'audio/mp4',
                fileName: 'voice\tmemo.m4a',
                kind: 'audio',
              },
            ],
            text: 'unsafe attachment filename',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_unsafe_control_filename',
            laneSeq: '44',
          }),
        },
      }),
    ).rejects.toThrow(/Invalid string|fileName/iu)

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            attachmentDescriptors: [
              {
                attachmentId: 'att_dotdot',
                contentType: 'audio/mp4',
                fileName: '..',
                kind: 'audio',
              },
            ],
            text: 'unsafe attachment filename',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_unsafe_dotdot_filename',
            laneSeq: '45',
          }),
        },
      }),
    ).rejects.toThrow(/path segment sentinel/iu)
  })

  it('rejects raw provider payload and oversized text', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-text-guard-',
    )
    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: JSON.stringify({
              headers: {
                cookie: 'secret',
              },
              model: 'gpt',
              messages: [
                {
                  role: 'user',
                  content: 'raw provider request',
                },
              ],
            }),
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_provider_payload',
            laneSeq: '43',
          }),
        },
      }),
    ).rejects.toThrow(/provider request payloads/iu)
    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'x'.repeat(20_001),
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_oversized',
            laneSeq: '44',
          }),
        },
      }),
    ).rejects.toThrow(/Too big/iu)
  })

  it('accepts ordinary URLs and paths in prompt text fields while rejecting raw email headers', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-raw-text-shapes-',
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'Authorization: fixture-header\nCookie: fixture-cookie',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_text_header_lines',
            laneSeq: '43',
          }),
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'Authorization: fixture-header\nCookie: fixture-cookie',
        }),
      }),
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'downloaded from https://example.invalid/raw-message',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_text_url',
            laneSeq: '42',
          }),
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'downloaded from https://example.invalid/raw-message',
        }),
      }),
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            transcriptText:
              'From: sender@example.invalid\nTo: inbox@example.invalid\nSubject: raw',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_transcript_email',
            laneSeq: '44',
          }),
        },
      }),
    ).rejects.toThrow(/raw email/iu)

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            userMessageContent: [
              {
                text: 'read /tmp/raw-email.eml before replying',
                type: 'text',
              },
            ],
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_user_message_path',
            laneSeq: '45',
          }),
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.objectContaining({
          userMessageContent: [
            {
              text: 'read /tmp/raw-email.eml before replying',
              type: 'text',
            },
          ],
        }),
      }),
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            transcriptText: 'the user mentioned /notes/meeting-summary.md and https://example.invalid/context',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_transcript_paths',
            laneSeq: '46',
          }),
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        content: expect.objectContaining({
          transcriptText: 'the user mentioned /notes/meeting-summary.md and https://example.invalid/context',
        }),
      }),
    )
  })

  it('rejects unsafe source, conversation, and reply metadata', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-metadata-guard-',
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'unsafe metadata',
          },
          conversation: {
            accountId: 'acct_1',
            actorId: 'actor_1',
            actorIsSelf: false,
            source: 'linq',
            threadId: 'https://example.invalid/thread',
            threadIsDirect: true,
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          replyTarget: {
            channel: 'linq',
            messageId: 'msg_1',
            threadId: 'chat_1',
          },
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_metadata_thread',
            laneSeq: '45',
          }),
        },
      }),
    ).rejects.toThrow(/opaque token|paths or URLs/iu)

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'unsafe source metadata',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          replyTarget: {
            channel: 'linq',
            messageId: 'msg_1',
            threadId: '/tmp/raw-thread',
          },
          sourceRef: {
            ...createHostedMailboxSourceRef({
              eventId: 'evt_metadata_source',
              laneSeq: '46',
            }),
            itemId: 'https://example.invalid/item',
          },
        },
      }),
    ).rejects.toThrow(/opaque token|paths or URLs/iu)
  })

  it('allows bounded private reply route authority without exposing it as conversation identity', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-reply-route-',
    )
    const threadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<message-24@example.test>',
      references: Array.from(
        { length: 25 },
        (_, index) => `<message-${index}@example.test>`,
      ),
      subject: 'Serialized hosted email reply target',
      to: ['person@example.test'],
    })

    expect(threadTarget.length).toBeGreaterThan(512)

    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: {
        content: {
          text: 'reply to the user',
        },
        conversation: {
          accountId: 'acct_safe',
          actorId: 'actor_safe',
          actorIsSelf: false,
          source: 'email',
          threadId: 'thread_safe',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        replyTarget: {
          channel: 'email',
          messageId: 'raw_message_authority',
          threadId: threadTarget,
        },
        sourceRef: createHostedMailboxSourceRef({
          eventId: 'evt_reply_route',
          laneSeq: '47',
        }),
      },
    })

    expect(stored.replyTarget).toEqual({
      channel: 'email',
      messageId: 'raw_message_authority',
      threadId: threadTarget,
    })

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: {
          content: {
            text: 'unsafe route',
          },
          occurredAt: '2026-04-22T10:00:00.000Z',
          replyTarget: {
            channel: 'email',
            messageId: 'msg_1',
            threadId: 'https://example.invalid/thread',
          },
          sourceRef: createHostedMailboxSourceRef({
            eventId: 'evt_reply_route_url',
            laneSeq: '48',
          }),
        },
      }),
    ).rejects.toThrow(/route authority|path|URL/iu)
  })

  it('restricts projection reason codes to compact machine-readable values', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-reason-code-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_reason_code',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:42',
        text: 'reason code',
        threadId: 'chat_1',
      }),
    })

    await expect(
      updateAssistantInputProjection({
        inputId: input.inputId,
        vault: vaultRoot,
        projection: {
          reasonCode: 'failed at /tmp/raw-email.eml',
          status: 'failed',
        },
      }),
    ).rejects.toThrow(/Invalid string/iu)
  })

  it('rejects mismatched vault and paths context before writing', async () => {
    const first = await createAssistantInputStoreVault(
      'assistant-input-store-context-a-',
    )
    const second = await createAssistantInputStoreVault(
      'assistant-input-store-context-b-',
    )

    await expect(
      upsertAssistantInputEvent({
        paths: resolveAssistantStatePaths(first.vaultRoot),
        vault: second.vaultRoot,
        event: createHostedMailboxEventInput({
          eventId: 'evt_context',
          occurredAt: '2026-04-22T10:00:00.000Z',
          laneSeq: 'conversation:42',
          text: 'context',
          threadId: 'chat_1',
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_INPUT_EVENT_CONTEXT_MISMATCH',
    })

    await expect(
      upsertAssistantInputEvent({
        paths: {
          ...resolveAssistantStatePaths(first.vaultRoot),
          assistantStateRoot: resolveAssistantStatePaths(second.vaultRoot)
            .assistantStateRoot,
        },
        event: createHostedMailboxEventInput({
          eventId: 'evt_paths_only_context',
          occurredAt: '2026-04-22T10:00:00.000Z',
          laneSeq: 'conversation:43',
          text: 'context',
          threadId: 'chat_1',
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_INPUT_EVENT_CONTEXT_MISMATCH',
    })
  })

  it('rejects invalid timestamps before writing', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-timestamp-',
    )

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event: createHostedMailboxEventInput({
          eventId: 'evt_invalid_timestamp',
          occurredAt: '2026-04-22 10:00',
          laneSeq: 'conversation:42',
          text: 'invalid timestamp',
          threadId: 'chat_1',
        }),
      }),
    ).rejects.toThrow(/datetime/iu)
  })

  it('rejects symlinked assistant input event files on read', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-symlink-',
    )
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_symlink',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:42',
        text: 'valid',
        threadId: 'chat_1',
      }),
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const inputPath = resolveAssistantInputEventPath({
      inputId: stored.inputId,
      paths,
    })
    const externalPath = path.join(vaultRoot, 'escaped-input.json')
    await writeFile(externalPath, '{"ok":false}')
    await rm(inputPath)
    await symlink(externalPath, inputPath)

    await expect(
      readAssistantInputEvent({
        inputId: stored.inputId,
        vault: vaultRoot,
      }),
    ).rejects.toThrow(/must not contain symlinks/u)

    await expect(
      listAssistantInputEvents({
        vault: vaultRoot,
      }),
    ).rejects.toThrow(/regular JSON files|must not contain symlinks/u)

    const failures: string[] = []
    const skipped = await listAssistantInputEvents({
      vault: vaultRoot,
      skipInvalidRecords: true,
      onInvalidRecord(failure) {
        failures.push(failure.fileName)
      },
    })
    expect(skipped.events).toEqual([])
    expect(failures).toEqual([path.basename(inputPath)])
  })

  it('reads the latest cursor without requiring full-list consumers to sort events', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-latest-cursor-',
    )
    const later = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_latest_cursor_later',
        occurredAt: '2026-04-22T10:05:00.000Z',
        laneSeq: 'conversation:42',
        text: 'later',
        threadId: 'chat_1',
      }),
    })
    await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_latest_cursor_earlier',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:41',
        text: 'earlier',
        threadId: 'chat_1',
      }),
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(
      path.join(resolveAssistantInputEventsDirectory(paths), 'corrupt.json'),
      '{"not":"a versioned event"}',
    )

    await expect(
      readLatestAssistantInputCursor({
        vault: vaultRoot,
      }),
    ).rejects.toThrow(/versioned murph\.assistant-input-event\.v1/u)

    const failures: string[] = []
    const latest = await readLatestAssistantInputCursor({
      vault: vaultRoot,
      skipInvalidRecords: true,
      onInvalidRecord(failure) {
        failures.push(failure.fileName)
      },
    })

    expect(latest).toEqual(later.cursor)
    expect(failures).toEqual(['corrupt.json'])
  })

  it('fails closed on corrupt records and can explicitly skip invalid files', async () => {
    const { vaultRoot } = await createAssistantInputStoreVault(
      'assistant-input-store-corrupt-',
    )
    const stored = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput({
        eventId: 'evt_valid',
        occurredAt: '2026-04-22T10:00:00.000Z',
        laneSeq: 'conversation:42',
        text: 'valid',
        threadId: 'chat_1',
      }),
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(
      path.join(resolveAssistantInputEventsDirectory(paths), 'corrupt.json'),
      '{"not":"a versioned event"}',
    )

    await expect(
      listAssistantInputEvents({
        vault: vaultRoot,
      }),
    ).rejects.toThrow(/versioned murph\.assistant-input-event\.v1/u)

    const failures: string[] = []
    const skipped = await listAssistantInputEvents({
      vault: vaultRoot,
      skipInvalidRecords: true,
      onInvalidRecord(failure) {
        failures.push(failure.fileName)
      },
    })

    expect(skipped.events.map((event) => event.inputId)).toEqual([
      stored.inputId,
    ])
    expect(failures).toEqual(['corrupt.json'])
  })
})

async function createAssistantInputStoreVault(prefix: string): Promise<{
  parentRoot: string
  vaultRoot: string
}> {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

function createHostedMailboxEventInput(input: {
  eventId: string
  lane?: 'conversation' | 'system'
  occurredAt: string
  laneSeq: string
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
    sourceRef: createHostedMailboxSourceRef({
      eventId: input.eventId,
      lane: input.lane,
      laneSeq: input.laneSeq.replace(/^conversation:/u, ''),
    }),
  }
}

function createHostedMailboxSourceRef(input: {
  dedupeKey?: string | null
  eventId: string
  itemId?: string
  lane?: 'conversation' | 'system'
  laneSeq: string
}) {
  return {
    dedupeKey: input.dedupeKey === undefined
      ? `${input.eventId}_dedupe`
      : input.dedupeKey,
    eventId: input.eventId,
    itemId: input.itemId ?? `${input.eventId}_item`,
    kind: 'hosted-mailbox' as const,
    lane: input.lane ?? 'conversation',
    laneSeq: input.laneSeq,
    payloadSchema: 'murph.hosted-payload.v1',
    payloadSource: 'sidecar' as const,
    source: 'hosted-mailbox' as const,
    wakeSchema: 'murph.hosted-wake.v1',
  }
}
