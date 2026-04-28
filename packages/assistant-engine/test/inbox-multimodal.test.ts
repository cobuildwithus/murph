import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildInboxModelAttachmentBundle,
  hasInboxMultimodalAttachmentEvidenceCandidate,
  isRoutingPdfFallbackCandidate,
  prepareInboxMultimodalUserMessageContent,
} from '../src/inbox-multimodal.ts'
import { createTempVaultContext } from './test-helpers.ts'

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

  it('keeps stored PDFs as metadata until provider file evidence support is proven', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-assistant-engine-pdf-evidence-',
    )
    const storedPath = 'raw/inbox/capture-1/attachments/01__scan.pdf'

    try {
      await mkdir(path.join(vaultRoot, path.dirname(storedPath)), {
        recursive: true,
      })
      await writeFile(
        path.join(vaultRoot, storedPath),
        Buffer.from('%PDF-1.7\n% fixture\n'),
      )

      const bundle = await buildInboxModelAttachmentBundle({
        attachment: {
          attachmentId: 'attachment-pdf',
          ordinal: 1,
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'scan.pdf',
          storedPath,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'failed',
        } as never,
        captureId: 'capture-1',
        vaultRoot,
      })

      expect(isRoutingPdfFallbackCandidate(bundle)).toBe(false)
      expect(hasInboxMultimodalAttachmentEvidenceCandidate(bundle)).toBe(false)
      expect(bundle.combinedText).toContain('routingPdfEligible: false')

      const prepared = await prepareInboxMultimodalUserMessageContent({
        attachmentSources: [
          {
            attachment: bundle,
            captureId: 'capture-1',
          },
        ],
        prompt: 'Read the attached PDF.',
        vaultRoot,
      })

      expect(prepared).toEqual({
        fallbackError: null,
        inputMode: 'text-only',
        userMessageContent: null,
      })
    } finally {
      await rm(parentRoot, { force: true, recursive: true })
    }
  })
})
