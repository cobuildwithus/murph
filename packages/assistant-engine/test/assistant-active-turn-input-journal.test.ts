import { readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendAssistantAcceptedTurnInputItems,
  assistantAcceptedTurnInputJournalSchema,
  readAssistantAcceptedTurnInputJournal,
  recordAssistantAcceptedTurnInputProviderRequest,
  resolveAssistantAcceptedTurnInputJournalPath,
  updateAssistantAcceptedTurnInputAdmissionState,
  updateAssistantAcceptedTurnInputProviderRequest,
  updateAssistantAcceptedTurnInputTranscriptRefs,
} from '../src/assistant/active-turn-input-journal.ts'
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
  it('persists ordered input metadata without raw prompt fallback text', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-journal-',
    )

    const journal = await appendAssistantAcceptedTurnInputItems({
      inputs: [
        {
          captureIds: ['cap_1'],
          contentRef: {
            kind: 'inbox-capture',
            refId: 'cap_1',
            version: 'ledger-v1',
          },
          cursorEffects: [
            {
              captureIds: ['cap_1'],
              cursorKind: 'auto-reply-channel',
              from: {
                captureId: 'cap_0',
                createdAt: '2026-04-22T09:59:01.000Z',
                occurredAt: '2026-04-22T09:59:00.000Z',
              },
              source: 'telegram',
              to: {
                captureId: 'cap_1',
                createdAt: '2026-04-22T10:00:01.000Z',
                occurredAt: '2026-04-22T10:00:00.000Z',
              },
            },
            {
              captureIds: ['mailbox_item_conversation_1'],
              cursorKind: 'hosted-mailbox-import',
              from: '41',
              lane: 'conversation',
              source: 'hosted-mailbox',
              to: '42',
            },
          ],
          id: 'input_1',
          source: 'inbox',
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
      inputIds: ['input_1', 'input_2'],
      materializerVersion: 1,
      schema: 'murph.assistant-accepted-turn-input-journal.v1',
      sessionId: 'session_active_turn',
      turnId: 'turn_active_input',
    })
    expect(journal.inputs.map((input) => input.id)).toEqual(['input_1', 'input_2'])
    expect(journal.inputs[0]?.cursorEffects[0]).toMatchObject({
      captureIds: ['cap_1'],
      cursorKind: 'auto-reply-channel',
      source: 'telegram',
    })
    expect(journal.inputs[0]?.cursorEffects[1]).toEqual({
      captureIds: ['mailbox_item_conversation_1'],
      cursorKind: 'hosted-mailbox-import',
      from: '41',
      lane: 'conversation',
      source: 'hosted-mailbox',
      to: '42',
    })
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
    expect(assistantAcceptedTurnInputJournalSchema.parse(JSON.parse(persistedRaw))).toEqual(
      journal,
    )
    await expect(
      readAssistantAcceptedTurnInputJournal(vaultRoot, 'turn_active_input'),
    ).resolves.toEqual(journal)
  })

  it('updates transcript refs without persisting raw prompt fallback text', async () => {
    const { paths, vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-ref-update-',
    )

    await appendAssistantAcceptedTurnInputItems({
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

    await appendAssistantAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          promptFallbackText: 'Initial prompt',
          source: 'initial',
        },
        {
          captureIds: ['cap_late'],
          contentRef: {
            kind: 'inbox-capture',
            refId: 'cap_late',
          },
          id: 'input_late',
          source: 'inbox',
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
        acceptedInputIds: ['input_initial', 'input_late'],
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
      'input_late',
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
        acceptedInputIds: ['input_initial', 'input_late'],
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
      appendAssistantAcceptedTurnInputItems({
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

    await appendAssistantAcceptedTurnInputItems({
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
        kind: 'flat-prompt-replay',
      },
      now: new Date('2026-04-22T10:01:00.000Z'),
      ordinal: 0,
      turnId: 'turn_flat_prompt',
      vault: vaultRoot,
    })

    expect(journal?.providerRequests[0]?.continuation).toEqual({
      kind: 'flat-prompt-replay',
    })
  })

  it('rejects session identity drift and invalid provider request input ids', async () => {
    const { vaultRoot } = await createAssistantPaths(
      'assistant-active-turn-input-identity-',
    )

    await appendAssistantAcceptedTurnInputItems({
      inputs: [
        {
          id: 'input_initial',
          source: 'initial',
        },
        {
          id: 'input_late',
          source: 'inbox',
        },
      ],
      now: new Date('2026-04-22T10:00:00.000Z'),
      sessionId: 'session_active_turn',
      turnId: 'turn_identity',
      vault: vaultRoot,
    })

    await expect(
      appendAssistantAcceptedTurnInputItems({
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
      appendAssistantAcceptedTurnInputItems({
        inputs: [
          {
            cursorEffects: [
              {
                cursorKind: 'hosted-mailbox-import',
                from: '01',
                lane: 'conversation',
                source: 'hosted-mailbox',
                to: '2',
              },
            ],
            id: 'input_bad_watermark',
            source: 'inbox',
          },
        ],
        sessionId: 'session_active_turn',
        turnId: 'turn_bad_watermark',
        vault: vaultRoot,
      }),
    ).rejects.toThrow()
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
          acceptedInputIds: ['input_initial', 'input_late'],
          ordinal: 0,
        },
      ],
    })
    await appendAssistantAcceptedTurnInputItems({
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
        acceptedInputIds: ['input_initial', 'input_late', 'input_more'],
        ordinal: 0,
        turnId: 'turn_identity',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TURN_INPUT_JOURNAL_INVALID_PROVIDER_REQUEST',
    })
    await expect(
      recordAssistantAcceptedTurnInputProviderRequest({
        acceptedInputIds: ['input_late', 'input_initial'],
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

    await appendAssistantAcceptedTurnInputItems({
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
      appendAssistantAcceptedTurnInputItems({
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

    await appendAssistantAcceptedTurnInputItems({
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

    await appendAssistantAcceptedTurnInputItems({
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
          id: 'input_initial',
          source: 'initial',
        },
        {
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
          cursorEffects: [],
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
          cursorEffects: [],
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

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return {
    paths: resolveAssistantStatePaths(context.vaultRoot),
    vaultRoot: context.vaultRoot,
  }
}
