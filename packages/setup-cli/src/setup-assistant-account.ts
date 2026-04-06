import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { normalizeNullableString } from '@murphai/operator-config/assistant/shared'
import type {
  SetupAssistantAccount,
  SetupAssistantQuotaWindow,
  SetupConfiguredAssistant,
} from '@murphai/operator-config/setup-cli-contracts'

const CODEX_AUTH_DIRECTORY = '.codex'
const CODEX_AUTH_FILE_NAME = 'auth.json'
const CODEX_APP_SERVER_ARGS = [
  '-s',
  'read-only',
  '-a',
  'untrusted',
  'app-server',
] as const
const CODEX_APP_SERVER_TIMEOUT_MS = 3_000
const CODEX_RPC_CLIENT_NAME = 'murph'
const CODEX_RPC_CLIENT_VERSION = '1.0.0'

interface SetupAssistantAccountResolverDependencies {
  env?: () => NodeJS.ProcessEnv
  getHomeDirectory?: () => string
  probeCodexRpc?: ((input: {
    codexCommand: string | null
    env: NodeJS.ProcessEnv
  }) => Promise<SetupAssistantAccount | null>) | undefined
  readTextFile?: ((filePath: string) => Promise<string>) | undefined
}

interface CodexRpcRateWindow {
  resetsAt: number | null
  usedPercent: number | null
  windowDurationMins: number | null
}

interface CodexRpcAccountProbeResult {
  accountKind: 'account' | 'api-key' | 'unknown'
  planCode: string | null
  source: string
  creditsRemaining: number | null
  creditsUnlimited: boolean | null
  primaryWindow: CodexRpcRateWindow | null
  secondaryWindow: CodexRpcRateWindow | null
}

export interface SetupAssistantAccountResolver {
  resolve(input: { assistant: SetupConfiguredAssistant }): Promise<SetupAssistantAccount | null>
}

export function createSetupAssistantAccountResolver(
  dependencies: SetupAssistantAccountResolverDependencies = {},
): SetupAssistantAccountResolver {
  const env = dependencies.env ?? (() => process.env)
  const getHomeDirectory = dependencies.getHomeDirectory ?? (() => os.homedir())
  const readTextFile =
    dependencies.readTextFile ?? (async (filePath: string) => await readFile(filePath, 'utf8'))
  const probeCodexRpc =
    dependencies.probeCodexRpc ?? defaultProbeCodexRpc

  return {
    async resolve(input) {
      if (input.assistant.provider !== 'codex-cli') {
        return null
      }

      const effectiveEnv = {
        ...env(),
      }
      const authSnapshot = await loadCodexAuthAccountSnapshot({
        env: effectiveEnv,
        getHomeDirectory,
        readTextFile,
      })
      const rpcSnapshot = await probeCodexRpc({
        codexCommand: normalizeNullableString(input.assistant.codexCommand) ?? null,
        env: effectiveEnv,
      })

      return mergeSetupAssistantAccounts(rpcSnapshot, authSnapshot)
    },
  }
}

export async function loadCodexAuthAccountSnapshot(input: {
  env: NodeJS.ProcessEnv
  getHomeDirectory?: () => string
  readTextFile?: (filePath: string) => Promise<string>
}): Promise<SetupAssistantAccount | null> {
  const readTextFile =
    input.readTextFile ?? (async (filePath: string) => await readFile(filePath, 'utf8'))
  try {
    const raw = await readTextFile(
      resolveCodexAuthFilePath(
        input.env,
        input.getHomeDirectory?.() ?? os.homedir(),
      ),
    )
    return detectCodexAccountFromAuthJson(raw)
  } catch {
    return null
  }
}

export function resolveCodexAuthFilePath(
  env: NodeJS.ProcessEnv,
  homeDirectory = os.homedir(),
): string {
  const codexHome = normalizeNullableString(env.CODEX_HOME)
  const root = codexHome ?? path.join(homeDirectory, CODEX_AUTH_DIRECTORY)
  return path.join(root, CODEX_AUTH_FILE_NAME)
}

