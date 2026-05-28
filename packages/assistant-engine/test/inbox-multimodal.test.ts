import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildInboxModelAttachmentBundle,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  prepareInboxMultimodalUserMessageContent,
} from '../src/inbox-multimodal.ts'
import { MAX_NATIVE_ROUTING_IMAGE_BYTES } from '../src/inbox-routing-vision.ts'

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

describe('buildInboxModelAttachmentBundle', () => {
  it('notes that image attachments are automatically scanned for QR and barcode text', async () => {
    const bundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: 'attachment-image',
        ordinal: 1,
        kind: 'image',
        mime: 'image/jpeg',
        fileName: 'meal.jpg',
        storedPath: 'raw/inbox/capture-1/attachments/attachment-image/meal.jpg',
        extractedText: null,
        transcriptText: null,
        derivedPath: null,
        parseState: 'succeeded',
      } as never,
      captureId: 'capture-1',
      vaultRoot: '/tmp',
    })

    expect(bundle.fragments[0]?.kind).toBe('attachment_metadata')
    expect(bundle.fragments[0]?.text).toContain(
      'automaticImageCodeScan: if inbox parsing succeeds, image attachments are scanned for QR and barcode payloads; treat decoded values as available only when they appear in extracted text fragments',
    )
    expect(bundle.combinedText).toContain('automaticImageCodeScan:')
    expect(bundle.combinedText).not.toContain('attachmentId: attachment-image')
    expect(bundle.combinedText).not.toContain('fileName: meal.jpg')
    expect(bundle.combinedText).not.toContain('storedPath:')
    expect(bundle.combinedText).toContain('nativeImageEvidence: omitted_non_addressable')
  })

  it('redacts unsupported image filenames and source paths from model text', async () => {
    const storedPath = 'raw/inbox/capture-1/attachments/private-scan.tiff'
    const bundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: 'attachment-private-scan',
        ordinal: 1,
        kind: 'image',
        mime: 'image/tiff',
        fileName: 'private-scan.tiff',
        storedPath,
        extractedText: 'Decoded label text.',
        transcriptText: null,
        derivedPath: null,
        parseState: 'succeeded',
      } as never,
      captureId: 'capture-1',
      vaultRoot: '/tmp',
    })

    expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(false)
    expect(bundle.routingImage).toMatchObject({
      eligible: false,
      reason: 'unsupported-format',
    })
    expect(bundle.combinedText).toContain('Decoded label text.')
    expect(bundle.combinedText).toContain('routingImageReason: unsupported-format')
    expect(bundle.combinedText).not.toContain('attachmentId: attachment-private-scan')
    expect(bundle.combinedText).not.toContain('fileName: private-scan.tiff')
    expect(bundle.combinedText).not.toContain(storedPath)
  })

  it('keeps stored PDF paths as ordinary attachment metadata', async () => {
    const storedPath = 'raw/inbox/capture-1/attachments/01__scan.pdf'
    const pdfBytes = Buffer.from('%PDF-1.7\n% fixture\n')

    const bundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: 'attachment-pdf',
        ordinal: 1,
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        byteSize: pdfBytes.byteLength,
        storedPath,
        extractedText: null,
        transcriptText: null,
        derivedPath: null,
        parseState: 'failed',
      } as never,
      captureId: 'capture-1',
      vaultRoot: '/tmp',
    })

    expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(false)
    expect(bundle.combinedText).toContain(`storedPath: ${storedPath}`)

    const prepared = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: bundle,
          captureId: 'capture-1',
        },
      ],
      prompt: 'Read the attached PDF.',
      vaultRoot: '/tmp',
    })

    expect(prepared).toEqual({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })
  })

  it('keeps oversized image attachments text-only', async () => {
    const storedPath = 'raw/inbox/capture-1/attachments/01__large.jpg'
    const bundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: 'attachment-large-image',
        ordinal: 1,
        kind: 'image',
        mime: 'image/jpeg',
        fileName: 'large.jpg',
        byteSize: MAX_NATIVE_ROUTING_IMAGE_BYTES + 1,
        storedPath,
        extractedText: null,
        transcriptText: null,
        derivedPath: null,
        parseState: 'failed',
      } as never,
      captureId: 'capture-1',
      vaultRoot: '/tmp',
    })

    expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(false)
    expect(bundle.routingImage).toMatchObject({
      eligible: false,
      mediaType: 'image/jpeg',
      reason: 'too-large',
    })
    expect(bundle.combinedText).toContain('routingImageReason: too-large')
    expect(bundle.combinedText).not.toContain('attachmentId: attachment-large-image')
    expect(bundle.combinedText).not.toContain('fileName: large.jpg')
    expect(bundle.combinedText).not.toContain(`storedPath: ${storedPath}`)
    expect(bundle.combinedText).toContain('nativeImageEvidence: omitted_non_addressable')

    const prepared = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: bundle,
          captureId: 'capture-1',
        },
      ],
      prompt: 'Read the attached image.',
      vaultRoot: '/tmp',
    })

    expect(prepared).toEqual({
      fallbackError: null,
      inputMode: 'text-only',
      userMessageContent: null,
    })
  })

  it('rechecks the native image byte budget when attachment metadata is missing', async () => {
    const vaultRoot = await createTempVaultRoot()
    const storedPath = 'raw/inbox/capture-1/attachments/01__metadata-missing.jpg'
    await writeVaultFile(
      vaultRoot,
      storedPath,
      Buffer.alloc(MAX_NATIVE_ROUTING_IMAGE_BYTES + 1, 0xcd),
    )

    const bundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: 'attachment-metadata-missing-image',
        ordinal: 1,
        kind: 'image',
        mime: 'image/jpeg',
        fileName: 'metadata-missing.jpg',
        byteSize: null,
        storedPath,
        extractedText: null,
        transcriptText: null,
        derivedPath: null,
        parseState: 'failed',
      } as never,
      captureId: 'capture-1',
      vaultRoot,
    })

    expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(true)
    expect(bundle.routingImage).toMatchObject({
      eligible: true,
      mediaType: 'image/jpeg',
      reason: 'supported-format',
    })

    const prepared = await prepareInboxMultimodalUserMessageContent({
      attachmentSources: [
        {
          attachment: bundle,
          captureId: 'capture-1',
        },
      ],
      prompt: 'Read the attached image.',
      vaultRoot,
    })

    expect(prepared.inputMode).toBe('text-only')
    expect(prepared.userMessageContent).toBeNull()
    expect(prepared.fallbackError).toContain('rich evidence could not be loaded')
  })

})

async function createTempVaultRoot(): Promise<string> {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'inbox-multimodal-'))
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
