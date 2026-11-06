import { AssistantWorkspaceArtifactMaterializationError, type AssistantWorkspaceArtifactMaterializer } from '../src/assistant/execution-context.ts'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assistantVaultFileMaxBytes } from '@murphai/operator-config/assistant-cli-contracts'
import { HOSTED_MEDIA_REFS_SCHEMA, resolveHostedMediaReferenceCataloguePath } from '@murphai/runtime-state/node'
import { executeMurphDynamicToolRequest, readMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.ts'
import { resolveMurphDynamicTools, MURPH_MATERIALIZE_VAULT_MEDIA_TOOL, MURPH_SEND_VAULT_FILE_TOOL } from '../src/assistant-codex/dynamic-tool-catalog.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const parse = (args: unknown) => readMurphDynamicToolRequest({ id: 'test', method: 'item/tool/call', params: { namespace: 'murph', tool: 'materialize_vault_media', arguments: args, callId: 'call', threadId: 'thread', turnId: 'turn' } })
const materialize = vi.fn(async (paths: readonly string[]) => ({ materializedArtifactPaths: new Set(paths), missingArtifactPaths: new Map() }))
function run(args: unknown, options: { available?: boolean; scope?: 'direct' | 'group' | 'unverified-external'; vaultRoot?: string; port?: AssistantWorkspaceArtifactMaterializer; signal?: AbortSignal } = {}) {
  const request = parse(args)
  if (!request) throw new Error('Missing tool request')
  return executeMurphDynamicToolRequest({ request, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null,
    vaultRoot: options.vaultRoot ?? '/synthetic-vault', abortSignal: options.signal,
    materializeWorkspaceArtifacts: options.port ?? materialize,
    hostedToolContext: { computerToolsAvailable: false, currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [], currentConversationScope: () => options.scope ?? 'direct',
      vaultFileSendAvailable: options.available !== false, sendVaultFile: async () => { throw new Error('Unexpected send') },
    },
  })
}
describe('materialize vault media', () => {
  it('advertises the exact bounded exclusive schema and deferred discovery', () => {
    expect(MURPH_MATERIALIZE_VAULT_MEDIA_TOOL).toMatchObject({ namespace: 'murph', name: 'materialize_vault_media', deferLoading: true,
      inputSchema: { type: 'object', additionalProperties: false, oneOf: [{ required: ['paths'] }, { required: ['all'] }],
        properties: { paths: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 4096 } }, all: { type: 'boolean', const: true } } } })
    expect(Object.keys(MURPH_MATERIALIZE_VAULT_MEDIA_TOOL.inputSchema.properties)).toEqual(['paths', 'all'])
    for (const available of [false, true]) {
      const names = resolveMurphDynamicTools({ vaultFileSendAvailable: available }).map(tool => tool.name)
      expect(names.includes('materialize_vault_media')).toBe(available)
      expect(names.includes('send_vault_file')).toBe(available)
    }
    expect(MURPH_MATERIALIZE_VAULT_MEDIA_TOOL.description).toContain('saved photo or file is missing locally')
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain('materialize_vault_media with all: true before archiving')
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain('Never drop files to fit')
    expect(MURPH_SEND_VAULT_FILE_TOOL.description).toContain('Unavailable means unrestored, not excluded: preserve any local copy as unverified.')
  })
  it.each([{}, { all: false }, { all: true, paths: ['a'] }, { paths: [] }, { paths: Array(101).fill('a') }, { paths: ['a'], extra: true },
    ...['/outside', '../outside', 'a/../outside', 'a/./b', 'a//b', 'a/', 'operator-home:secret', 'vault:raw/a', 'C:/secret', 'a\\b', 'a\u0000b'].map(ref => ({ paths: [ref] }))])('rejects invalid or non-vault scope %j before the port', async args => {
    materialize.mockClear()
    expect(parse(args)?.kind).toBe('invalid-materialize-vault-media-arguments')
    expect((await run(args)).rpcResult.success).toBe(false)
    expect(materialize).not.toHaveBeenCalled()
  })
  it.each([{ available: false }, { scope: 'group' as const }, { scope: 'unverified-external' as const }])('denies unavailable/private authority %j', async options => {
    materialize.mockClear()
    expect((await run({ all: true }, options)).rpcResult.success).toBe(false)
    expect(materialize).not.toHaveBeenCalled()
  })
  it('counts policy removals separately in a bulk export but explains them for an exact path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'murph-materialize-removed-'))
    roots.push(root)
    const refs = ['raw/inbox/a/expired.png', 'raw/meals/a/retired.jpg', 'raw/inbox/a/lost.png', 'raw/inbox/a/ok.png']
    const cataloguePath = resolveHostedMediaReferenceCataloguePath(root)
    await mkdir(path.dirname(cataloguePath), { recursive: true })
    await writeFile(cataloguePath, JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: refs.map(relativePath => ({ mediaKind: 'image', relativePath, byteSize: 1 })) }))
    const port: AssistantWorkspaceArtifactMaterializer = vi.fn(async () => ({
      materializedArtifactPaths: new Set(['vault:raw/inbox/a/ok.png']),
      missingArtifactPaths: new Map([['vault:raw/inbox/a/expired.png', 'expired'], ['vault:raw/meals/a/retired.jpg', 'obsolete'],
        ['vault:raw/inbox/a/lost.png', 'missing']] as const),
    }))
    const bulk = await run({ all: true }, { vaultRoot: root, port })
    expect(JSON.parse(bulk.rpcResult.contentItems[0]!.text)).toEqual({ requested: 4, available: 1, removed: 2,
      unavailable: [{ path: 'raw/inbox/a/lost.png', reason: 'missing' }] })
    const exact = await run({ paths: ['raw/inbox/a/expired.png'] }, { vaultRoot: root, port })
    expect(JSON.parse(exact.rpcResult.contentItems[0]!.text)).toEqual({ requested: 1, available: 0, removed: 0,
      unavailable: [{ path: 'raw/inbox/a/expired.png', reason: 'expired' }] })
  })
  it('qualifies exact paths and passes the real cap and cancellation signal', async () => {
    materialize.mockClear()
    const signal = new AbortController().signal
    const result = await run({ paths: ['raw/inbox/a:photo.png', 'vault/literal.txt', 'operator-home/literal.txt', 'photo:tag.png'] }, { signal })
    expect(materialize).toHaveBeenCalledExactlyOnceWith(['vault:raw/inbox/a:photo.png', 'vault:vault/literal.txt', 'vault:operator-home/literal.txt', 'vault:photo:tag.png'], { maxFileBytes: assistantVaultFileMaxBytes, maxTotalDownloadBytes: assistantVaultFileMaxBytes, signal })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({ requested: 4, available: 4, removed: 0, unavailable: [] })
  })
  it('preserves interruption and never infers success from an omitted outcome', async () => {
    const ownerLost = new AssistantWorkspaceArtifactMaterializationError(new Error('Synthetic owner lost'))
    await expect(run({ paths: ['raw/inbox/photo.png'] }, { port: async () => { throw ownerLost } })).rejects.toBe(ownerLost)
    const controller = new AbortController()
    controller.abort(ownerLost)
    materialize.mockClear()
    await expect(run({ all: true }, { signal: controller.signal })).rejects.toBe(ownerLost)
    expect(materialize).not.toHaveBeenCalled()
    const result = await run({ paths: ['raw/inbox/photo.png'] }, { port: async () => ({ materializedArtifactPaths: new Set(), missingArtifactPaths: new Map() }) })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({ requested: 1, available: 0, removed: 0, unavailable: [{ path: 'raw/inbox/photo.png', reason: 'missing' }] })
  })
  it('passes the complete catalogue once to the sequential materializer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'murph-materialize-batch-')); roots.push(root)
    const catalogue = resolveHostedMediaReferenceCataloguePath(root)
    await mkdir(path.dirname(catalogue), { recursive: true })
    await writeFile(catalogue, JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA,
      entries: Array.from({ length: 201 }, (_, i) => ({ mediaKind: 'image', relativePath: `raw/inbox/photo-${i}.png`, byteSize: 1 })) }))
    materialize.mockClear()
    const result = await run({ all: true }, { vaultRoot: root })
    expect(materialize).toHaveBeenCalledOnce()
    expect(materialize.mock.calls[0]?.[0]).toHaveLength(201)
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({ requested: 201, available: 201, removed: 0, unavailable: [] })
  })
  it('enumerates catalogue-only media and cold ingest through the reader', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'murph-materialize-tool-')); roots.push(root)
    const catalogue = resolveHostedMediaReferenceCataloguePath(root)
    await mkdir(path.dirname(catalogue), { recursive: true })
    await writeFile(catalogue, JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [
      { mediaKind: 'image', relativePath: 'raw/inbox/old/photo.png', byteSize: 1 },
      { mediaKind: 'integration-ingest', relativePath: 'ledger/integration-ingests/2025/2025-01.jsonl.br', byteSize: 10, expiresAt: null, mediaId: 'a'.repeat(64), sha256: 'b'.repeat(64) },
    ] }))
    materialize.mockClear()
    await run({ all: true }, { vaultRoot: root })
    expect(materialize.mock.calls[0]?.[0]).toEqual(['vault:raw/inbox/old/photo.png', 'vault:ledger/integration-ingests/2025/2025-01.jsonl.br'])
    await writeFile(catalogue, JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{ mediaKind: 'image', relativePath: 'operator-home:secret' }] }))
    materialize.mockClear()
    await expect(run({ all: true }, { vaultRoot: root })).rejects.toThrow()
    expect(materialize).not.toHaveBeenCalled()
  })
})
