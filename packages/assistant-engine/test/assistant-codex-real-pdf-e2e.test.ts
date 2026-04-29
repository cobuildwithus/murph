import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { executeCodexAppServerTurn } from '../src/assistant-codex.ts'
import { buildCodexInjectedFileMessageItems } from '../src/assistant-codex/files.ts'

const runRealCodexPdfE2e = process.env.MURPH_E2E_REAL_CODEX_PDF === '1'
const realCodexPdfDescribe = runRealCodexPdfE2e ? describe : describe.skip
const DEFAULT_CODEX_E2E_ENV_ALLOWLIST = [
  'ALL_PROXY',
  'CODEX_HOME',
  'HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'NO_PROXY',
  'PATH',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
] as const

realCodexPdfDescribe('real Codex app-server PDF E2E', () => {
  it(
    'reads an injected PDF natively through a real local Codex app-server',
    async () => {
      const workingDirectory = await mkdtemp(
        path.join(tmpdir(), 'murph-real-codex-pdf-e2e-'),
      )
      const verificationCode = `MURPH-PDF-${randomUUID()}`
      const pdfBytes = buildSinglePagePdfBytes([
        'Murph native PDF E2E.',
        `Verification code: ${verificationCode}`,
      ])

      try {
        const injectedResponsesItems = buildCodexInjectedFileMessageItems({
          files: [
            {
              type: 'file',
              data: pdfBytes,
              mediaType: 'application/pdf',
              filename: 'private-source-name.pdf',
            },
          ],
        })

        const result = await executeCodexAppServerTurn({
          approvalPolicy: 'never',
          codexCommand: process.env.MURPH_E2E_REAL_CODEX_COMMAND?.trim() || 'codex',
          codexHome:
            process.env.MURPH_E2E_REAL_CODEX_HOME?.trim() ||
            process.env.CODEX_HOME?.trim() ||
            null,
          env: buildRealCodexPdfE2eEnv(process.env),
          injectedResponsesItems,
          model: process.env.MURPH_E2E_REAL_CODEX_MODEL?.trim() || null,
          profile: process.env.MURPH_E2E_REAL_CODEX_PROFILE?.trim() || null,
          prompt: [
            'Read the attached PDF natively.',
            'It contains one verification code.',
            'Reply with exactly that code and no other text.',
            'Do not use tools or inspect the filesystem.',
          ].join(' '),
          reasoningEffort:
            process.env.MURPH_E2E_REAL_CODEX_REASONING_EFFORT?.trim() || 'low',
          sandbox: 'read-only',
          workingDirectory,
        })

        expect(result.providerActionCount).toBe(0)
        expect(result.finalMessage.trim()).toBe(verificationCode)
      } finally {
        await rm(workingDirectory, {
          force: true,
          recursive: true,
        })
      }
    },
    600_000,
  )
})

function buildRealCodexPdfE2eEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configuredAllowlist =
    env.MURPH_E2E_REAL_CODEX_ENV_ALLOWLIST?.split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0) ?? []
  const allowlist = [
    ...DEFAULT_CODEX_E2E_ENV_ALLOWLIST,
    ...configuredAllowlist,
  ]

  const nextEnv: NodeJS.ProcessEnv = {}
  for (const name of allowlist) {
    const value = env[name]
    if (value !== undefined) {
      nextEnv[name] = value
    }
  }

  return nextEnv
}

function buildSinglePagePdfBytes(lines: readonly string[]): Buffer {
  const escapedLines = lines.map(escapePdfText)
  const textOperations = escapedLines
    .map((line, index) =>
      index === 0 ? `72 720 Td (${line}) Tj` : `0 -24 Td (${line}) Tj`,
    )
    .join('\n')
  const content = `BT\n/F1 18 Tf\n${textOperations}\nET\n`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream\nendobj\n`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'utf8')
}

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/gu, (match) => `\\${match}`)
}
