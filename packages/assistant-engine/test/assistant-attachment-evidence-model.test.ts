import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAssistantInputAttachmentPromptBundle,
  buildAssistantInputAttachmentPromptBundles,
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
    expect(prepared.userMessageContent).toContainEqual({
      detail: 'original',
      image: imageBytes,
      mediaType: 'image/jpeg',
      mimeType: 'image/jpeg',
      type: 'image',
    })
    expect(prepared.userMessageContent).toContainEqual({
      type: 'text',
      text: 'Attachment image 1 (01__meal.jpg).',
    })
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([imagePath])
  })

  it('keeps image galleries at high detail to bound visual input cost', async () => {
    const vaultRoot = await createTempVaultRoot()
    const firstImagePath = 'raw/inbox/capture-1/attachments/01__first.jpg'
    const secondImagePath = 'raw/inbox/capture-1/attachments/02__second.jpg'
    await writeVaultFile(
      vaultRoot,
      firstImagePath,
      Buffer.from([0xff, 0xd8, 0xff, 0x01]),
    )
    await writeVaultFile(
      vaultRoot,
      secondImagePath,
      Buffer.from([0xff, 0xd8, 0xff, 0x02]),
    )

    const bundles = await buildAssistantInputAttachmentPromptBundles({
      attachments: [
        createAttachmentEvidence({
          kind: 'image',
          mime: 'image/jpeg',
          ordinal: 1,
          rawPath: firstImagePath,
        }),
        createAttachmentEvidence({
          kind: 'image',
          mime: 'image/jpeg',
          ordinal: 2,
          rawPath: secondImagePath,
        }),
      ],
      vaultRoot,
    })
    const prepared = await prepareAssistantInputMultimodalUserMessageContent({
      attachmentSources: bundles,
      prompt: 'Compare these images.',
      vaultRoot,
    })

    expect((prepared.userMessageContent ?? []).flatMap((part) =>
      part.type === 'image' ? [part.detail] : [],
    )).toEqual(['high', 'high'])
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

  it('keeps raw evidence when derived text materialization fails', async () => {
    const vaultRoot = await createTempVaultRoot()
    const imagePath = 'raw/inbox/capture-1/attachments/meal.jpg'
    const audioPath = 'raw/inbox/capture-1/attachments/voice-note.m4a'
    await writeVaultFile(vaultRoot, imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]))
    await writeVaultFile(vaultRoot, audioPath, Buffer.from([1, 2, 3]))
    const evidenceReadFailures: unknown[] = []

    const materializeWorkspaceArtifacts = vi.fn(async (paths: readonly string[]) => {
      if (paths.includes('derived/inbox/capture-1/attachments/att-2/manifest.json')) {
        throw new Error('derived manifest unavailable')
      }
      return {
        materializedArtifactPaths: new Set(paths.map((item) => `vault:${item}`)),
        missingArtifactPaths: new Set<string>(),
      }
    })

    const bundles = await buildAssistantInputAttachmentPromptBundles({
      attachments: [
        createAttachmentEvidence({
          kind: 'image',
          mime: 'image/jpeg',
          ordinal: 1,
          rawPath: imagePath,
        }),
        {
          ...createAttachmentEvidence({
            kind: 'audio',
            mime: 'audio/m4a',
            ordinal: 2,
            rawPath: audioPath,
          }),
          parseState: 'succeeded',
          derived: {
            allowedRoot: 'derived/inbox/capture-1/attachments/att-2',
            kind: 'parser-manifest',
            manifestPath: 'derived/inbox/capture-1/attachments/att-2/manifest.json',
          },
        },
      ],
      materializeWorkspaceArtifacts,
      onEvidenceReadFailure: (failure) => evidenceReadFailures.push(failure),
      vaultRoot,
    })

    expect(bundles).toHaveLength(2)
    expect(bundles[0]).toMatchObject({
      kind: 'image',
      ordinal: 1,
      storedPath: imagePath,
      routingImage: {
        eligible: true,
        reason: 'supported-format',
      },
    })
    expect(bundles[1]).toMatchObject({
      kind: 'audio',
      ordinal: 2,
      parseState: 'succeeded',
      storedPath: audioPath,
      routingImage: {
        eligible: false,
        reason: 'not-image',
      },
    })
    expect(bundles[1]?.fragments).toEqual([
      expect.objectContaining({
        kind: 'attachment_metadata',
      }),
    ])
    expect(bundles[1]?.combinedText).toContain(`storedPath: ${audioPath}`)
    expect(bundles[1]?.combinedText).not.toContain('derived-plain-text')
    expect(evidenceReadFailures).toEqual([
      {
        attachmentOrdinal: 2,
        details: 'attachment 2 derived evidence unavailable',
        errorCode: 'derived_read_failed',
        kind: 'derived',
      },
    ])
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
    await writeVaultFile(vaultRoot, pdfPath, Buffer.from('%PDF-1.7\nfixture'))
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
    const rawPath = 'raw/inbox/capture-1/attachments/api-key.pdf'
    await writeVaultFile(vaultRoot, rawPath, Buffer.from('%PDF-1.7\nfixture'))
    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'document',
        mime: 'application/pdf',
        rawPath,
      }),
      vaultRoot,
    })

    expect(bundle.storedPath).toBe(rawPath)
    expect(bundle.combinedText).toContain(rawPath)
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

  it('marks already-missing raw image bytes unavailable before multimodal preparation', async () => {
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
      prompt: 'Missing image.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('text-only')
    expect(prepared.userMessageContent).toBe(null)
    expect(prepared.fallbackError).toBe(null)
    expect(failures).toEqual([])
  })

  it('preserves input ids on attachment read failures for paired sources', async () => {
    const vaultRoot = await createTempVaultRoot()
    const rawPath = 'raw/inbox/capture-1/attachments/missing.jpg'
    await writeVaultFile(vaultRoot, rawPath, Buffer.from([0xff, 0xd8, 0xff]))
    const bundle = await buildAssistantInputAttachmentPromptBundle({
      attachment: createAttachmentEvidence({
        kind: 'image',
        mime: 'image/jpeg',
        rawPath,
      }),
      vaultRoot,
    })
    await rm(path.join(vaultRoot, rawPath))
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
    const missingPath = 'raw/inbox/capture-1/attachments/02__missing.jpg'
    await writeVaultFile(vaultRoot, availablePath, Buffer.from([0xff, 0xd8, 0xff]))
    await writeVaultFile(vaultRoot, missingPath, Buffer.from([0xff, 0xd8, 0xff]))
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
        rawPath: missingPath,
      }),
      vaultRoot,
    })
    await rm(path.join(vaultRoot, missingPath))
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

  it('reads the current versioned parser result bundle', async () => {
    const vaultRoot = await createTempVaultRoot()
    const resultPath =
      'derived/inbox/capture-1/attachments/att-1/attempts/0001/result.json'
    await writeVaultFile(
      vaultRoot,
      resultPath,
      Buffer.from(JSON.stringify(createParserResult())),
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
          allowedRoot:
            'derived/inbox/capture-1/attachments/att-1/attempts/0001',
          kind: 'parser-result',
          resultPath,
        },
      },
      vaultRoot,
    })

    expect(bundle.combinedText).toContain('Plain parser text.')
    expect(bundle.combinedText).toContain('Markdown parser text.')
    expect(bundle.combinedText).toContain('Table cell')
  })

  it('loads parser results sequentially within one per-turn derived evidence budget', async () => {
    const vaultRoot = await createTempVaultRoot()
    const text = 'x'.repeat(8 * 1024 * 1024)
    const markdown = 'm'.repeat(4 * 1024 * 1024)
    const attachments: AssistantInputAttachmentEvidenceItem[] = []
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const captureId = `capture-${ordinal}`
      const attachmentId = `att-${ordinal}`
      const attemptRoot =
        `derived/inbox/${captureId}/attachments/${attachmentId}/attempts/0001`
      const resultPath = `${attemptRoot}/result.json`
      await writeVaultFile(
        vaultRoot,
        resultPath,
        Buffer.from(JSON.stringify(createParserResult({
          attachmentId,
          captureId,
          markdown,
          text,
        }))),
      )
      attachments.push({
        ...createAttachmentEvidence({
          kind: 'audio',
          mime: 'audio/mpeg',
          ordinal,
          rawPath: `raw/inbox/${captureId}/attachments/voice-note.mp3`,
        }),
        parseState: 'succeeded',
        derived: {
          allowedRoot: attemptRoot,
          kind: 'parser-result',
          resultPath,
        },
      })
    }

    let activeMaterializations = 0
    let maxActiveMaterializations = 0
    const materializeWorkspaceArtifacts = vi.fn(async (
      _paths: readonly string[],
      _options?: { maxFileBytes?: number },
    ) => {
      activeMaterializations += 1
      maxActiveMaterializations = Math.max(maxActiveMaterializations, activeMaterializations)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeMaterializations -= 1
      return {
        materializedArtifactPaths: new Set<string>(),
        missingArtifactPaths: new Set<string>(),
      }
    })

    const bundles = await buildAssistantInputAttachmentPromptBundles({
      attachments,
      materializeWorkspaceArtifacts,
      vaultRoot,
    })

    expect(bundles).toHaveLength(3)
    expect(maxActiveMaterializations).toBe(1)
    expect(bundles.map((bundle) =>
      bundle.fragments.map((fragment) => fragment.kind)
    )).toEqual([
      ['attachment_metadata', 'attachment_json_summary'],
      ['attachment_metadata', 'attachment_json_summary'],
      ['attachment_metadata'],
    ])
    const materializationLimits = materializeWorkspaceArtifacts.mock.calls.map(
      (call) => call[1]?.maxFileBytes,
    ).filter((limit): limit is number => typeof limit === 'number')
    expect(materializationLimits.slice(0, 2)).toEqual([
      16 * 1024 * 1024,
      16 * 1024 * 1024,
    ])
    expect(materializationLimits[2]).toBeGreaterThan(0)
    expect(materializationLimits[2]).toBeLessThan(16 * 1024 * 1024)
  })

  it('resolves a compacted sibling result for a persisted legacy manifest reference', async () => {
    const vaultRoot = await createTempVaultRoot()
    const attemptRoot =
      'derived/inbox/capture-1/attachments/att-1/attempts/0001'
    await writeVaultFile(
      vaultRoot,
      `${attemptRoot}/manifest.json`,
      Buffer.from(JSON.stringify({
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: `${attemptRoot}/missing.txt`,
          markdownPath: `${attemptRoot}/missing.md`,
          tablesPath: null,
        },
      })),
    )
    await writeVaultFile(
      vaultRoot,
      `${attemptRoot}/result.json`,
      Buffer.from(JSON.stringify(createParserResult())),
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
          allowedRoot: attemptRoot,
          kind: 'parser-manifest',
          manifestPath: `${attemptRoot}/manifest.json`,
        },
      },
      vaultRoot,
    })

    expect(bundle.combinedText).toContain('Plain parser text.')
    expect(bundle.combinedText).toContain('Markdown parser text.')
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
    ], { maxFileBytes: 1024 * 1024 })
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([
      'derived/inbox/capture-1/attachments/att-1/plain.txt',
    ], { maxFileBytes: 16 * 1024 * 1024 })
    expect(materializeWorkspaceArtifacts).toHaveBeenCalledWith([
      'derived/inbox/capture-1/attachments/att-1/plain.md',
    ], { maxFileBytes: 16 * 1024 * 1024 })
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

function createParserResult(input: {
  attachmentId?: string
  captureId?: string
  markdown?: string
  text?: string
} = {}) {
  const attachmentId = input.attachmentId ?? 'att-1'
  const captureId = input.captureId ?? 'capture-1'
  return {
    schema: 'murph.parser-output.v1',
    providerId: 'test-provider',
    artifact: {
      attachmentId,
      captureId,
      fileName: 'voice-note.mp3',
      kind: 'audio',
      mime: 'audio/mpeg',
      storedPath: `raw/inbox/${captureId}/attachments/voice-note.mp3`,
    },
    text: input.text ?? 'Plain parser text.',
    markdown: input.markdown ?? 'Markdown parser text.',
    blocks: [],
    tables: [{
      id: 'table-1',
      rows: [['Table cell']],
    }],
    metadata: {},
    createdAt: '2026-04-08T00:00:00.000Z',
  }
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
