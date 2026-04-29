import { describe, expect, it } from 'vitest'

import {
  buildInboxModelAttachmentBundle,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  isRoutingPdfFallbackCandidate,
  MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
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

  it('exposes stored PDF paths as local-tool fallback metadata without native file content', async () => {
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

    expect(isRoutingPdfFallbackCandidate(bundle)).toBe(true)
    expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(true)
    expect(bundle.routingPdf).toEqual({
      byteSize: pdfBytes.byteLength,
      eligible: false,
      maxBytes: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
      path: storedPath,
      reason: 'raw-pdf-disabled',
    })
    expect(bundle.combinedText).toContain('routingPdfEligible: false')
    expect(bundle.combinedText).toContain('routingPdfReason: raw-pdf-disabled')
    expect(bundle.combinedText).toContain(`storedPath: ${storedPath}`)
    expect(bundle.combinedText).toContain(`routingPdfPath: ${storedPath}`)
    expect(bundle.combinedText).not.toContain('pdfEvidencePath:')

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
      fallbackError:
        'Falling back to text-only input because rich evidence could not be loaded.',
      inputMode: 'text-only',
      userMessageContent: null,
    })
  })

  it('does not mark PDFs as local evidence when the declared size is over the cap', async () => {
    const bundle = await buildInboxModelAttachmentBundle({
      attachment: {
        attachmentId: 'attachment-pdf',
        ordinal: 1,
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        byteSize: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES + 1,
        storedPath: 'raw/inbox/capture-1/attachments/01__scan.pdf',
        extractedText: null,
        transcriptText: null,
        derivedPath: null,
        parseState: 'failed',
      } as never,
      captureId: 'capture-1',
      vaultRoot: '/tmp',
    })

    expect(isRoutingPdfFallbackCandidate(bundle)).toBe(false)
    expect(bundle.routingPdf).toEqual({
      byteSize: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES + 1,
      eligible: false,
      maxBytes: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
      path: 'raw/inbox/capture-1/attachments/01__scan.pdf',
      reason: 'declared-too-large',
    })
    expect(bundle.combinedText).toContain('routingPdfEligible: false')
    expect(bundle.combinedText).toContain('routingPdfReason: declared-too-large')
  })

})
