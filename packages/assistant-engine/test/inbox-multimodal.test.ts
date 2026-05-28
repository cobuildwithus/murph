import { describe, expect, it } from 'vitest'

import {
  buildInboxModelAttachmentBundle,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  prepareInboxMultimodalUserMessageContent,
} from '../src/inbox-multimodal.ts'

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

})
