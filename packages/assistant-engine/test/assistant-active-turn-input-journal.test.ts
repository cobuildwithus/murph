import { readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendAssistantAcceptedTurnInputItems,
  assertAssistantAcceptedTurnInputAssistantInputEventsExist,
  assistantAcceptedTurnInputJournalSchema,
  readAssistantAcceptedTurnInputJournal,
  recordAssistantAcceptedTurnInputProviderRequest,
  resolveAssistantAcceptedTurnInputJournalPath,
  resolveAssistantAcceptedTurnInputReferenceWindow,
  updateAssistantAcceptedTurnInputAdmissionState,
  updateAssistantAcceptedTurnInputProviderRequest,
  updateAssistantAcceptedTurnInputTranscriptRefs,
} from '../src/assistant/active-turn-input-journal.ts'
import {
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.ts'
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

describe('assistant accepted active-turn input journal', () => {
  it('requires caller-owned accepted times and derives the exact reference window', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-reference-window-',
    )

    await expect(
      appendAssistantAcceptedTurnInputItems({
        inputs: [
          {
            id: 'input_missing_reference',
            source: 'manual',
          },
        ],
        now: new Date('2031-02-15T10:00:00.100Z'),
        sessionId: 'session_missing_reference',
        turnId: 'turn_missing_reference',
        vault: vaultRoot,
      }),
    ).rejects.toThrow()

    expect(resolveAssistantAcceptedTurnInputReferenceWindow([
      {
        acceptedAt: '2031-02-15T09:59:59.900Z',
        id: 'input_first',
        source: 'assistant-input',
      },
      {
        acceptedAt: '2031-02-15T10:00:00.100Z',
        id: 'input_second',
        source: 'assistant-input',
      },
    ])).toEqual({
      earliestAt: '2031-02-15T09:59:59.900Z',
      latestAt: '2031-02-15T10:00:00.100Z',
    })
    expect(resolveAssistantAcceptedTurnInputReferenceWindow([
      {
        id: 'input_missing_reference',
        source: 'manual',
      },
    ])).toBeNull()
  })

  it('persists ordered input metadata without raw prompt fallback text', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-journal-',
    )

    const journal = await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          captureIds: ['cap_1'],
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000001',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000001',
          source: 'assistant-input',
        },
        {
          id: 'input_2',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Sensitive fallback prompt text',
          source: 'manual',
          transcriptRef: {
            entryCreatedAt: '2026-04-22T10:00:02.000Z',
            entryIndex: 0,
            entryKind: 'user',
            sessionId: 'session_active_turn',
          },
        },
      ],
      now: new Date('2026-04-22T10:00:02.000Z'),
      sessionId: 'session_active_turn',
      turnId: 'turn_active_input',
      vault: vaultRoot,
    })

    expect(journal).toMatchObject({
      admissionState: 'current-turn-open',
      inputIds: ['ain_00000000000000000000000000000001', 'input_2'],
      materializerVersion: 1,
      schema: 'murph.assistant-accepted-turn-input-journal.v1',
      sessionId: 'session_active_turn',
      turnId: 'turn_active_input',
    })
    expect(journal.inputs.map((input) => input.id)).toEqual([
      'ain_00000000000000000000000000000001',
      'input_2',
    ])
    expect(journal.inputs[0]).toMatchObject({
      captureIds: ['cap_1'],
      contentRef: {
        kind: 'assistant-input-event',
        refId: 'ain_00000000000000000000000000000001',
        version: 'murph.assistant-input-event.v1',
      },
      id: 'ain_00000000000000000000000000000001',
      source: 'assistant-input',
    })
    expect(journal.inputs[0]).not.toHaveProperty('cursorEffects')
    expect(journal.inputs[1]?.promptFallback).toMatchObject({
      reason: 'manual-input',
      textLengthBucket: '1-64',
    })

    const persistedRaw = await readFile(
      resolveAssistantAcceptedTurnInputJournalPath(paths, 'turn_active_input'),
      'utf8',
    )
    expect(persistedRaw).not.toContain('Sensitive fallback prompt text')
    expect(persistedRaw).not.toContain('acct_1')
    expect(persistedRaw).not.toContain('thread_1')
    expect(persistedRaw).not.toContain('cursorEffects')
    expect(persistedRaw).not.toContain('auto-reply-channel')
    expect(persistedRaw).not.toContain('inbox-scan')
    expect(persistedRaw).not.toContain('hosted-mailbox-import')
    expect(assistantAcceptedTurnInputJournalSchema.parse(JSON.parse(persistedRaw))).toEqual(
      journal,
    )
    await expect(
      readAssistantAcceptedTurnInputJournal(vaultRoot, 'turn_active_input'),
    ).resolves.toEqual(journal)
  })

  it('records assistant input events without requiring capture ids', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-assistant-input-',
    )

    const journal = await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000000',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000000',
          source: 'assistant-input',
        },
      ],
      now: new Date('2026-04-22T10:00:02.000Z'),
      sessionId: 'session_assistant_input',
      turnId: 'turn_assistant_input',
      vault: vaultRoot,
    })

    expect(journal.inputs[0]).toMatchObject({
      captureIds: [],
      contentRef: {
        kind: 'assistant-input-event',
        refId: 'ain_00000000000000000000000000000000',
        version: 'murph.assistant-input-event.v1',
      },
      id: 'ain_00000000000000000000000000000000',
      source: 'assistant-input',
    })
  })

  it('rejects assistant-input journal items without exact assistant input event refs', () => {
    const baseJournal = {
      admissionState: 'current-turn-open',
      createdAt: '2026-04-22T10:00:00.000Z',
      inputIds: ['ain_00000000000000000000000000000000'],
      inputs: [
        {
          acceptedAt: '2026-04-22T10:00:00.000Z',
          captureIds: [],
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000000',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000000',
          promptFallback: null,
          source: 'assistant-input',
          transcriptRef: null,
        },
      ],
      materializerVersion: 1,
      providerRequests: [],
      schema: 'murph.assistant-accepted-turn-input-journal.v1',
      sessionId: 'session_assistant_input_ref',
      turnId: 'turn_assistant_input_ref',
      updatedAt: '2026-04-22T10:00:00.000Z',
    }

    expect(() =>
      assistantAcceptedTurnInputJournalSchema.parse({
        ...baseJournal,
        inputs: [
          {
            ...baseJournal.inputs[0],
            contentRef: null,
          },
        ],
      }),
    ).toThrow(/assistant input event/u)
    expect(() =>
      assistantAcceptedTurnInputJournalSchema.parse({
        ...baseJournal,
        inputs: [
          {
            ...baseJournal.inputs[0],
            contentRef: {
              kind: 'manual',
              refId: 'ain_00000000000000000000000000000000',
              version: null,
            },
          },
        ],
      }),
    ).toThrow(/assistant input event/u)
    expect(() =>
      assistantAcceptedTurnInputJournalSchema.parse({
        ...baseJournal,
        inputs: [
          {
            ...baseJournal.inputs[0],
            contentRef: {
              kind: 'assistant-input-event',
              refId: 'ain_00000000000000000000000000000001',
              version: 'murph.assistant-input-event.v1',
            },
          },
        ],
      }),
    ).toThrow(/matching assistant input event/u)
    expect(() =>
      assistantAcceptedTurnInputJournalSchema.parse({
        ...baseJournal,
        inputs: [
          {
            ...baseJournal.inputs[0],
            contentRef: {
              kind: 'assistant-input-event',
              refId: 'ain_00000000000000000000000000000000',
              version: 'murph.assistant-input-event.v0',
            },
          },
        ],
      }),
    ).toThrow(/matching assistant input event/u)
  })

  it('requires accepted assistant-input refs to resolve before checkpointing', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-checkpoint-ref-',
    )

    const missing = await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000000',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000000',
          source: 'assistant-input',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_checkpoint_ref',
      turnId: 'turn_checkpoint_ref',
      vault: vaultRoot,
    })

    await expect(
      assertAssistantAcceptedTurnInputAssistantInputEventsExist({
        journal: missing,
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_MISSING_ASSISTANT_INPUT_EVENT',
    })

    const event = await upsertAssistantInputEvent({
      event: {
        content: {
          text: 'checkpoint-visible input',
        },
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceRef: {
          captureId: 'cap_checkpoint_ref',
          kind: 'inbox-capture',
          source: 'linq',
          version: null,
        },
      },
      now: new Date('2026-04-22T10:00:01.000Z'),
      vault: vaultRoot,
    })
    const stored = await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          acceptedAt: event.receivedAt ?? event.occurredAt,
          contentRef: {
            kind: 'assistant-input-event',
            refId: event.inputId,
            version: 'murph.assistant-input-event.v1',
          },
          id: event.inputId,
          source: 'assistant-input',
        },
      ],
      now: new Date('2026-04-22T10:00:02.000Z'),
      sessionId: 'session_checkpoint_ref_stored',
      turnId: 'turn_checkpoint_ref_stored',
      vault: vaultRoot,
    })

    await expect(
      assertAssistantAcceptedTurnInputAssistantInputEventsExist({
        journal: stored,
        vault: vaultRoot,
      }),
    ).resolves.toBeUndefined()
  })

  it('updates transcript refs without persisting raw prompt fallback text', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-ref-update-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Initial sensitive prompt',
          source: 'manual',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_ref_update',
      turnId: 'turn_ref_update',
      vault: vaultRoot,
    })

    const updated = await updateAssistantAcceptedTurnInputTranscriptRefs({
      now: new Date('2026-04-22T10:00:01.000Z'),
      refs: [
        {
          inputId: 'input_initial',
          transcriptRef: {
            entryCreatedAt: '2026-04-22T10:00:00.000Z',
            entryIndex: 2,
            entryKind: 'user',
            sessionId: 'session_ref_update',
          },
        },
      ],
      turnId: 'turn_ref_update',
      vault: vaultRoot,
    })

    expect(updated?.inputs[0]?.transcriptRef).toEqual({
      entryCreatedAt: '2026-04-22T10:00:00.000Z',
      entryIndex: 2,
      entryKind: 'user',
      sessionId: 'session_ref_update',
    })
    expect(updated?.updatedAt).toBe('2026-04-22T10:00:01.000Z')

    const persistedRaw = await readFile(
      resolveAssistantAcceptedTurnInputJournalPath(paths, 'turn_ref_update'),
      'utf8',
    )
    expect(persistedRaw).not.toContain('Initial sensitive prompt')

    await expect(
      updateAssistantAcceptedTurnInputTranscriptRefs({
        refs: [
          {
            inputId: 'input_initial',
            transcriptRef: {
              entryCreatedAt: '2026-04-22T10:00:00.000Z',
              entryIndex: null,
              entryKind: 'user',
              sessionId: 'session_ref_update',
            },
          },
        ],
        turnId: 'turn_ref_update',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INCOMPLETE_TRANSCRIPT_REF',
    })
    await expect(
      updateAssistantAcceptedTurnInputTranscriptRefs({
        refs: [
          {
            inputId: 'input_initial',
            transcriptRef: {
              entryCreatedAt: '2026-04-22T10:00:00.000Z',
              entryIndex: 3,
              entryKind: 'user',
              sessionId: 'session_ref_update',
            },
          },
        ],
        turnId: 'turn_ref_update',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_TRANSCRIPT_REF_ALREADY_SET',
    })

    await updateAssistantAcceptedTurnInputAdmissionState({
      admissionState: 'passive-input-next-turn',
      turnId: 'turn_ref_update',
      vault: vaultRoot,
    })
    await expect(
      updateAssistantAcceptedTurnInputTranscriptRefs({
        refs: [
          {
            inputId: 'input_initial',
            transcriptRef: {
              entryCreatedAt: '2026-04-22T10:00:00.000Z',
              entryIndex: 2,
              entryKind: 'user',
              sessionId: 'session_ref_update',
            },
          },
        ],
        turnId: 'turn_ref_update',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_ADMISSION_CLOSED',
    })
  })

  it('updates admission state and provider request ordinal metadata', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-provider-request-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          promptFallbackText: 'Initial prompt',
          source: 'initial',
        },
        {
          captureIds: ['cap_late'],
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000002',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000002',
          source: 'assistant-input',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_active_turn',
      turnId: 'turn_provider_request',
      vault: vaultRoot,
    })

    const withProviderRequest = await recordAssistantAcceptedTurnInputProviderRequest({
      continuation: {
        kind: 'provider-state-optimization',
      },
      now: new Date('2026-04-22T10:01:00.000Z'),
      ordinal: 2,
      providerAttemptId: 'attempt_2',
      turnId: 'turn_provider_request',
      vault: vaultRoot,
    })
    expect(withProviderRequest?.providerRequests).toEqual([
      {
        acceptedInputIds: ['input_initial', 'ain_00000000000000000000000000000002'],
        continuation: {
          kind: 'provider-state-optimization',
        },
        ordinal: 2,
        providerAttemptId: 'attempt_2',
        requestedAt: '2026-04-22T10:01:00.000Z',
      },
    ])
    expect(withProviderRequest?.inputs.map((input) => input.id)).toEqual([
      'input_initial',
      'ain_00000000000000000000000000000002',
    ])
    const updatedProviderRequest =
      await updateAssistantAcceptedTurnInputProviderRequest({
        continuation: {
          kind: 'explicit-structured-history',
        },
        now: new Date('2026-04-22T10:01:30.000Z'),
        ordinal: 2,
        providerAttemptId: 'attempt_2b',
        turnId: 'turn_provider_request',
        vault: vaultRoot,
      })
    expect(updatedProviderRequest?.providerRequests).toEqual([
      {
        acceptedInputIds: ['input_initial', 'ain_00000000000000000000000000000002'],
        continuation: {
          kind: 'explicit-structured-history',
        },
        ordinal: 2,
        providerAttemptId: 'attempt_2b',
        requestedAt: '2026-04-22T10:01:00.000Z',
      },
    ])

    const committed = await updateAssistantAcceptedTurnInputAdmissionState({
      admissionState: 'commit-started',
      now: new Date('2026-04-22T10:02:00.000Z'),
      turnId: 'turn_provider_request',
      vault: vaultRoot,
    })
    expect(committed?.admissionState).toBe('commit-started')
    expect(committed?.updatedAt).toBe('2026-04-22T10:02:00.000Z')
    const journalPath = resolveAssistantAcceptedTurnInputJournalPath(
      paths,
      'turn_provider_request',
    )
    const legacyRaw = JSON.parse(await readFile(journalPath, 'utf8'))
    legacyRaw.providerRequests[0].continuation = {
      kind: 'provider-state-optimization',
      responseId: 'resp_legacy',
    }
    await writeFile(journalPath, `${JSON.stringify(legacyRaw, null, 2)}\n`)

    const legacyRead = await readAssistantAcceptedTurnInputJournal(
      vaultRoot,
      'turn_provider_request',
    )
    expect(legacyRead?.providerRequests[0]?.continuation).toEqual({
      kind: 'provider-state-optimization',
    })
    const nextRequest = await recordAssistantAcceptedTurnInputProviderRequest({
      continuation: {
        kind: 'explicit-structured-history',
      },
      now: new Date('2026-04-22T10:03:00.000Z'),
      ordinal: 3,
      providerAttemptId: 'attempt_3',
      turnId: 'turn_provider_request',
      vault: vaultRoot,
    })
    expect(nextRequest?.providerRequests).toHaveLength(2)
    expect(await readFile(journalPath, 'utf8')).not.toContain('resp_legacy')
    await expect(
      updateAssistantAcceptedTurnInputAdmissionState({
        admissionState: 'current-turn-open',
        turnId: 'turn_provider_request',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_ADMISSION_TRANSITION',
    })
    await expect(
      appendTestAcceptedTurnInputItems({
        inputs: [
          {
            id: 'input_after_commit',
            source: 'manual',
          },
        ],
        sessionId: 'session_active_turn',
        turnId: 'turn_provider_request',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_ADMISSION_CLOSED',
    })
  })

  it('records flat prompt replay provider request metadata', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-flat-prompt-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          promptFallbackText: 'Initial prompt',
          source: 'initial',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_flat_prompt',
      turnId: 'turn_flat_prompt',
      vault: vaultRoot,
    })

    const journal = await recordAssistantAcceptedTurnInputProviderRequest({
      continuation: {
        kind: 'thread-start',
      },
      now: new Date('2026-04-22T10:01:00.000Z'),
      ordinal: 0,
      turnId: 'turn_flat_prompt',
      vault: vaultRoot,
    })

    expect(journal?.providerRequests[0]?.continuation).toEqual({
      kind: 'thread-start',
    })
  })

  it('rejects session identity drift and invalid provider request input ids', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-identity-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          source: 'initial',
        },
        {
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000003',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000003',
          source: 'assistant-input',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_active_turn',
      turnId: 'turn_identity',
      vault: vaultRoot,
    })

    await expect(
      appendTestAcceptedTurnInputItems({
        inputs: [
          {
            id: 'input_wrong_session',
            source: 'manual',
          },
        ],
        sessionId: 'session_other',
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_IDENTITY_MISMATCH',
    })
    await expect(
      recordAssistantAcceptedTurnInputProviderRequest({
        acceptedInputIds: ['input_initial'],
        ordinal: 0,
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
    })
    await expect(
      recordAssistantAcceptedTurnInputProviderRequest({
        ordinal: 0,
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      providerRequests: [
        {
          acceptedInputIds: [
            'input_initial',
            'ain_00000000000000000000000000000003',
          ],
          ordinal: 0,
        },
      ],
    })
    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_more',
          source: 'manual',
        },
      ],
      sessionId: 'session_active_turn',
      turnId: 'turn_identity',
      vault: vaultRoot,
    })
    await expect(
      recordAssistantAcceptedTurnInputProviderRequest({
        acceptedInputIds: [
          'input_initial',
          'ain_00000000000000000000000000000003',
          'input_more',
        ],
        ordinal: 0,
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
    })
    await expect(
      recordAssistantAcceptedTurnInputProviderRequest({
        acceptedInputIds: [
          'ain_00000000000000000000000000000003',
          'input_initial',
        ],
        ordinal: 1,
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
    })
    await expect(
      recordAssistantAcceptedTurnInputProviderRequest({
        acceptedInputIds: ['input_initial', 'input_missing'],
        ordinal: 1,
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
    })
  })

  it('rejects appending input while closing current-turn admission', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-close-with-append-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          source: 'initial',
        },
      ],
      sessionId: 'session_close_with_append',
      turnId: 'turn_close_with_append',
      vault: vaultRoot,
    })

    await expect(
      appendTestAcceptedTurnInputItems({
        admissionState: 'passive-input-next-turn',
        inputs: [
          {
            id: 'input_late',
            source: 'manual',
          },
        ],
        sessionId: 'session_close_with_append',
        turnId: 'turn_close_with_append',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_ADMISSION_CLOSED',
    })
  })

  it('rejects corrupted provider request metadata when reading a persisted journal', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-corrupt-provider-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          source: 'initial',
        },
        {
          id: 'input_late',
          source: 'manual',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_corrupt_provider_request',
      turnId: 'turn_corrupt_provider_request',
      vault: vaultRoot,
    })
    const journal = await recordAssistantAcceptedTurnInputProviderRequest({
      now: new Date('2026-04-22T10:01:00.000Z'),
      ordinal: 0,
      turnId: 'turn_corrupt_provider_request',
      vault: vaultRoot,
    })
    if (!journal) {
      throw new Error('expected provider request journal')
    }

    const journalPath = resolveAssistantAcceptedTurnInputJournalPath(
      paths,
      'turn_corrupt_provider_request',
    )
    const corrupted = {
      ...journal,
      providerRequests: [
        {
          ...journal.providerRequests[0],
          acceptedInputIds: ['input_late', 'input_initial'],
        },
        {
          ...journal.providerRequests[0],
          acceptedInputIds: ['input_missing'],
          ordinal: 0,
        },
      ],
    }
    await writeFile(journalPath, JSON.stringify(corrupted), 'utf8')

    await expect(
      readAssistantAcceptedTurnInputJournal(vaultRoot, 'turn_corrupt_provider_request'),
    ).rejects.toThrow(/provider request/u)
  })

  it('rejects provider request metadata that skips an earlier accepted input prefix', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-corrupt-provider-prefix-',
    )

    await appendTestAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          source: 'initial',
        },
        {
          id: 'input_late',
          source: 'manual',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_corrupt_provider_prefix',
      turnId: 'turn_corrupt_provider_prefix',
      vault: vaultRoot,
    })
    const journal = await recordAssistantAcceptedTurnInputProviderRequest({
      now: new Date('2026-04-22T10:01:00.000Z'),
      ordinal: 0,
      turnId: 'turn_corrupt_provider_prefix',
      vault: vaultRoot,
    })
    if (!journal) {
      throw new Error('expected provider request journal')
    }

    const journalPath = resolveAssistantAcceptedTurnInputJournalPath(
      paths,
      'turn_corrupt_provider_prefix',
    )
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        providerRequests: [
          {
            ...journal.providerRequests[0],
            acceptedInputIds: ['input_late'],
          },
        ],
      }),
      'utf8',
    )

    await expect(
      readAssistantAcceptedTurnInputJournal(vaultRoot, 'turn_corrupt_provider_prefix'),
    ).rejects.toThrow(/provider request/u)
  })

  it('exposes the journal through the runtime state service turns surface', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-service-',
    )
    const service = createAssistantRuntimeStateService(vaultRoot)

    const appended = await service.turns.acceptedInputs.append({
      admissionState: 'current-turn-open',
      inputs: [
        {
          acceptedAt: '2026-04-22T11:00:00.000Z',
          contentRef: {
            kind: 'manual',
            refId: 'manual_input_1',
          },
          id: 'manual_input_1',
          source: 'manual',
        },
      ],
      now: new Date('2026-04-22T11:00:00.000Z'),
      sessionId: 'session_service',
      turnId: 'turn_service',
    })
    expect(appended.inputIds).toEqual(['manual_input_1'])

    await expect(service.turns.acceptedInputs.read('turn_service')).resolves.toEqual(
      appended,
    )
    await expect(
      service.turns.acceptedInputs.updateAdmissionState({
        admissionState: 'passive-input-next-turn',
        now: new Date('2026-04-22T11:01:00.000Z'),
        turnId: 'turn_service',
      }),
    ).resolves.toMatchObject({
      admissionState: 'passive-input-next-turn',
      updatedAt: '2026-04-22T11:01:00.000Z',
    })
  })

  it('forwards default provider-request metadata through the runtime state service', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-service-provider-request-',
    )
    const service = createAssistantRuntimeStateService(vaultRoot)

    await service.turns.acceptedInputs.append({
      inputs: [
        {
          acceptedAt: '2026-04-22T11:10:00.000Z',
          id: 'input_initial',
          source: 'initial',
        },
        {
          acceptedAt: '2026-04-22T11:10:00.000Z',
          captureIds: ['cap_late'],
          contentRef: {
            kind: 'manual',
            refId: 'manual_input_late',
          },
          id: 'input_late',
          source: 'manual',
        },
      ],
      now: new Date('2026-04-22T11:10:00.000Z'),
      sessionId: 'session_service_provider_request',
      turnId: 'turn_service_provider_request',
    })

    await expect(
      service.turns.acceptedInputs.recordProviderRequest({
        now: new Date('2026-04-22T11:11:00.000Z'),
        ordinal: 0,
        turnId: 'turn_service_provider_request',
      }),
    ).resolves.toEqual({
      admissionState: 'current-turn-open',
      createdAt: '2026-04-22T11:10:00.000Z',
      inputIds: ['input_initial', 'input_late'],
      inputs: [
        {
          acceptedAt: '2026-04-22T11:10:00.000Z',
          captureIds: [],
          contentRef: null,
          id: 'input_initial',
          promptFallback: null,
          source: 'initial',
          transcriptRef: null,
        },
        {
          acceptedAt: '2026-04-22T11:10:00.000Z',
          captureIds: ['cap_late'],
          contentRef: {
            kind: 'manual',
            refId: 'manual_input_late',
            version: null,
          },
          id: 'input_late',
          promptFallback: null,
          source: 'manual',
          transcriptRef: null,
        },
      ],
      materializerVersion: 1,
      providerRequests: [
        {
          acceptedInputIds: ['input_initial', 'input_late'],
          continuation: {
            kind: 'explicit-structured-history',
          },
          ordinal: 0,
          providerAttemptId: null,
          requestedAt: '2026-04-22T11:11:00.000Z',
        },
      ],
      schema: 'murph.assistant-accepted-turn-input-journal.v1',
      sessionId: 'session_service_provider_request',
      turnId: 'turn_service_provider_request',
      updatedAt: '2026-04-22T11:11:00.000Z',
    })
  })

  it('can widen an existing provider request after live-steered input is appended', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-live-steer-provider-request-',
    )
    const service = createAssistantRuntimeStateService(vaultRoot)

    await service.turns.acceptedInputs.append({
      inputs: [
        {
          acceptedAt: '2026-04-22T11:20:00.000Z',
          id: 'input_initial',
          source: 'initial',
        },
      ],
      now: new Date('2026-04-22T11:20:00.000Z'),
      sessionId: 'session_live_steer_provider_request',
      turnId: 'turn_live_steer_provider_request',
    })
    await service.turns.acceptedInputs.recordProviderRequest({
      acceptedInputIds: ['input_initial'],
      now: new Date('2026-04-22T11:21:00.000Z'),
      ordinal: 0,
      turnId: 'turn_live_steer_provider_request',
    })
    await service.turns.acceptedInputs.append({
      inputs: [
        {
          acceptedAt: '2026-04-22T11:22:00.000Z',
          id: 'input_late',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Late input',
          source: 'manual',
        },
      ],
      now: new Date('2026-04-22T11:22:00.000Z'),
      sessionId: 'session_live_steer_provider_request',
      turnId: 'turn_live_steer_provider_request',
    })

    await expect(
      service.turns.acceptedInputs.updateProviderRequest({
        acceptedInputIds: ['input_initial', 'input_late'],
        continuation: {
          kind: 'explicit-structured-history',
        },
        now: new Date('2026-04-22T11:23:00.000Z'),
        ordinal: 0,
        providerAttemptId: 'attempt-live-steer',
        turnId: 'turn_live_steer_provider_request',
      }),
    ).resolves.toMatchObject({
      inputIds: ['input_initial', 'input_late'],
      providerRequests: [
        {
          acceptedInputIds: ['input_initial', 'input_late'],
          ordinal: 0,
          providerAttemptId: 'attempt-live-steer',
        },
      ],
      updatedAt: '2026-04-22T11:23:00.000Z',
    })
  })
})

async function appendTestAcceptedTurnInputItems(
  input: Parameters<typeof appendAssistantAcceptedTurnInputItems>[0],
) {
  const acceptedAt = input.now?.toISOString() ?? '2026-04-22T10:00:00.000Z'
  return appendAssistantAcceptedTurnInputItems({
    ...input,
    inputs: input.inputs.map((item) => ({
      acceptedAt,
      ...item,
    })),
  })
}

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return {
    paths: resolveAssistantStatePaths(context.vaultRoot),
    vaultRoot: context.vaultRoot,
  }
}
