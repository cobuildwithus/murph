import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  AssistantMemoryLongTermSection,
  AssistantMemoryQueryScope,
  AssistantMemoryRecord,
  AssistantMemoryVisibleSection,
  AssistantMemoryWriteScope,
} from '../assistant-cli-contracts.js'
import {
  type AssistantMemorySearchResponse,
  type AssistantMemoryUpsertWriteResult,
  getAssistantMemory,
  searchAssistantMemory,
  upsertAssistantMemory,
} from './memory.js'

export const ASSISTANT_MEMORY_BRIDGE_URL_ENV =
  'HEALTHYBOB_ASSISTANT_MEMORY_BRIDGE_URL'
export const ASSISTANT_MEMORY_BRIDGE_TOKEN_ENV =
  'HEALTHYBOB_ASSISTANT_MEMORY_BRIDGE_TOKEN'
export const ASSISTANT_MEMORY_BRIDGE_VAULT_ENV =
  'HEALTHYBOB_ASSISTANT_MEMORY_BRIDGE_VAULT'
export const ASSISTANT_MEMORY_BRIDGE_PRIVATE_CONTEXT_ENV =
  'HEALTHYBOB_ASSISTANT_MEMORY_PRIVATE_CONTEXT'

export interface AssistantMemoryBridgeContext {
  allowSensitiveHealthContext: boolean
  vault: string
}

export interface AssistantMemoryBridgeEnv {
  allowSensitiveHealthContext: boolean
  token: string
  url: string
  vault: string
}

