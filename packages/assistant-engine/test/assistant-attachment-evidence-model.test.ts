import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAssistantInputAttachmentModelBundle,
  hasAssistantInputAttachmentEvidenceCandidate,
  prepareAssistantInputMultimodalUserMessageContent,
} from '../src/assistant/attachment-evidence-model.ts'
import type { AssistantInputAttachmentEvidenceItem } from '../src/assistant/input-store.ts'

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

describe('assistant input attachment evidence model materialization', () => {
  it('reads image evidence from a safe vault-relative raw artifact and emits multimodal content', async () => {
    const vaultRoot = await createTempVaultRoot()
    const imagePath = 'raw/inbox/capture-1/attachments/01__meal.jpg'
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
    await writeVaultFile(vaultRoot, imagePath, imageBytes)

    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        rawPath: imagePath,
      }),
      vaultRoot,
    })

    expect(hasAssistantInputAttachmentEvidenceCandidate(bundle)).toBe(true)
    expect(bundle.routingImage).toMatchObject({
      eligible: true,
      mediaType: 'image/jpeg',
      reason: 'supported-format',
    })

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [bundle],
      prompt: 'Look at this image.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('multimodal')
    expect(prepared.fallbackError).toBe(null)
    expect(prepared.userMessageContent?.[0]).toEqual({
      type: 'text',
      text: 'Look at this image.',
    })
    expect(prepared.userMessageContent?.some((part) => part.type === 'image')).toBe(true)
  })

  it('keeps PDF raw artifact refs as inspectable local filesystem metadata without forcing multimodal input', async () => {
    const vaultRoot = await createTempVaultRoot()
    const pdfPath = 'raw/inbox/capture-1/attachments/01__scan.pdf'
    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: createAttachmentEvidence({
        kind: 'document',
        mime: 'application/pdf',
        rawPath: pdfPath,
      }),
      vaultRoot,
    })

    expect(hasAssistantInputAttachmentEvidenceCandidate(bundle)).toBe(false)
    expect(bundle.combinedText).toContain(`storedPath: ${pdfPath}`)

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [bundle],
      prompt: 'Read this PDF.',
      vaultRoot,
    })

    expect(prepared).toEqual({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })
  })

  it('preserves unsupported parse state in the materialized bundle metadata', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: {
        ...createAttachmentEvidence({
          kind: 'audio',
          mime: 'audio/mp4',
          rawPath: 'raw/inbox/capture-1/attachments/voice-note.m4a',
        }),
        parseState: 'unsupported',
      },
      vaultRoot,
    })

    expect(bundle.parseState).toBe('unsupported')
    expect(bundle.combinedText).toContain('parseState: unsupported')
  })

  it('falls back to text-only mode when image bytes are missing', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        rawPath: 'raw/inbox/capture-1/attachments/missing.jpg',
      }),
      vaultRoot,
    })
    const failures: unknown[] = []

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [bundle],
      onEvidenceReadFailure(failure) {
        failures.push(failure)
      },
      prompt: 'Missing image.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('text-only')
    expect(prepared.userMessageContent).toBe(null)
    expect(prepared.fallbackError).toContain('rich evidence could not be loaded')
    expect(prepared.fallbackError).not.toContain(vaultRoot)
    expect(prepared.fallbackError).not.toMatch(/\/(?:var|tmp|private)\//u)
    expect(failures).toEqual([
      expect.objectContaining({
        attachmentOrdinal: 1,
        details: 'attachment 1 image evidence unavailable',
        errorCode: 'image_read_failed',
        kind: 'image',
      }),
    ])
  })

  it('ignores invalid raw image paths before reading filesystem bytes', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        rawPath: '/tmp/not-a-vault-artifact.jpg',
      }),
      vaultRoot,
    })
    const failures: unknown[] = []

    expect(bundle.storedPath).toBe(null)
    expect(bundle.routingImage).toMatchObject({
      eligible: false,
      reason: 'stored-path-missing',
    })

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [bundle],
      onEvidenceReadFailure(failure) {
        failures.push(failure)
      },
      prompt: 'Invalid image path.',
      vaultRoot,
    })

    expect(prepared).toEqual({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })
    expect(failures).toEqual([])
  })

  it('reads derived parser manifest text only from the declared allowed root', async () => {
    const vaultRoot = await createTempVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/att-1/manifest.json',
      Buffer.from(JSON.stringify({
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: 'derived/inbox/capture-1/attachments/att-1/plain.txt',
          markdownPath: 'derived/inbox/capture-1/attachments/att-1/plain.md',
          tablesPath: null,
        },
      })),
    )
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/att-1/plain.txt',
      Buffer.from('Plain parser text.'),
    )
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/att-1/plain.md',
      Buffer.from('Markdown parser text.'),
    )

    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: {
        ...createAttachmentEvidence({
          kind: 'document',
          mime: 'application/pdf',
          rawPath: 'raw/inbox/capture-1/attachments/scan.pdf',
        }),
        derived: {
          allowedRoot: 'derived/inbox/capture-1/attachments/att-1',
          kind: 'parser-manifest',
          manifestPath: 'derived/inbox/capture-1/attachments/att-1/manifest.json',
        },
      },
      vaultRoot,
    })

    expect(bundle.combinedText).toContain('Plain parser text.')
    expect(bundle.combinedText).toContain('Markdown parser text.')
  })

  it('ignores derived parser manifest output paths outside the declared allowed root', async () => {
    const vaultRoot = await createTempVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/att-1/manifest.json',
      Buffer.from(JSON.stringify({
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: 'derived/inbox/capture-1/attachments/att-2/plain.txt',
          markdownPath: 'derived/inbox/capture-1/attachments/att-1/plain.md',
          tablesPath: null,
        },
      })),
    )
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/att-2/plain.txt',
      Buffer.from('Outside allowed root text.'),
    )
    await writeVaultFile(
      vaultRoot,
      'derived/inbox/capture-1/attachments/att-1/plain.md',
      Buffer.from('Inside allowed root markdown.'),
    )

    const bundle = await buildAssistantInputAttachmentModelBundle({
      attachment: {
        ...createAttachmentEvidence({
          kind: 'document',
          mime: 'application/pdf',
          rawPath: 'raw/inbox/capture-1/attachments/scan.pdf',
        }),
        derived: {
          allowedRoot: 'derived/inbox/capture-1/attachments/att-1',
          kind: 'parser-manifest',
          manifestPath: 'derived/inbox/capture-1/attachments/att-1/manifest.json',
        },
      },
      vaultRoot,
    })

    expect(bundle.combinedText).not.toContain('Outside allowed root text.')
    expect(bundle.combinedText).toContain('Inside allowed root markdown.')
  })
})

async function createTempVaultRoot(): Promise<string> {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-attachment-evidence-model-'))
  const vaultRoot = path.join(parentRoot, 'vault')
  await mkdir(vaultRoot, { recursive: true })
  tempRoots.push(parentRoot)
  return vaultRoot
}

async function writeVaultFile(vaultRoot: string, relativePath: string, bytes: Buffer): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, bytes)
}

function createAttachmentEvidence(input: {
  kind: AssistantInputAttachmentEvidenceItem['kind']
  mime: string
  rawPath: string
}): AssistantInputAttachmentEvidenceItem {
  return {
    byteSize: null,
    derived: null,
    descriptorAttachmentId: 'att_descriptor',
    fileName: path.posix.basename(input.rawPath),
    inlineFragments: [],
    kind: input.kind,
    mime: input.mime,
    ordinal: 1,
    parseState: 'failed',
    raw: {
      byteSize: null,
      kind: 'vault-relative-file',
      mediaType: input.mime,
      path: input.rawPath,
      sha256: null,
    },
    sourceAttachmentId: 'att_source',
  }
}
