import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildInboxModelAttachmentBundle,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  isRoutingPdfFallbackCandidate,
  MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
  prepareInboxMultimodalUserMessageContent,
} from '../src/inbox-multimodal.ts'

describe('buildInboxModelAttachmentBundle', () => {
  const envelopePath =
    'raw/inbox/linq/default/2026/04/capture-1/envelope.json'

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
      captureEnvelopePath: envelopePath,
      vaultRoot: '/tmp',
    })

    expect(bundle.fragments[0]?.kind).toBe('attachment_metadata')
    expect(bundle.fragments[0]?.text).toContain(
      'automaticImageCodeScan: if inbox parsing succeeds, image attachments are scanned for QR and barcode payloads; treat decoded values as available only when they appear in extracted text fragments',
    )
    expect(bundle.combinedText).toContain('automaticImageCodeScan:')
  })

  it('attaches stored PDFs as native file evidence after validating the capture subtree', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'inbox-pdf-evidence-'))
    const storedPath = 'raw/inbox/linq/default/2026/04/capture-1/attachments/01__scan.pdf'
    const pdfBytes = Buffer.from('%PDF-1.7\n% fixture\n')

    try {
      await mkdir(path.join(vaultRoot, path.posix.dirname(storedPath)), {
        recursive: true,
      })
      await writeFile(path.join(vaultRoot, storedPath), pdfBytes)

      const bundle = await buildInboxModelAttachmentBundle({
        attachment: {
          attachmentId: 'attachment-pdf',
          ordinal: 1,
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'private-scan.pdf',
          byteSize: pdfBytes.byteLength,
          storedPath,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'failed',
        } as never,
        captureId: 'capture-1',
        captureEnvelopePath: envelopePath,
        vaultRoot,
      })

      expect(isRoutingPdfFallbackCandidate(bundle)).toBe(true)
      expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(true)
      expect(bundle.routingPdf).toEqual({
        byteSize: pdfBytes.byteLength,
        eligible: true,
        maxBytes: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
        path: storedPath,
        reason: 'eligible',
      })
      expect(bundle.combinedText).toContain('routingPdfEligible: true')
      expect(bundle.combinedText).toContain('routingPdfReason: eligible')
      expect(bundle.combinedText).not.toContain('pdfEvidencePath:')
      expect(bundle.combinedText).not.toContain('private-scan.pdf')

      const prepared = await prepareInboxMultimodalUserMessageContent({
        attachmentSources: [
          {
            attachment: bundle,
            captureId: 'capture-1',
            captureEnvelopePath: envelopePath,
          },
        ],
        prompt: 'Read the attached PDF.',
        vaultRoot,
      })

      expect(prepared.fallbackError).toBeNull()
      expect(prepared.inputMode).toBe('multimodal')
      expect(prepared.userMessageContent).toEqual([
        {
          type: 'text',
          text: 'Read the attached PDF.',
        },
        {
          type: 'file',
          data: pdfBytes,
          mediaType: 'application/pdf',
          filename: 'attachment-01.pdf',
        },
      ])
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
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
      captureEnvelopePath: envelopePath,
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

  it('does not mark PDFs as local evidence when the stored file is missing', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'inbox-pdf-missing-'))
    const storedPath = 'raw/inbox/linq/default/2026/04/capture-1/attachments/01__missing.pdf'

    try {
      const bundle = await buildInboxModelAttachmentBundle({
        attachment: {
          attachmentId: 'attachment-pdf',
          ordinal: 1,
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'scan.pdf',
          byteSize: 128,
          storedPath,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'failed',
        } as never,
        captureId: 'capture-1',
        captureEnvelopePath: envelopePath,
        vaultRoot,
      })

      expect(isRoutingPdfFallbackCandidate(bundle)).toBe(false)
      expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(false)
      expect(bundle.routingPdf).toEqual({
        byteSize: 128,
        eligible: false,
        maxBytes: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
        path: storedPath,
        reason: 'stored-file-unavailable',
      })
      expect(bundle.combinedText).toContain('routingPdfEligible: false')
      expect(bundle.combinedText).toContain('routingPdfReason: stored-file-unavailable')

      const prepared = await prepareInboxMultimodalUserMessageContent({
        attachmentSources: [
          {
            attachment: bundle,
            captureId: 'capture-1',
            captureEnvelopePath: envelopePath,
          },
        ],
        prompt: 'Read the attached PDF.',
        vaultRoot,
      })

      expect(prepared.fallbackError).toBeNull()
      expect(prepared.inputMode).toBe('text-only')
      expect(prepared.userMessageContent).toBeNull()
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })

})
