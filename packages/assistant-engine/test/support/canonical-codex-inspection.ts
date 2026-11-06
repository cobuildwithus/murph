import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { buildCodexAppServerArgs } from '../../src/assistant-codex.js'
import { createCodexCliTimingReceiver } from '../../src/assistant-codex/cli-timing.js'
import { readCodexRpcResponseId, rejectPendingCodexRpcRequests, resolvePendingCodexRpcRequest, stopCodexAppServerChild, tryParseJsonLine, waitForCodexSpawn, withCodexRpcTimeout, writeCodexRpcMessage, type CodexRpcId, type PendingCodexRpcRequest } from '../../src/assistant-codex/app-server-rpc.js'

// Match the adapter constructor's global overrides and timing argument placement.
export function canonicalAdapterArgs(): string[] {
  const timing = createCodexCliTimingReceiver()
  try {
    assert.ok(timing.launchArgs.length > 0)
    const args = buildCodexAppServerArgs({})
    args.splice(args.length - 1, 0, ...timing.launchArgs)
    return args
  } finally { timing.close() }
}

// Read config and start an ephemeral thread without submitting a provider turn.
export async function inspectCanonicalCodex(input: {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  threadParams: Record<string, unknown>
}): Promise<{ config: unknown; account: unknown; started: unknown; instructionSources: string[] }> {
  const child = spawn(input.command, canonicalAdapterArgs(), {
    cwd: input.cwd, env: input.env, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  const lines = createInterface({ input: child.stdout })
  child.stderr.resume()
  child.on('error', (error) => rejectPendingCodexRpcRequests(pendingRequests, error))
  child.on('exit', () => rejectPendingCodexRpcRequests(pendingRequests, new Error('Isolation fixture exited.')))
  lines.on('line', (line) => {
    const parsed = tryParseJsonLine(line)
    if (!parsed.ok) return
    const responseId = readCodexRpcResponseId(parsed.value)
    if (responseId !== null) resolvePendingCodexRpcRequest({ message: parsed.value, responseId, pendingRequests })
  })
  let nextId = 0
  async function request(method: string, params: Record<string, unknown>) {
    const id = ++nextId
    return withCodexRpcTimeout(new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, { method, resolve, reject })
      writeCodexRpcMessage(child, { id, method, params })
    }), 15_000, method, () => pendingRequests.delete(id))
  }
  try {
    await waitForCodexSpawn(child)
    await request('initialize', { clientInfo: { name: 'synthetic_isolation_test', version: '1' }, capabilities: { experimentalApi: true } })
    writeCodexRpcMessage(child, { method: 'initialized', params: {} })
    const config = await request('config/read', { includeLayers: false })
    const account = await request('account/read', { refreshToken: false })
    const started = await request('thread/start', { cwd: input.cwd, ephemeral: true, ...input.threadParams })
    const sources = started && typeof started === 'object' && 'instructionSources' in started ? started.instructionSources : null
    if (!Array.isArray(sources) || !sources.every((value): value is string => typeof value === 'string')) throw new Error('Missing instruction sources.')
    return { config, account, started, instructionSources: sources }
  } finally { await stopCodexAppServerChild({ child, closeStdin: () => { child.stdin.end(); return null } }); lines.close() }
}
