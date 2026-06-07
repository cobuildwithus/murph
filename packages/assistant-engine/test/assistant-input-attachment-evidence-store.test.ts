import { readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readAssistantInputEvent,
  resolveAssistantInputEventPath,
  type AssistantInputAttachmentEvidence,
  updateAssistantInputAttachmentEvidence,
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

describe('assistant input attachment evidence', () => {
  it('defaults new assistant input events to not_attempted attachment evidence', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-default-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput('evt_default'),
    })

    expect(input.attachmentEvidence).toEqual({
      attachments: [],
      optionalInboxCaptureId: null,
      reasonCode: null,
      source: null,
      status: 'not_attempted',
      updatedAt: null,
    })
  })

  it('defaults legacy assistant input records without attachment evidence', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-legacy-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput('evt_legacy'),
    })
    const filePath = resolveAssistantInputEventPath({
      inputId: input.inputId,
      paths: resolveAssistantStatePaths(vaultRoot),
    })
    const rawEnvelope = JSON.parse(await readFile(filePath, 'utf8')) as {
      value?: Record<string, unknown>
    }
    if (!rawEnvelope.value) {
      throw new Error('expected assistant input event envelope value')
    }
    delete rawEnvelope.value.attachmentEvidence
    await writeFile(filePath, `${JSON.stringify(rawEnvelope, null, 2)}\n`)

    await expect(
      readAssistantInputEvent({
        inputId: input.inputId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      attachmentEvidence: {
        attachments: [],
        optionalInboxCaptureId: null,
        reasonCode: null,
        source: null,
        status: 'not_attempted',
        updatedAt: null,
      },
    })
  })

  it('updates event-owned attachment evidence without changing immutable input content', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-update-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput('evt_update'),
    })

    const updated = await updateAssistantInputAttachmentEvidence({
      inputId: input.inputId,
      vault: vaultRoot,
      now: new Date('2026-04-22T10:01:00.000Z'),
      attachmentEvidence: {
        attachments: [
          {
            byteSize: 1234,
            descriptorAttachmentId: 'att_descriptor',
            derived: {
              allowedRoot: 'derived/inbox/cap_1/attachments/att_source',
              kind: 'parser-manifest',
              manifestPath: 'derived/inbox/cap_1/attachments/att_source/manifest.json',
            },
            fileName: 'scan.pdf',
            inlineFragments: [
              {
                kind: 'derived_plain_text',
                label: 'derived-plain-text',
                text: 'Parsed PDF excerpt.',
                truncated: false,
              },
            ],
            kind: 'document',
            mime: 'application/pdf',
            ordinal: 1,
            parseState: 'succeeded',
            raw: {
              byteSize: 1234,
              kind: 'vault-relative-file',
              mediaType: 'application/pdf',
              path: 'raw/inbox/cap_1/attachments/01__scan.pdf',
              sha256: '0'.repeat(64),
            },
            sourceAttachmentId: 'att_source',
          },
        ],
        optionalInboxCaptureId: 'cap_1',
        reasonCode: null,
        source: 'local-inbox-import',
        status: 'available',
        updatedAt: null,
      },
    })

    expect(updated.content).toEqual(input.content)
    expect(updated.attachmentEvidence.status).toBe('available')
    expect(updated.attachmentEvidence.updatedAt).toBe('2026-04-22T10:01:00.000Z')
    expect(updated.attachmentEvidence.attachments[0]?.raw?.path).toBe(
      'raw/inbox/cap_1/attachments/01__scan.pdf',
    )

    await expect(
      readAssistantInputEvent({
        inputId: input.inputId,
        vault: vaultRoot,
      }),
    ).resolves.toEqual(updated)
  })

  it('rejects failed attachment evidence without a reason code', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-failed-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput('evt_failed'),
    })

    await expect(
      updateAssistantInputAttachmentEvidence({
        inputId: input.inputId,
        vault: vaultRoot,
        attachmentEvidence: {
          attachments: [],
          optionalInboxCaptureId: null,
          reasonCode: null,
          source: 'hosted-inbox-projection',
          status: 'failed',
          updatedAt: null,
        },
      }),
    ).rejects.toThrow(/reasonCode/u)
  })

  it.each([
    'ordinal',
    'sourceAttachmentId',
    'descriptorAttachmentId',
  ] as const)('rejects duplicate attachment evidence %s values', async (fieldName) => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      `assistant-input-attachment-evidence-duplicate-${fieldName}-`,
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput(`evt_duplicate_${fieldName}`),
    })

    await expect(
      updateAssistantInputAttachmentEvidence({
        inputId: input.inputId,
        vault: vaultRoot,
        attachmentEvidence: createDuplicateAttachmentEvidence(fieldName),
      }),
    ).rejects.toThrow(new RegExp(`${fieldName} values must be unique`, 'u'))
  })

  it.each([
    '/tmp/scan.pdf',
    '../raw/inbox/cap_1/attachments/scan.pdf',
    'file:///tmp/scan.pdf',
    'https://example.com/scan.pdf',
    'raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.pdf',
    'derived/assistant-input/ain_11111111111111111111111111111111/attachments/001/manifest.json',
    'raw/inbox/cap_1/attachments/scan.pdf?token=secret',
    'raw/inbox/cap_1/attachments/https:example.test-token.jpg',
    'raw/inbox/cap_1/attachments/scan{"token"}.pdf',
  ])('rejects unsafe artifact path %s', async (unsafePath) => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-unsafe-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput(`evt_unsafe_${unsafePath.length}`),
    })

    await expect(
      updateAssistantInputAttachmentEvidence({
        inputId: input.inputId,
        vault: vaultRoot,
        attachmentEvidence: {
          attachments: [
            {
              descriptorAttachmentId: 'att_descriptor',
              derived: null,
              fileName: 'scan.pdf',
              inlineFragments: [],
              kind: 'document',
              mime: 'application/pdf',
              ordinal: 1,
              parseState: 'failed',
              raw: {
                kind: 'vault-relative-file',
                path: unsafePath,
                mediaType: 'application/pdf',
                byteSize: null,
                sha256: null,
              },
              sourceAttachmentId: 'att_source',
            },
          ],
          optionalInboxCaptureId: 'cap_1',
          reasonCode: null,
          source: 'manual',
          status: 'partial',
          updatedAt: null,
        },
      }),
    ).rejects.toThrow(/artifact/u)
  })

  it('accepts structurally safe raw inbox paths with ordinary sensitive-looking filenames', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-safe-raw-path-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput('evt_safe_raw_path_filename'),
    })

    const updated = await updateAssistantInputAttachmentEvidence({
      inputId: input.inputId,
      vault: vaultRoot,
      attachmentEvidence: {
        attachments: [
          {
            descriptorAttachmentId: 'att_descriptor',
            derived: null,
            fileName: 'api-key.pdf',
            inlineFragments: [],
            kind: 'document',
            mime: 'application/pdf',
            ordinal: 1,
            parseState: null,
            raw: {
              byteSize: null,
              kind: 'vault-relative-file',
              mediaType: 'application/pdf',
              path: 'raw/inbox/cap_1/attachments/api-key.pdf',
              sha256: null,
            },
            sourceAttachmentId: 'att_source',
          },
        ],
        optionalInboxCaptureId: 'cap_1',
        reasonCode: null,
        source: 'manual',
        status: 'available',
        updatedAt: null,
      },
    })

    expect(updated.attachmentEvidence.attachments[0]?.raw?.path).toBe(
      'raw/inbox/cap_1/attachments/api-key.pdf',
    )
  })

  it('rejects raw provider payload inline attachment evidence text', async () => {
    const unsafeText = '{"model":"gpt","messages":[{"role":"user","content":"hello"}]}'
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-inline-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput(`evt_inline_${unsafeText.length}`),
    })

    await expect(
      updateAssistantInputAttachmentEvidence({
        inputId: input.inputId,
        vault: vaultRoot,
        attachmentEvidence: {
          attachments: [
            {
              descriptorAttachmentId: 'att_descriptor',
              derived: null,
              fileName: 'scan.pdf',
              inlineFragments: [
                {
                  kind: 'derived_plain_text',
                  label: 'derived-plain-text',
                  text: unsafeText,
                  truncated: false,
                },
              ],
              kind: 'document',
              mime: 'application/pdf',
              ordinal: 1,
              parseState: 'succeeded',
              raw: null,
              sourceAttachmentId: 'att_source',
            },
          ],
          optionalInboxCaptureId: 'cap_1',
          reasonCode: null,
          source: 'manual',
          status: 'partial',
          updatedAt: null,
        },
      }),
    ).rejects.toThrow(/attachmentEvidence\.inlineFragments\.text/u)
  })

  it('rejects oversized inline attachment evidence text', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-inline-large-',
    )
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event: createHostedMailboxEventInput('evt_inline_large'),
    })

    await expect(
      updateAssistantInputAttachmentEvidence({
        inputId: input.inputId,
        vault: vaultRoot,
        attachmentEvidence: {
          attachments: [
            {
              descriptorAttachmentId: 'att_descriptor',
              derived: null,
              fileName: 'scan.pdf',
              inlineFragments: [
                {
                  kind: 'derived_plain_text',
                  label: 'derived-plain-text',
                  text: 'x'.repeat(6_001),
                  truncated: false,
                },
              ],
              kind: 'document',
              mime: 'application/pdf',
              ordinal: 1,
              parseState: 'succeeded',
              raw: null,
              sourceAttachmentId: 'att_source',
            },
          ],
          optionalInboxCaptureId: 'cap_1',
          reasonCode: null,
          source: 'manual',
          status: 'partial',
          updatedAt: null,
        },
      }),
    ).rejects.toThrow(/bounded prompt evidence/u)
  })

  it('replays an input idempotently after attachment evidence changes', async () => {
    const { vaultRoot } = await createAssistantInputEvidenceVault(
      'assistant-input-attachment-evidence-replay-',
    )
    const event = createHostedMailboxEventInput('evt_replay')
    const input = await upsertAssistantInputEvent({
      vault: vaultRoot,
      event,
    })
    const updated = await updateAssistantInputAttachmentEvidence({
      inputId: input.inputId,
      vault: vaultRoot,
      attachmentEvidence: {
        attachments: [],
        optionalInboxCaptureId: null,
        reasonCode: 'attachment.evidence_unavailable',
        source: 'hosted-inbox-projection',
        status: 'failed',
        updatedAt: null,
      },
    })

    await expect(
      upsertAssistantInputEvent({
        vault: vaultRoot,
        event,
      }),
    ).resolves.toEqual(updated)
  })
})

