import { describe, expect, it } from 'vitest'
import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  type InboxCaptureAttachmentLike,
} from '../src/assistant/inbox-attachment-evidence.ts'

describe('inbox attachment evidence adapter', () => {
  it('converts safe inbox raw artifacts into assistant input attachment evidence', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_1',
        attachments: [
          createAttachment({
            attachmentId: 'att_1',
            derivedPath: 'derived/inbox/cap_1/attachments/att_1/manifest.json',
            extractedText: 'Parsed text.',
            fileName: 'scan.pdf',
            kind: 'document',
            mime: 'application/pdf',
            parseState: 'succeeded',
            sha256: 'a'.repeat(64),
            storedPath: 'raw/inbox/cap_1/attachments/01__scan.pdf',
          }),
        ],
      },
      descriptorAttachmentIdForAttachment: () => 'descriptor_att_1',
      now: '2026-04-22T10:00:00.000Z',
      source: 'local-inbox-import',
    })

    expect(evidence).toMatchObject({
      optionalInboxCaptureId: 'cap_1',
      reasonCode: null,
      source: 'local-inbox-import',
      status: 'available',
      updatedAt: '2026-04-22T10:00:00.000Z',
    })
    expect(evidence.attachments).toEqual([
      expect.objectContaining({
        descriptorAttachmentId: 'descriptor_att_1',
        derived: null,
        inlineFragments: [],
        fileName: 'scan.pdf',
        parseState: null,
        raw: {
          byteSize: 1234,
          kind: 'vault-relative-file',
          mediaType: 'application/pdf',
          path: 'raw/inbox/cap_1/attachments/01__scan.pdf',
          sha256: 'a'.repeat(64),
        },
        sourceAttachmentId: 'att_1',
      }),
    ])
  })

  it('keeps metadata-only evidence partial when imported capture attachments have no stored artifacts yet', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_1',
        attachments: [
          createAttachment({
            externalId: 'provider_photo_1',
            fileName: 'photo.jpg',
            kind: 'image',
            mime: 'image/jpeg',
            storedPath: null,
          }),
        ],
      },
      source: 'local-inbox-import',
    })

    expect(evidence.status).toBe('partial')
    expect(evidence.reasonCode).toBe('attachment.evidence_partial')
    expect(evidence.attachments[0]).toMatchObject({
      fileName: 'photo.jpg',
      kind: 'image',
      mime: 'image/jpeg',
      parseState: null,
      raw: null,
      sourceAttachmentId: 'att_1',
    })
  })

  it('marks raw unsupported attachments as available evidence without making them parser failures', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_zip',
        attachments: [
          createAttachment({
            attachmentId: 'att_zip',
            byteSize: 42,
            fileName: 'archive.zip',
            kind: 'other',
            mime: 'application/zip',
            storedPath: 'raw/inbox/cap_zip/attachments/001__archive.zip',
          }),
        ],
      },
      source: 'local-inbox-import',
    })

    expect(evidence.status).toBe('available')
    expect(evidence.reasonCode).toBeNull()
    expect(evidence.attachments[0]).toMatchObject({
      byteSize: 42,
      kind: 'other',
      mime: 'application/zip',
      parseState: 'unsupported',
      raw: {
        byteSize: 42,
        kind: 'vault-relative-file',
        mediaType: 'application/zip',
        path: 'raw/inbox/cap_zip/attachments/001__archive.zip',
      },
    })
  })

  it('does not carry parser lifecycle state for images', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_image',
        attachments: [
          createAttachment({
            attachmentId: 'att_image',
            byteSize: 64,
            fileName: 'photo.jpg',
            kind: 'image',
            mime: 'image/jpeg',
            parseState: 'unsupported',
            storedPath: 'raw/inbox/cap_image/attachments/001__photo.jpg',
          }),
        ],
      },
      source: 'local-inbox-import',
    })

    expect(evidence.status).toBe('available')
    expect(evidence.reasonCode).toBeNull()
    expect(evidence.attachments[0]).toMatchObject({
      kind: 'image',
      mime: 'image/jpeg',
      parseState: null,
      raw: {
        byteSize: 64,
        kind: 'vault-relative-file',
        mediaType: 'image/jpeg',
        path: 'raw/inbox/cap_image/attachments/001__photo.jpg',
      },
    })
  })

  it('keeps unsupported metadata-only attachments partial with explicit unsupported parse state', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_zip',
        attachments: [
          createAttachment({
            attachmentId: 'att_zip',
            fileName: 'archive.zip',
            kind: 'other',
            mime: 'application/zip',
            storedPath: null,
          }),
        ],
      },
      source: 'local-inbox-import',
    })

    expect(evidence.status).toBe('partial')
    expect(evidence.reasonCode).toBe('attachment.evidence_partial')
    expect(evidence.attachments[0]).toMatchObject({
      kind: 'other',
      parseState: 'unsupported',
      raw: null,
    })
  })

  it('marks mixed materialized and metadata-only attachments as partial evidence', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_1',
        attachments: [
          createAttachment({
            attachmentId: 'att_ready',
            extractedText: 'Parsed attachment text.',
            storedPath: 'raw/inbox/cap_1/attachments/01__report.txt',
          }),
          createAttachment({
            attachmentId: 'att_waiting',
            kind: 'image',
            mime: 'image/png',
            storedPath: null,
          }),
        ],
      },
      source: 'local-parser-drain',
    })

    expect(evidence.status).toBe('partial')
    expect(evidence.reasonCode).toBe('attachment.evidence_partial')
    expect(evidence.attachments[0]?.inlineFragments).toHaveLength(0)
    expect(evidence.attachments[1]).toMatchObject({
      inlineFragments: [],
      raw: null,
    })
  })

  it('caps attachment evidence at the input schema limit and marks overflow partial', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_many',
        attachments: Array.from({ length: 33 }, (_, index) => {
          const ordinal = index + 1
          return createAttachment({
            attachmentId: `att_${ordinal}`,
            fileName: `attachment-${ordinal}.txt`,
            ordinal,
            storedPath:
              `raw/inbox/cap_many/attachments/${String(ordinal).padStart(3, '0')}.txt`,
          })
        }),
      },
      source: 'local-inbox-import',
    })

    expect(evidence.status).toBe('partial')
    expect(evidence.reasonCode).toBe('attachment.evidence_partial.attachment_limit')
    expect(evidence.attachments).toHaveLength(32)
    expect(evidence.attachments.at(0)?.sourceAttachmentId).toBe('att_1')
    expect(evidence.attachments.at(-1)?.sourceAttachmentId).toBe('att_32')
  })

  it('omits unsafe identifiers, filenames, and inline text without dropping safe raw paths', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_1',
        attachments: [
          createAttachment({
            attachmentId: 'https://provider.example/token',
            derivedPath: 'derived/inbox/cap_1/attachments/api-key/manifest.json',
            extractedText: 'Authorization: Bearer secret',
            fileName: '../secret.pdf',
            kind: 'document',
            mime: 'application/pdf',
            storedPath: 'raw/inbox/cap_1/attachments/report.pdf',
          }),
        ],
      },
      source: 'manual',
    })

    expect(evidence.status).toBe('available')
    expect(evidence.attachments[0]).toMatchObject({
      derived: null,
      descriptorAttachmentId: 'attachment-1',
      fileName: null,
      inlineFragments: [],
      raw: {
        kind: 'vault-relative-file',
        path: 'raw/inbox/cap_1/attachments/report.pdf',
      },
      sourceAttachmentId: 'attachment-1',
    })
  })

  it('preserves parser output evidence for audio attachments', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_1',
        attachments: [
          createAttachment({
            attachmentId: 'att_audio',
            derivedPath: 'derived/inbox/cap_1/attachments/att_audio/manifest.json',
            kind: 'audio',
            mime: 'audio/mpeg',
            parseState: 'succeeded',
            storedPath: 'raw/inbox/cap_1/attachments/01__voice.mp3',
            transcriptText: 'x'.repeat(6_500),
          }),
        ],
      },
      source: 'local-parser-drain',
    })

    expect(evidence.attachments[0]).toMatchObject({
      derived: {
        allowedRoot: 'derived/inbox/cap_1/attachments/att_audio',
        kind: 'parser-manifest',
        manifestPath: 'derived/inbox/cap_1/attachments/att_audio/manifest.json',
      },
      parseState: 'succeeded',
    })
    expect(evidence.attachments[0]?.inlineFragments[0]).toMatchObject({
      text: 'x'.repeat(6_000),
      truncated: true,
    })
  })
})

function createAttachment(
  input: Partial<InboxCaptureAttachmentLike> = {},
): InboxCaptureAttachmentLike {
  return {
    attachmentId: input.attachmentId ?? 'att_1',
    byteSize: input.byteSize ?? 1234,
    derivedPath: input.derivedPath ?? null,
    externalId: input.externalId ?? null,
    extractedText: input.extractedText ?? null,
    fileName: input.fileName ?? 'attachment.txt',
    kind: input.kind ?? 'document',
    mime: input.mime === undefined ? 'text/plain' : input.mime,
    ordinal: input.ordinal ?? 1,
    originalPath: input.originalPath ?? null,
    parseState: input.parseState ?? null,
    parserProviderId: input.parserProviderId ?? null,
    sha256: input.sha256 ?? null,
    storedPath: input.storedPath ?? null,
    transcriptText: input.transcriptText ?? null,
  }
}
