export interface AssistantdEnvironment {
  controlToken: string
  host: string
  port: number
  vaultRoot: string
}

const DEFAULT_ASSISTANTD_HOST = '127.0.0.1'
const DEFAULT_ASSISTANTD_PORT = 50_241

export function loadAssistantdEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): AssistantdEnvironment {
  const vaultRoot = normalizeNullableString(env.ASSISTANTD_VAULT_ROOT)
  if (!vaultRoot) {
    throw new Error('ASSISTANTD_VAULT_ROOT is required.')
  }

  const controlToken = normalizeNullableString(env.ASSISTANTD_CONTROL_TOKEN)
  if (!controlToken) {
    throw new Error('ASSISTANTD_CONTROL_TOKEN is required.')
  }

  const host = normalizeNullableString(env.ASSISTANTD_HOST) ?? DEFAULT_ASSISTANTD_HOST
  assertAssistantdLoopbackHost(host)

  return {
    controlToken,
    host,
    port: readAssistantdPort(env.ASSISTANTD_PORT),
    vaultRoot,
  }
}

function assertAssistantdLoopbackHost(host: string): void {
  const normalized = host.trim().toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  ) {
    return
  }

  throw new Error('ASSISTANTD_HOST must be a loopback hostname or address.')
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readAssistantdPort(value: string | undefined): number {
  const raw = normalizeNullableString(value)
  if (!raw) {
    return DEFAULT_ASSISTANTD_PORT
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('ASSISTANTD_PORT must be an integer between 1 and 65535.')
  }

  return parsed
}