export function detectCodexAccountFromAuthJson(
  rawAuthJson: string,
): SetupAssistantAccount | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawAuthJson) as unknown
  } catch {
    return null
  }

  const authObject = asRecord(parsed)
  if (authObject === null) {
    return null
  }

  const tokens = asRecord(authObject.tokens)
  const idToken = normalizeNullableString(
    asString(tokens?.idToken) ?? asString(tokens?.id_token),
  )
  const openAIApiKey = normalizeNullableString(
    asString(authObject.OPENAI_API_KEY) ??
      asString(authObject.openai_api_key),
  )

  if (idToken) {
    const payload = parseJwtPayload(idToken)
    const authClaims = asRecord(payload?.['https://api.openai.com/auth'])
    const planCode = normalizePlanCode(
      asString(authClaims?.chatgpt_plan_type) ??
        asString(payload?.chatgpt_plan_type),
    )

    return {
      source: 'codex-auth-json',
      kind: 'account',
      planCode,
      planName: formatCodexPlanName(planCode),
      quota: null,
    }
  }

  if (openAIApiKey) {
    return {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    }
  }

  return null
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

  let payload = parts[1]
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')

  while (payload.length % 4 !== 0) {
    payload += '='
  }

  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

export function formatCodexPlanName(planCode: string | null): string | null {
  const normalized = normalizePlanCode(planCode)
  if (normalized === null) {
    return null
  }

  switch (normalized) {
    case 'guest':
      return 'Guest'
    case 'free':
      return 'Free'
    case 'go':
      return 'Go'
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'free_workspace':
      return 'Free Workspace'
    case 'team':
      return 'Team'
    case 'business':
      return 'Business'
    case 'education':
      return 'Education'
    case 'quorum':
      return 'Quorum'
    case 'k12':
      return 'K12'
    case 'enterprise':
      return 'Enterprise'
    case 'edu':
      return 'Edu'
    default:
      return normalized
        .split(/[_\s-]+/u)
        .filter((part) => part.length > 0)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ')
    }
}

export function formatSetupAssistantAccountLabel(
  account: SetupAssistantAccount | null | undefined,
): string | null {
  if (!account) {
    return null
  }

  if (account.kind === 'api-key') {
    return 'API key account'
  }

  if (account.planName) {
    return `${account.planName} account`
  }

  if (account.kind === 'account') {
    return 'signed-in account'
  }

  return null
}

export function mergeSetupAssistantAccounts(
  primary: SetupAssistantAccount | null,
  fallback: SetupAssistantAccount | null,
): SetupAssistantAccount | null {
  if (primary === null) {
    return fallback
  }
  if (fallback === null) {
    return primary
  }

  const sources = [primary.source, fallback.source].filter(
    (value, index, values) => value.length > 0 && values.indexOf(value) === index,
  )
  const kind =
    primary.kind !== 'unknown'
      ? primary.kind
      : fallback.kind

  return {
    source: sources.join('+'),
    kind,
    planCode: primary.planCode ?? fallback.planCode,
    planName: primary.planName ?? fallback.planName,
    quota: primary.quota ?? fallback.quota,
  }
}

async function defaultProbeCodexRpc(input: {
  codexCommand: string | null
  env: NodeJS.ProcessEnv
}): Promise<SetupAssistantAccount | null> {
  try {
    const result = await runCodexRpcAccountProbe(input)
    return {
      source: result.source,
      kind: result.accountKind,
      planCode: result.planCode,
      planName: formatCodexPlanName(result.planCode),
      quota:
        result.creditsRemaining === null &&
        result.creditsUnlimited === null &&
        result.primaryWindow === null &&
        result.secondaryWindow === null
          ? null
          : {
              creditsRemaining: result.creditsRemaining,
              creditsUnlimited: result.creditsUnlimited,
              primaryWindow: buildQuotaWindow(result.primaryWindow),
              secondaryWindow: buildQuotaWindow(result.secondaryWindow),
            },
    }
  } catch {
    return null
  }
}

