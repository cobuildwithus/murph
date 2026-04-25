import { describe, expect, it } from 'vitest'

import { projectAttachmentEvidenceForModel } from '../src/inbox-evidence-projection.ts'

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

describe('projectAttachmentEvidenceForModel', () => {
  it('summarizes large tabular attachments and suppresses duplicate raw projections', () => {
    const csv = makeCsv(125)
    const fragments = projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: csv.length,
        fileName: 'O2Ring S_20260417005547.csv',
        mime: 'text/comma-separated-values',
        storedPath: 'raw/inbox/capture-1/attachments/attachment-1/o2ring.csv',
      },
      sources: [
        {
          kind: 'attachment_extracted_text',
          label: 'attachment-1-extracted-text',
          path: 'derived/inbox/capture-1/attachment-1/plain.txt',
          text: csv,
        },
        {
          kind: 'attachment_transcript',
          label: 'attachment-1-transcript',
          path: null,
          text: 'User note about the overnight oximetry file.',
        },
        {
          kind: 'derived_plain_text',
          label: 'derived-plain-text',
          path: 'derived/inbox/capture-1/attachment-1/plain.txt',
          text: csv,
        },
        {
          kind: 'derived_markdown',
          label: 'derived-markdown',
          path: 'derived/inbox/capture-1/attachment-1/normalized.md',
          text: csv,
        },
        {
          kind: 'derived_tables',
          label: 'derived-tables',
          path: 'derived/inbox/capture-1/attachment-1/tables.json',
          text: csv,
        },
      ],
    })

    expect(fragments.map((fragment) => fragment.kind)).toEqual([
      'attachment_tabular_summary',
      'attachment_transcript',
    ])

    const summary = fragments[0]
    expect(summary?.text).toContain('Large tabular attachment summary:')
    expect(summary?.text).toContain('rows: 125 data rows plus header')
    expect(summary?.text).toContain('headers: timestamp, spo2, pulse, marker')
    expect(summary?.text).toContain(
      'Full parsed tabular content is stored locally but omitted from model context',
    )
    expect(summary?.text).not.toContain('sample-064')
    expect(summary?.text.length).toBeLessThanOrEqual(4_000)
    expect(summary?.truncated).toBe(true)
  })

  it('summarizes large JSON exports and suppresses duplicate raw projections', () => {
    const json = makeJsonExport(125)
    const fragments = projectAttachmentEvidenceForModel({
      attachment: {
        byteSize: json.length,
        fileName: 'wearable-export.json',
        mime: 'application/json',
        storedPath: 'raw/inbox/capture-1/attachments/attachment-1/export.json',
      },
      sources: [
        {
          kind: 'attachment_extracted_text',
          label: 'attachment-1-extracted-text',
          path: 'derived/inbox/capture-1/attachment-1/plain.txt',
          text: json,
        },
        {
          kind: 'attachment_transcript',
          label: 'attachment-1-transcript',
          path: null,
          text: 'User note about the uploaded JSON export.',
        },
        {
          kind: 'derived_plain_text',
          label: 'derived-plain-text',
          path: 'derived/inbox/capture-1/attachment-1/plain.txt',
          text: json,
        },
        {
          kind: 'derived_markdown',
          label: 'derived-markdown',
          path: 'derived/inbox/capture-1/attachment-1/normalized.md',
          text: `\`\`\`json\n${json}\n\`\`\``,
        },
      ],
    })

    expect(fragments.map((fragment) => fragment.kind)).toEqual([
      'attachment_json_summary',
      'attachment_transcript',
    ])

    const summary = fragments[0]
    expect(summary?.text).toContain('Large JSON attachment summary:')
    expect(summary?.text).toContain(
      'topLevelKeys: exportedAt, provider, records',
    )
    expect(summary?.text).toContain('$.records: 125 items')
    expect(summary?.text).toContain(
      'objectKeys: id, timestamp, metrics, note',
    )
    expect(summary?.text).toContain(
      'Full parsed JSON content is stored locally but omitted from model context',
    )
    expect(summary?.text).not.toContain('record-064')
    expect(summary?.text.length).toBeLessThanOrEqual(4_000)
    expect(summary?.truncated).toBe(true)
  })

  it('keeps non-tabular evidence as bounded fragments', () => {
    const fragments = projectAttachmentEvidenceForModel({
      attachment: {
        fileName: 'note.txt',
        mime: 'text/plain',
      },
      maxFragmentChars: 120,
      sources: [
        {
          kind: 'derived_plain_text',
          label: 'derived-plain-text',
          path: 'derived/inbox/capture-1/attachment-1/plain.txt',
          text: 'A'.repeat(500),
        },
      ],
    })

    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.kind).toBe('derived_plain_text')
    expect(fragments[0]?.truncated).toBe(true)
    expect(fragments[0]?.text).toContain('[truncated')
    expect(fragments[0]?.text.length).toBeLessThanOrEqual(120)
  })
})
