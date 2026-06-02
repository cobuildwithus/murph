import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAssistantInputAttachmentPromptBundle,
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
    const materializeWorkspaceArtifacts = vi.fn(async () => ({
      materializedArtifactPaths: new Set([`vault:${imagePath}`]),
      missingArtifactPaths: new Set<string>(),
    }))
    await writeVaultFile(vaultRoot, imagePath, imageBytes)

    const bundle = await buildAssistantInputAttachmentPromptBundle({
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
    expect(bundle.fileName).toBe('01__meal.jpg')
    expect(bundle.combinedText).toContain('fileName: 01__meal.jpg')
    expect(bundle.combinedText).not.toContain('attachmentId:')

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [bundle],
      materializeWorkspaceArtifacts,
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
    expect(prepared.userMessageContent).toContainEqual({
      type: 'text',
      text: 'Attachment image 1 (01__meal.jpg).',
    })
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([imagePath])
  })

  it('uses preserved filenames when deciding image routing eligibility', async () => {
    const vaultRoot = await createTempVaultRoot()
    const imagePath = 'raw/inbox/capture-1/attachments/001'
    await writeVaultFile(vaultRoot, imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: {
        ...createAttachmentEvidence({
          kind: 'image',
          mime: 'application/octet-stream',
          rawPath: imagePath,
        }),
        fileName: 'meal.png',
      },
      vaultRoot,
    })

    expect(bundle.fileName).toBe('meal.png')
    expect(bundle.routingImage).toMatchObject({
      eligible: true,
      mediaType: 'image/png',
      reason: 'supported-format',
    })
  })

  it.each([
    {
      mime: null,
      mediaType: 'image/jpeg',
      rawPath: 'raw/inbox/capture-1/attachments/001.jpg',
    },
    {
      mime: 'application/octet-stream',
      mediaType: 'image/png',
      rawPath: 'raw/inbox/capture-1/attachments/001.png',
    },
  ])('infers routable image evidence from inbox extension for $rawPath', async ({
    mediaType,
    mime,
    rawPath,
  }) => {
    const vaultRoot = await createTempVaultRoot()
    await writeVaultFile(vaultRoot, rawPath, Buffer.from([0xff, 0xd8, 0xff]))

    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime,
        rawPath,
      }),
      vaultRoot,
    })

    expect(hasAssistantInputAttachmentEvidenceCandidate(bundle)).toBe(true)
    expect(bundle.routingImage).toMatchObject({
      eligible: true,
      mediaType,
      reason: 'supported-format',
    })

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [bundle],
      prompt: 'Look at this image.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('multimodal')
    expect(prepared.userMessageContent?.some((part) => part.type === 'image')).toBe(true)
  })

  it.each([
    'raw/inbox/capture-1/attachments/001.pdf',
    'raw/inbox/capture-1/attachments/01__scan.pdf',
  ])('keeps PDF raw artifact ref %s as inspectable local filesystem metadata without forcing multimodal input', async (pdfPath) => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentPromptBundle({
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

  it('keeps raw inbox artifact paths even when filenames look sensitive', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'document',
        mime: 'application/pdf',
        rawPath: 'raw/inbox/capture-1/attachments/api-key.pdf',
      }),
      vaultRoot,
    })

    expect(bundle.storedPath).toBe('raw/inbox/capture-1/attachments/api-key.pdf')
    expect(bundle.combinedText).toContain(
      'raw/inbox/capture-1/attachments/api-key.pdf',
    )
    expect(bundle.combinedText).not.toContain('storedPath: missing')
  })

  it('preserves unsupported parse state in the materialized bundle metadata', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentPromptBundle({
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
    const bundle = await buildAssistantInputAttachmentPromptBundle({
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

  it('preserves input ids on attachment read failures for paired sources', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        rawPath: 'raw/inbox/capture-1/attachments/missing.jpg',
      }),
      vaultRoot,
    })
    const failures: unknown[] = []

    await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [
        {
          bundle,
          inputId: 'event-2',
        },
      ],
      onEvidenceReadFailure(failure) {
        failures.push(failure)
      },
      prompt: 'Missing image.',
      vaultRoot,
    })

    expect(failures).toEqual([
      expect.objectContaining({
        attachmentOrdinal: 1,
        errorCode: 'image_read_failed',
        inputId: 'event-2',
        kind: 'image',
      }),
    ])
  })

  it('keeps available images and adds a prompt note when another image is missing', async () => {
    const vaultRoot = await createTempVaultRoot()
    const availablePath = 'raw/inbox/capture-1/attachments/01__meal.jpg'
    await writeVaultFile(vaultRoot, availablePath, Buffer.from([0xff, 0xd8, 0xff]))
    const availableBundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        ordinal: 1,
        rawPath: availablePath,
      }),
      vaultRoot,
    })
    const missingBundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        ordinal: 2,
        rawPath: 'raw/inbox/capture-1/attachments/02__missing.jpg',
      }),
      vaultRoot,
    })
    const failures: unknown[] = []

    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: [availableBundle, missingBundle],
      onEvidenceReadFailure(failure) {
        failures.push(failure)
      },
      prompt: 'Review both images.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('multimodal')
    expect(prepared.fallbackError).toBe(null)
    expect(prepared.userMessageContent).toEqual([
      {
        type: 'text',
        text: 'Review both images.',
      },
      {
        type: 'text',
        text: 'Some image attachments could not be loaded; only available image evidence was attached.',
      },
      {
        type: 'text',
        text: 'Attachment image 1 (01__meal.jpg).',
      },
      expect.objectContaining({
        type: 'image',
        mediaType: 'image/jpeg',
      }),
    ])
    expect(failures).toEqual([
      expect.objectContaining({
        attachmentOrdinal: 2,
        errorCode: 'image_read_failed',
        kind: 'image',
      }),
    ])
  })

  it('ignores invalid raw image paths before reading filesystem bytes', async () => {
    const vaultRoot = await createTempVaultRoot()
    const bundle = await buildAssistantInputAttachmentPromptBundle({
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
    const materializeWorkspaceArtifacts = vi.fn(async () => ({
      materializedArtifactPaths: new Set<string>(),
      missingArtifactPaths: new Set<string>(),
    }))
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

    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: {
        ...createAttachmentEvidence({
          kind: 'audio',
          mime: 'audio/mpeg',
          rawPath: 'raw/inbox/capture-1/attachments/voice-note.mp3',
        }),
        parseState: 'succeeded',
        derived: {
          allowedRoot: 'derived/inbox/capture-1/attachments/att-1',
          kind: 'parser-manifest',
          manifestPath: 'derived/inbox/capture-1/attachments/att-1/manifest.json',
        },
      },
      materializeWorkspaceArtifacts,
      vaultRoot,
    })

    expect(bundle.combinedText).toContain('Plain parser text.')
    expect(bundle.combinedText).toContain('Markdown parser text.')
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([
      'derived/inbox/capture-1/attachments/att-1/manifest.json',
    ])
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([
      'derived/inbox/capture-1/attachments/att-1/plain.txt',
    ])
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([
      'derived/inbox/capture-1/attachments/att-1/plain.md',
    ])
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

    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: {
        ...createAttachmentEvidence({
          kind: 'audio',
          mime: 'audio/mpeg',
          rawPath: 'raw/inbox/capture-1/attachments/voice-note.mp3',
        }),
        parseState: 'succeeded',
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
  mime: string | null
  ordinal?: number
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
    ordinal: input.ordinal ?? 1,
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