async function createAssistantInputEvidenceVault(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return context
}

function createHostedMailboxEventInput(eventId: string) {
  return {
    content: {
      text: 'attachment evidence test',
    },
    occurredAt: '2026-04-22T10:00:00.000Z',
    sourceRef: {
      dedupeKey: eventId,
      eventId,
      itemId: `${eventId}_item`,
      kind: 'hosted-mailbox' as const,
      lane: 'conversation' as const,
      laneSeq: '1',
      payloadSchema: 'murph.test-payload.v1',
      payloadSource: 'inline' as const,
      source: 'hosted-mailbox' as const,
      wakeSchema: 'murph.hosted-execution-wake.v1',
    },
  }
}

function createDuplicateAttachmentEvidence(
  fieldName: 'descriptorAttachmentId' | 'ordinal' | 'sourceAttachmentId',
): AssistantInputAttachmentEvidence {
  const first = createEvidenceAttachment({
    descriptorAttachmentId: 'att_descriptor_1',
    ordinal: 1,
    sourceAttachmentId: 'att_source_1',
  })
  const second = createEvidenceAttachment({
    descriptorAttachmentId:
      fieldName === 'descriptorAttachmentId' ? 'att_descriptor_1' : 'att_descriptor_2',
    ordinal: fieldName === 'ordinal' ? 1 : 2,
    sourceAttachmentId:
      fieldName === 'sourceAttachmentId' ? 'att_source_1' : 'att_source_2',
  })

  return {
    attachments: [first, second],
    optionalInboxCaptureId: 'cap_1',
    reasonCode: null,
    source: 'manual',
    status: 'available',
    updatedAt: null,
  }
}

function createEvidenceAttachment(input: {
  descriptorAttachmentId: string
  ordinal: number
  sourceAttachmentId: string
}): AssistantInputAttachmentEvidence['attachments'][number] {
  return {
    byteSize: 128,
    descriptorAttachmentId: input.descriptorAttachmentId,
    derived: null,
    fileName: null,
    inlineFragments: [],
    kind: 'document',
    mime: 'application/pdf',
    ordinal: input.ordinal,
    parseState: 'succeeded',
    raw: {
      byteSize: 128,
      kind: 'vault-relative-file',
      mediaType: 'application/pdf',
      path: `raw/inbox/cap_1/attachments/${String(input.ordinal).padStart(2, '0')}__scan.pdf`,
      sha256: null,
    },
    sourceAttachmentId: input.sourceAttachmentId,
  }
}