async function runCodexRpcAccountProbe(input: {
  codexCommand: string | null
  env: NodeJS.ProcessEnv
}): Promise<CodexRpcAccountProbeResult> {
  const codexCommand = input.codexCommand ?? 'codex'
  const child: ChildProcessWithoutNullStreams = spawn(
    codexCommand,
    [...CODEX_APP_SERVER_ARGS],
    {
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const lineReader = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  })
  const iterator = lineReader[Symbol.asyncIterator]()

  const cleanup = async () => {
    lineReader.close()
    try {
      child.stdin.end()
    } catch {
      // Best-effort cleanup only.
    }
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill()
    }
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, 'exit')
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const handleSpawn = () => {
        child.off('error', handleError)
        resolve()
      }
      const handleError = (error: Error) => {
        child.off('spawn', handleSpawn)
        reject(error)
      }

      child.once('spawn', handleSpawn)
      child.once('error', handleError)
    })

    return await runWithTimeout(async () => {
      const initializeId = 1
      writeCodexRpcMessage(child, {
        id: initializeId,
        method: 'initialize',
        params: {
          clientInfo: {
            name: CODEX_RPC_CLIENT_NAME,
            version: CODEX_RPC_CLIENT_VERSION,
          },
        },
      })
      await readCodexRpcResult(iterator, initializeId)

      writeCodexRpcMessage(child, {
        method: 'initialized',
        params: {},
      })

      const accountReadId = 2
      writeCodexRpcMessage(child, {
        id: accountReadId,
        method: 'account/read',
        params: {},
      })
      const accountResult = asRecord(await readCodexRpcResult(iterator, accountReadId))

      const rateLimitsReadId = 3
      writeCodexRpcMessage(child, {
        id: rateLimitsReadId,
        method: 'account/rateLimits/read',
        params: {},
      })
      const rateLimitsResult = asRecord(
        await readCodexRpcResult(iterator, rateLimitsReadId),
      )

      const account = asRecord(accountResult?.account)
      const accountType = normalizeNullableString(asString(account?.type))?.toLowerCase()
      const planCode = normalizePlanCode(asString(account?.planType))
      const rateLimits = asRecord(rateLimitsResult?.rateLimits)
      const credits = asRecord(rateLimits?.credits)

      return {
        accountKind:
          accountType === 'chatgpt'
            ? 'account'
            : accountType === 'apikey'
              ? 'api-key'
              : 'unknown',
        planCode,
        source: 'codex-rpc',
        creditsRemaining: parseNullableNumber(credits?.balance),
        creditsUnlimited: parseNullableBoolean(credits?.unlimited),
        primaryWindow: parseCodexRpcRateWindow(rateLimits?.primary),
        secondaryWindow: parseCodexRpcRateWindow(rateLimits?.secondary),
      }
    }, CODEX_APP_SERVER_TIMEOUT_MS)
  } catch (error) {
    const reason =
      error instanceof Error && normalizeNullableString(error.message)
        ? error.message
        : stderr.trim()
    throw new Error(reason ?? 'Codex RPC probe failed.')
  } finally {
    await cleanup()
  }
}

function writeCodexRpcMessage(
  child: ChildProcessWithoutNullStreams,
  payload: Record<string, unknown>,
): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

async function readCodexRpcResult(
  iterator: AsyncIterator<string>,
  expectedId: number,
): Promise<unknown> {
  while (true) {
    const next = await iterator.next()
    if (next.done) {
      throw new Error('Codex app-server closed before returning the expected response.')
    }

    const trimmed = normalizeNullableString(next.value)
    if (!trimmed) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }

    const message = asRecord(parsed)
    if (message === null) {
      continue
    }

    if (typeof message.id !== 'number' || message.id !== expectedId) {
      continue
    }

    const error = asRecord(message.error)
    if (error !== null) {
      throw new Error(
        normalizeNullableString(asString(error.message)) ??
          'Codex app-server returned an error.',
      )
    }

    return message.result
  }
}

function parseCodexRpcRateWindow(value: unknown): CodexRpcRateWindow | null {
  const window = asRecord(value)
  if (window === null) {
    return null
  }

  const usedPercent = parseNullableNumber(window.usedPercent)
  const resetsAt = parseNullableNumber(window.resetsAt)
  const windowDurationMins = parseNullableNumber(window.windowDurationMins)

  return {
    usedPercent,
    resetsAt,
    windowDurationMins:
      windowDurationMins === null ? null : Math.max(1, Math.trunc(windowDurationMins)),
  }
}

function buildQuotaWindow(
  value: CodexRpcRateWindow | null,
): SetupAssistantQuotaWindow | null {
  if (value === null || value.usedPercent === null) {
    return null
  }

  const usedPercent = clampPercent(value.usedPercent)
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowMinutes: value.windowDurationMins,
    resetsAt:
      value.resetsAt === null
        ? null
        : new Date(value.resetsAt * 1000).toISOString(),
  }
}

function parseNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = normalizeNullableString(value)
    if (normalized === null) {
      return null
    }

    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function normalizePlanCode(value: string | null): string | null {
  const normalized = normalizeNullableString(value)
  if (normalized === null) {
    return null
  }

  return normalized
    .toLowerCase()
    .replace(/[\s-]+/gu, '_')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

async function runWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
