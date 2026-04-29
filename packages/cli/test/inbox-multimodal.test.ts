import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildInboxModelAttachmentBundle,
  inferInboxMultimodalInputMode,
  isRoutingPdfFallbackCandidate,
  MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
} from '../src/inbox-multimodal.ts'

function makeCsv(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const minute = String(index).padStart(3, '0')
    const spo2 = 94 + (index % 5)
    const pulse = 58 + (index % 8)
    return `2026-04-17T00:${minute}:00Z,${spo2},${pulse},sample-${minute}`
  })
  return ['timestamp,spo2,pulse,marker', ...rows].join('\n')
}

function makeJsonExport(recordCount: number): string {
  return JSON.stringify(
    {
      exportedAt: '2026-04-17T10:00:00.000Z',
      provider: 'example-export',
      records: Array.from({ length: recordCount }, (_, index) => {
        const minute = String(index).padStart(3, '0')
        return {
          id: `record-${minute}`,
          timestamp: `2026-04-17T00:${minute}:00Z`,
          metrics: {
            oxygen: 94 + (index % 5),
            pulse: 58 + (index % 8),
          },
          note: `sample-${minute}`,
        }
      }),
    },
    null,
    2,
  )
}

describe('buildInboxModelAttachmentBundle', () => {
  const captureEnvelopePath = 'raw/inbox/capture-1/envelope.json'

  it('marks available stored PDFs as local filesystem evidence without making the bundle multimodal', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-inbox-pdf-'))
    const storedPath = 'raw/inbox/capture-1/attachments/01__scan.pdf'
    const pdfBytes = Buffer.from('%PDF-1.7\n% fixture\n')

    try {
      await mkdir(path.join(vaultRoot, path.dirname(storedPath)), {
        recursive: true,
      })
      await writeFile(path.join(vaultRoot, storedPath), pdfBytes)

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
        captureEnvelopePath,
        vaultRoot,
      })

      expect(isRoutingPdfFallbackCandidate(bundle)).toBe(true)
      expect(inferInboxMultimodalInputMode([bundle])).toBe('text-only')
      expect(bundle.routingPdf).toEqual({
        byteSize: pdfBytes.byteLength,
        eligible: true,
        maxBytes: MAX_INBOX_ROUTING_PDF_EVIDENCE_BYTES,
        path: storedPath,
        reason: 'eligible',
      })
      expect(bundle.combinedText).toContain('routingPdfEligible: true')
      expect(bundle.combinedText).not.toContain('pdfEvidencePath:')
      expect(bundle.combinedText).not.toContain(storedPath)
      expect(bundle.combinedText).not.toContain('scan.pdf')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  })

  it('summarizes large CSV-like attachment evidence instead of duplicating raw parser text', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-inbox-model-'))
    const csv = makeCsv(125)
    const derivedDir = path.join(
      vaultRoot,
      'derived',
      'inbox',
      'capture-1',
      'attachment-1',
    )
    const manifestPath = path.join(derivedDir, 'manifest.json')
    const plainPath = path.join(derivedDir, 'plain.txt')
    const markdownPath = path.join(derivedDir, 'normalized.md')
    const tablesPath = path.join(derivedDir, 'tables.json')

    try {
      await mkdir(derivedDir, { recursive: true })
      await writeFile(plainPath, csv, 'utf8')
      await writeFile(markdownPath, csv, 'utf8')
      await writeFile(tablesPath, csv, 'utf8')
      await writeFile(
        manifestPath,
        JSON.stringify({
          schema: 'murph.parser-manifest.v1',
          paths: {
            plainTextPath: 'derived/inbox/capture-1/attachment-1/plain.txt',
            markdownPath: 'derived/inbox/capture-1/attachment-1/normalized.md',
            tablesPath: 'derived/inbox/capture-1/attachment-1/tables.json',
          },
        }),
        'utf8',
      )

      const bundle = await buildInboxModelAttachmentBundle({
        attachment: {
          attachmentId: 'attachment-1',
          ordinal: 1,
          kind: 'document',
          mime: 'text/comma-separated-values',
          fileName: 'O2Ring S_20260417005547.csv',
          byteSize: csv.length,
          storedPath: 'raw/inbox/capture-1/attachments/attachment-1/o2ring.csv',
          extractedText: csv,
          transcriptText: null,
          derivedPath: 'derived/inbox/capture-1/attachment-1/manifest.json',
          parseState: 'succeeded',
        } as never,
        captureId: 'capture-1',
        captureEnvelopePath,
        vaultRoot,
      })

      expect(bundle.fragments.map((fragment) => fragment.kind)).toEqual([
        'attachment_metadata',
        'attachment_tabular_summary',
      ])
      expect(bundle.fragments[0]?.text).toContain(`byteSize: ${csv.length}`)
      expect(bundle.combinedText).toContain('Large tabular attachment summary:')
      expect(bundle.combinedText).toContain('rows: 125 data rows plus header')
      expect(bundle.combinedText).not.toContain('[derived-plain-text]')
      expect(bundle.combinedText).not.toContain('[derived-markdown]')
      expect(bundle.combinedText).not.toContain('[derived-tables]')
      expect(bundle.combinedText).not.toContain('sample-064')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  })

  it('summarizes large JSON attachment evidence instead of duplicating raw parser text', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-inbox-model-'))
    const json = makeJsonExport(125)
    const derivedDir = path.join(
      vaultRoot,
      'derived',
      'inbox',
      'capture-1',
      'attachment-1',
    )
    const manifestPath = path.join(derivedDir, 'manifest.json')
    const plainPath = path.join(derivedDir, 'plain.txt')
    const markdownPath = path.join(derivedDir, 'normalized.md')

    try {
      await mkdir(derivedDir, { recursive: true })
      await writeFile(plainPath, json, 'utf8')
      await writeFile(markdownPath, `\`\`\`json\n${json}\n\`\`\``, 'utf8')
      await writeFile(
        manifestPath,
        JSON.stringify({
          schema: 'murph.parser-manifest.v1',
          paths: {
            plainTextPath: 'derived/inbox/capture-1/attachment-1/plain.txt',
            markdownPath: 'derived/inbox/capture-1/attachment-1/normalized.md',
            tablesPath: null,
          },
        }),
        'utf8',
      )

      const bundle = await buildInboxModelAttachmentBundle({
        attachment: {
          attachmentId: 'attachment-1',
          ordinal: 1,
          kind: 'document',
          mime: 'application/json',
          fileName: 'wearable-export.json',
          byteSize: json.length,
          storedPath: 'raw/inbox/capture-1/attachments/attachment-1/export.json',
          extractedText: json,
          transcriptText: null,
          derivedPath: 'derived/inbox/capture-1/attachment-1/manifest.json',
          parseState: 'succeeded',
        } as never,
        captureId: 'capture-1',
        captureEnvelopePath,
        vaultRoot,
      })

      expect(bundle.fragments.map((fragment) => fragment.kind)).toEqual([
        'attachment_metadata',
        'attachment_json_summary',
      ])
      expect(bundle.fragments[0]?.text).toContain(`byteSize: ${json.length}`)
      expect(bundle.combinedText).toContain('Large JSON attachment summary:')
      expect(bundle.combinedText).toContain('$.records: 125 items')
      expect(bundle.combinedText).not.toContain('[derived-plain-text]')
      expect(bundle.combinedText).not.toContain('[derived-markdown]')
      expect(bundle.combinedText).not.toContain('record-064')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  })
})
