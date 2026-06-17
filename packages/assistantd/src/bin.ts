#!/usr/bin/env node
import { loadAssistantdEnvironment, loadAssistantdEnvFiles } from './config.js'
import { startAssistantHttpServer } from './http.js'
import { createAssistantLocalService } from './service.js'

async function main(): Promise<void> {
  process.env.MURPH_ASSISTANTD_DISABLE_CLIENT = '1'
  loadAssistantdEnvFiles()
  const env = loadAssistantdEnvironment()
  const service = createAssistantLocalService(env.vaultRoot)
  const handle = await startAssistantHttpServer({
    controlToken: env.controlToken,
    host: env.host,
    port: env.port,
    service,
  })

  console.log(
    JSON.stringify({
      assistantd: {
        baseUrl: handle.address.baseUrl,
        host: handle.address.host,
        port: handle.address.port,
        vaultBound: true,
      },
    }),
  )

  const shutdown = async () => {
    await handle.close().catch(() => undefined)
    process.exit(0)
  }

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })
}

void main().catch((error) => {
  console.error(JSON.stringify({ assistantd: { startupError: formatStartupError(error) } }))
  process.exit(1)
})

function formatStartupError(error: unknown): {
  cause: string[]
  code: string
  message: string
} {
  const record = readRecord(error)
  return {
    cause: collectStartupErrorCauses(error),
    code: typeof record?.code === 'string' && record.code.trim()
      ? sanitizeStartupErrorText(record.code)
      : 'ASSISTANTD_STARTUP_FAILED',
    message: sanitizeStartupErrorText(
      error instanceof Error ? error.message : String(error),
    ),
  }
}

function collectStartupErrorCauses(error: unknown): string[] {
  const causes: string[] = []
  let current = readRecord(error)?.cause
  const seen = new Set<unknown>()

  while (current !== undefined && current !== null && !seen.has(current) && causes.length < 4) {
    seen.add(current)
    causes.push(sanitizeStartupErrorText(current instanceof Error ? current.message : String(current)))
    current = readRecord(current)?.cause
  }

  return causes
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sanitizeStartupErrorText(value: string): string {
  const redacted = value
    .replaceAll(
      /(authorization|cookie|token|api[_-]?key|secret|password)\s*[:=]\s*[^\s),;]+/giu,
      (_match, key: string) => `${key}=[REDACTED]`,
    )
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gu, 'Bearer [REDACTED]')
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replaceAll(/(?:\+?\d[\d .()\-]{6,}\d)/gu, '[number]')
    .replaceAll(/(?:https?:\/\/|file:\/\/)[^\s),;]+/giu, '[url]')
    .replaceAll(/(?:file:\/\/)?\/(?:Users|home|mnt|tmp|var|private)\/[^\s),;]+/giu, '[path]')
    .replaceAll(/[A-Za-z]:\\[^\s),;]+/gu, '[path]')
    .replaceAll(/\s+/gu, ' ')
    .trim()

  return redacted.length > 0 ? redacted.slice(0, 500) : 'unknown startup failure'
}