export async function withAssistantMemoryBridge<T>(
  input: AssistantMemoryBridgeContext,
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const resolvedVault = path.resolve(input.vault)
  const token = randomUUID()
  let writeChain: Promise<void> = Promise.resolve()
  const server = createServer(async (request, response) => {
    try {
      if (
        request.headers.authorization !== `Bearer ${token}` ||
        request.socket.remoteAddress !== '127.0.0.1'
      ) {
        respondJson(response, 401, {
          error: {
            code: 'ASSISTANT_MEMORY_BRIDGE_UNAUTHORIZED',
            message: 'Assistant memory bridge authorization failed.',
          },
        })
        return
      }

      const requestUrl = new URL(
        request.url ?? '/',
        'http://127.0.0.1',
      )

      if (request.method === 'GET' && requestUrl.pathname === '/search') {
        const result = await searchAssistantMemory({
          vault: resolvedVault,
          text: requestUrl.searchParams.get('text'),
          scope: toAssistantMemoryQueryScope(requestUrl.searchParams.get('scope')),
          section: toAssistantMemoryVisibleSection(
            requestUrl.searchParams.get('section'),
          ),
          limit: parsePositiveInteger(requestUrl.searchParams.get('limit')),
          includeSensitiveHealthContext: input.allowSensitiveHealthContext,
        })
        respondJson(response, 200, result)
        return
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname.startsWith('/memory/')
      ) {
        const id = decodeURIComponent(requestUrl.pathname.replace(/^\/memory\//u, ''))
        const result = await getAssistantMemory({
          vault: resolvedVault,
          id,
          includeSensitiveHealthContext: input.allowSensitiveHealthContext,
        })
        respondJson(response, 200, result)
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/upsert') {
        const body = await readJsonBody(request)
        const result = await enqueueAssistantMemoryWrite(
          () =>
            upsertAssistantMemory({
              vault: resolvedVault,
              text: toRequiredString(body.text, 'text'),
              scope: toAssistantMemoryWriteScope(body.scope),
              section: toAssistantMemoryLongTermSection(body.section),
              sourcePrompt: toOptionalString(body.sourcePrompt),
              allowSensitiveHealthContext: input.allowSensitiveHealthContext,
            }),
          () => writeChain,
          (nextChain) => {
            writeChain = nextChain
          },
        )
        respondJson(response, 200, result)
        return
      }

      respondJson(response, 404, {
        error: {
          code: 'ASSISTANT_MEMORY_BRIDGE_NOT_FOUND',
          message: `Unknown assistant memory bridge route ${request.method ?? 'GET'} ${requestUrl.pathname}`,
        },
      })
    } catch (error) {
      respondJson(response, 400, {
        error: serializeAssistantMemoryBridgeError(error),
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Assistant memory bridge did not expose a TCP address.')
  }

  const bridgeEnv: NodeJS.ProcessEnv = {
    [ASSISTANT_MEMORY_BRIDGE_URL_ENV]: `http://127.0.0.1:${address.port}`,
    [ASSISTANT_MEMORY_BRIDGE_TOKEN_ENV]: token,
    [ASSISTANT_MEMORY_BRIDGE_VAULT_ENV]: resolvedVault,
    [ASSISTANT_MEMORY_BRIDGE_PRIVATE_CONTEXT_ENV]: input.allowSensitiveHealthContext
      ? '1'
      : '0',
  }

  try {
    return await run(bridgeEnv)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }
}

async function enqueueAssistantMemoryWrite<TResult>(
  run: () => Promise<TResult>,
  getChain: () => Promise<void>,
  setChain: (nextChain: Promise<void>) => void,
): Promise<TResult> {
  const next = getChain().then(run, run)
  setChain(next.then(() => undefined, () => undefined))
  return await next
}

export function resolveAssistantMemoryBridgeEnv(
  env: NodeJS.ProcessEnv = process.env,
): AssistantMemoryBridgeEnv | null {
  const url = env[ASSISTANT_MEMORY_BRIDGE_URL_ENV]?.trim()
  const token = env[ASSISTANT_MEMORY_BRIDGE_TOKEN_ENV]?.trim()
  const vault = env[ASSISTANT_MEMORY_BRIDGE_VAULT_ENV]?.trim()

  if (!url || !token || !vault) {
    return null
  }

  return {
    allowSensitiveHealthContext:
      env[ASSISTANT_MEMORY_BRIDGE_PRIVATE_CONTEXT_ENV]?.trim() === '1',
    token,
    url,
    vault,
  }
}

export async function searchAssistantMemoryViaBridge(input: {
  bridge: AssistantMemoryBridgeEnv
  limit?: number
  scope?: AssistantMemoryQueryScope
  section?: AssistantMemoryVisibleSection | null
  text?: string | null
}): Promise<AssistantMemorySearchResponse> {
  const url = new URL('/search', input.bridge.url)
  if (input.text?.trim()) {
    url.searchParams.set('text', input.text.trim())
  }
  if (input.scope) {
    url.searchParams.set('scope', input.scope)
  }
  if (input.section) {
    url.searchParams.set('section', input.section)
  }
  if (input.limit) {
    url.searchParams.set('limit', String(input.limit))
  }

  return requestAssistantMemoryBridge(input.bridge, {
    method: 'GET',
    url,
  })
}

export async function getAssistantMemoryViaBridge(input: {
  bridge: AssistantMemoryBridgeEnv
  id: string
}): Promise<AssistantMemoryRecord> {
  const url = new URL(`/memory/${encodeURIComponent(input.id)}`, input.bridge.url)
  return requestAssistantMemoryBridge(input.bridge, {
    method: 'GET',
    url,
  })
}

export async function upsertAssistantMemoryViaBridge(input: {
  bridge: AssistantMemoryBridgeEnv
  scope?: AssistantMemoryWriteScope
  section?: AssistantMemoryLongTermSection | null
  sourcePrompt?: string | null
  text: string
}): Promise<AssistantMemoryUpsertWriteResult> {
  return requestAssistantMemoryBridge(input.bridge, {
    body: {
      scope: input.scope ?? null,
      section: input.section ?? null,
      sourcePrompt: input.sourcePrompt ?? null,
      text: input.text,
    },
    method: 'POST',
    url: new URL('/upsert', input.bridge.url),
  })
}

export function assertAssistantMemoryBridgeVault(
  bridge: AssistantMemoryBridgeEnv,
  vault: string,
): void {
  if (bridge.vault !== path.resolve(vault)) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_BRIDGE_VAULT_MISMATCH',
      'Assistant memory bridge is only valid for the active assistant vault.',
    )
  }
}

async function requestAssistantMemoryBridge<TResult>(
  bridge: AssistantMemoryBridgeEnv,
  input: {
    body?: Record<string, unknown>
    method: 'GET' | 'POST'
    url: URL
  },
): Promise<TResult> {
  const response = await fetch(input.url, {
    method: input.method,
    headers: {
      authorization: `Bearer ${bridge.token}`,
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  })
  const payload = (await response.json()) as
    | TResult
    | {
        error?: {
          code?: string
          message?: string
        }
      }

  if (!response.ok) {
    const errorPayload =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? payload.error
        : null

    throw new VaultCliError(
      errorPayload?.code ?? 'ASSISTANT_MEMORY_BRIDGE_REQUEST_FAILED',
      errorPayload?.message ?? 'Assistant memory bridge request failed.',
    )
  }

  return payload as TResult
}

async function readJsonBody(
  request: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw.length === 0) {
    return {}
  }

  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_BRIDGE_INVALID_BODY',
      'Assistant memory bridge requests require a JSON object body.',
    )
  }

  return parsed as Record<string, unknown>
}

function respondJson(
  response: import('node:http').ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(body)}\n`)
}

function serializeAssistantMemoryBridgeError(error: unknown): {
  code: string
  message: string
} {
  if (error instanceof VaultCliError) {
    return {
      code: error.code ?? 'ASSISTANT_MEMORY_BRIDGE_ERROR',
      message: error.message,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'ASSISTANT_MEMORY_BRIDGE_ERROR',
      message: error.message,
    }
  }

  return {
    code: 'ASSISTANT_MEMORY_BRIDGE_ERROR',
    message: String(error),
  }
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  throw new VaultCliError(
    'ASSISTANT_MEMORY_BRIDGE_FIELD_REQUIRED',
    `Assistant memory bridge field "${field}" is required.`,
  )
}

function toAssistantMemoryQueryScope(
  value: string | null,
): AssistantMemoryQueryScope | undefined {
  return value === 'long-term' || value === 'daily' || value === 'all'
    ? value
    : undefined
}

function toAssistantMemoryVisibleSection(
  value: string | null,
): AssistantMemoryVisibleSection | null | undefined {
  if (!value) {
    return undefined
  }

  return value === 'Identity' ||
    value === 'Preferences' ||
    value === 'Standing instructions' ||
    value === 'Health context' ||
    value === 'Notes'
    ? value
    : undefined
}

function toAssistantMemoryLongTermSection(
  value: unknown,
): AssistantMemoryLongTermSection | null | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  return value === 'Identity' ||
    value === 'Preferences' ||
    value === 'Standing instructions' ||
    value === 'Health context'
    ? value
    : undefined
}

function toAssistantMemoryWriteScope(
  value: unknown,
): AssistantMemoryWriteScope | undefined {
  return value === 'long-term' || value === 'daily' || value === 'both'
    ? value
    : undefined
}
