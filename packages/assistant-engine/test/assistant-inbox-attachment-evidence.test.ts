import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  materializeAssistantInputAttachmentRawArtifactRefs,
  type InboxCaptureAttachmentLike,
} from '../src/assistant/inbox-attachment-evidence.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true }),
  ))
})

describe('inbox attachment evidence adapter', () => {
  it('converts safe inbox attachment artifacts into assistant input attachment evidence', () => {
    const rawArtifactRefs = new Map<number, string>([
      [0, 'raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.pdf'],
    ])
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
      rawArtifactPathForAttachment: ({ index }) => rawArtifactRefs.get(index) ?? null,
      source: 'local-parser-drain',
    })

    expect(evidence).toMatchObject({
      optionalInboxCaptureId: 'cap_1',
      reasonCode: null,
      source: 'local-parser-drain',
      status: 'available',
      updatedAt: '2026-04-22T10:00:00.000Z',
    })
    expect(evidence.attachments).toEqual([
      expect.objectContaining({
        descriptorAttachmentId: 'descriptor_att_1',
        derived: {
          allowedRoot: 'derived/inbox/cap_1/attachments/att_1',
          kind: 'parser-manifest',
          manifestPath: 'derived/inbox/cap_1/attachments/att_1/manifest.json',
        },
        inlineFragments: [
          {
            kind: 'attachment_extracted_text',
            label: 'attachment-1-extracted-text',
            text: 'Parsed text.',
            truncated: false,
          },
        ],
        fileName: null,
        raw: {
          byteSize: 1234,
          kind: 'vault-relative-file',
          mediaType: 'application/pdf',
          path:
            'raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.pdf',
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
      fileName: null,
      kind: 'image',
      mime: 'image/jpeg',
      raw: null,
      sourceAttachmentId: 'att_1',
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
    expect(evidence.attachments[0]?.inlineFragments).toHaveLength(1)
    expect(evidence.attachments[1]).toMatchObject({
      inlineFragments: [],
      raw: null,
    })
  })

  it('omits unsafe paths, filenames, and inline text instead of creating invalid evidence', () => {
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
            storedPath: 'raw/inbox/cap_1/attachments/signed-url.pdf',
          }),
        ],
      },
      source: 'manual',
    })

    expect(evidence.status).toBe('partial')
    expect(evidence.attachments[0]).toMatchObject({
      derived: null,
      descriptorAttachmentId: 'attachment-1',
      fileName: null,
      inlineFragments: [],
      raw: null,
      sourceAttachmentId: 'attachment-1',
    })
  })

  it('bounds long inline fragments before storing them', () => {
    const evidence = createAssistantInputAttachmentEvidenceFromInboxCapture({
      capture: {
        captureId: 'cap_1',
        attachments: [
          createAttachment({
            extractedText: 'x'.repeat(6_500),
            storedPath: 'raw/inbox/cap_1/attachments/report.txt',
          }),
        ],
      },
      source: 'local-parser-drain',
    })

    expect(evidence.attachments[0]?.inlineFragments[0]).toMatchObject({
      text: 'x'.repeat(6_000),
      truncated: true,
    })
  })

  it('copies raw inbox artifacts to neutral assistant-input refs before evidence is stored', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-inbox-evidence-'))
    tempRoots.push(parentRoot)
    const vaultRoot = path.join(parentRoot, 'vault')
    const sourcePath = 'raw/inbox/cap_1/attachments/01__private-photo.jpg'
    await writeVaultFile(vaultRoot, sourcePath, Buffer.from('image bytes'))

    const attachments = [
      createAttachment({
        kind: 'image',
        mime: 'image/jpeg',
        storedPath: sourcePath,
      }),
    ]
    const rawArtifactRefs = await materializeAssistantInputAttachmentRawArtifactRefs({
      attachments,
      inputId: 'ain_11111111111111111111111111111111',
      vaultRoot,
    })

    expect(rawArtifactRefs.get(0)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.jpg',
    )
    await expect(readFile(path.join(vaultRoot, rawArtifactRefs.get(0)!))).resolves.toEqual(
      Buffer.from('image bytes'),
    )
  })

  it('preserves safe source extensions when MIME is missing or generic', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-inbox-evidence-'))
    tempRoots.push(parentRoot)
    const vaultRoot = path.join(parentRoot, 'vault')
    const attachments = [
      createAttachment({
        kind: 'image',
        mime: null,
        ordinal: 1,
        storedPath: 'raw/inbox/cap_1/attachments/photo.jpg',
      }),
      createAttachment({
        kind: 'document',
        mime: null,
        ordinal: 2,
        storedPath: 'raw/inbox/cap_1/attachments/scan.pdf',
      }),
      createAttachment({
        kind: 'image',
        mime: 'application/octet-stream',
        ordinal: 3,
        storedPath: 'raw/inbox/cap_1/attachments/screenshot.png',
      }),
      createAttachment({
        kind: 'image',
        mime: null,
        ordinal: 4,
        storedPath: 'raw/inbox/cap_1/attachments/archive.exe',
      }),
      createAttachment({
        kind: 'document',
        mime: null,
        ordinal: 5,
        storedPath: 'raw/inbox/cap_1/attachments/scan',
      }),
      createAttachment({
        kind: 'image',
        mime: 'application/pdf',
        ordinal: 6,
        storedPath: 'raw/inbox/cap_1/attachments/photo.jpg',
      }),
    ]
    await Promise.all(
      attachments.map((attachment, index) =>
        writeVaultFile(
          vaultRoot,
          attachment.storedPath!,
          Buffer.from(`attachment ${index + 1}`),
        ),
      ),
    )

    const rawArtifactRefs = await materializeAssistantInputAttachmentRawArtifactRefs({
      attachments,
      inputId: 'ain_11111111111111111111111111111111',
      vaultRoot,
    })

    expect(rawArtifactRefs.get(0)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/001.jpg',
    )
    expect(rawArtifactRefs.get(1)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/002.pdf',
    )
    expect(rawArtifactRefs.get(2)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/003.png',
    )
    expect(rawArtifactRefs.get(3)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/004.dat',
    )
    expect(rawArtifactRefs.get(4)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/005.bin',
    )
    expect(rawArtifactRefs.get(5)).toBe(
      'raw/assistant-input/ain_11111111111111111111111111111111/attachments/006.pdf',
    )
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

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  bytes: Buffer,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, bytes)
}
