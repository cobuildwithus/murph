import { buildMurphHostedPermissionProfileTomlLines, MURPH_GROUP_READ_PERMISSION_PROFILE } from '@murphai/hosted-execution/assistant-permissions'
import { READ_ONLY_ASSISTANT_ASK_THREAD_CONFIG } from '../src/assistant-ask.ts'
import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { startCustomConnectionsGateway } from './support/custom-connections-gateway.ts'
import { rm } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { buildCustomConnectionsThreadConfig } from '../src/assistant/custom-connections.ts'
import { buildAssistantCodexContractFingerprint } from '../src/assistant/codex-contract-fingerprint.ts'
import type { HostedCustomConnectionManifestEntry } from '@murphai/hosted-execution'
import { prepareScriptedTurnScenario, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'

const roots: string[] = []
afterEach(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('pinned native custom connections rotate catalogs and reject stale URLs', async () => {
  const stub = await startScriptedResponsesStub()
  const gateway = await startCustomConnectionsGateway()
  const { origin } = gateway
  const entry = { id: 'cc_notes', slug: 'notes', generation: 1, catalog: 'a'.repeat(43) }
  try {
    const scenario = await prepareScriptedTurnScenario(stub, roots, { additionalTomlLines: buildMurphHostedPermissionProfileTomlLines() })
    const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({ codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome })
    let previousFingerprint: string | null = null
    let previousThread: string | null = null
    const timings: { stage: string; firstTokenMs: number }[] = []
    async function turn(stage: string, manifest: HostedCustomConnectionManifestEntry[], invoke = false, discover = true) {
      const fingerprint = buildAssistantCodexContractFingerprint({ customConnections: manifest, dynamicTools: [], routeFingerprint: 'synthetic-route' })
      const config = buildCustomConnectionsThreadConfig(manifest)
      // Only the transport origin changes for loopback proof; paths and native options are production-built.
      for (const mount of Object.values(config.mcp_servers)) mount.url = mount.url.replace('http://connections.worker', origin)
      const resumeSessionId = fingerprint === previousFingerprint ? previousThread : null
      stub.markRequestBaseline()
      stub.captureProviderRequestDiagnostics({ completeInput: true })
      if (manifest.length && discover) stub.queue({ toolSearchCall: { query: 'notes', limit: 10 } })
      if (invoke) stub.queue({ functionCall: { namespace: 'mcp__notes', name: 'read_notes', arguments: { [gateway.state.schemaField]: 'notebook' } } })
      stub.queue({ text: 'Synthetic notes are ready.', partialText: { delta: 'Synthetic', holdMs: 1 } })
      const started = performance.now()
      let firstTokenMs: number | null = null
      const result = await executeCodexAppServerTurn({
        ...scenario.turnInput, env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog }, threadConfig: config, dynamicTools: [],
        prompt: 'Read the synthetic notes.', resumeSessionId,
        onTraceEvent: event => {
          if (event.updates.some(update => update.kind === 'assistant' && update.text)) firstTokenMs ??= Math.round(performance.now() - started)
        },
      })
      // Adapter timing is the first model text/token event, not total completion.
      expect(firstTokenMs).not.toBeNull()
      timings.push({ stage, firstTokenMs: firstTokenMs! })
      const providerInput = JSON.parse(stub.requestSummariesSinceBaseline()[0]!.completeProviderInput!.json)
      const declarations = JSON.stringify([...(providerInput.tools ?? []), ...providerInput.input.filter((item: {type: string}) => item.type === 'additional_tools'), ...stub.requestSummariesSinceBaseline().flatMap(summary => summary.toolSearchOutputTools ?? [])])
      if (manifest.length && discover) {
        expect(declarations.includes('read_notes')).toBe(true)
        expect(declarations).toContain(gateway.state.schemaField)
      } else if (!manifest.length) expect(declarations.includes('read_notes')).toBe(false)
      if (resumeSessionId) expect(result.threadId).toBe(previousThread)
      else expect(result.threadId).not.toBe(previousThread)
      previousFingerprint = fingerprint
      previousThread = result.threadId
      expect(result.finalMessage).toBe('Synthetic notes are ready.')
    }
    await turn('no-mount-cold', [])
    await turn('no-mount-warm', [])
    gateway.state.connection = entry
    gateway.state.resultText = 'Synthetic notes. '.repeat(10_000)
    await turn('connection-added', [entry], true)
    expect(gateway.state.calls.length).toBe(1)
    const toolOutputs = stub.requestSummariesSinceBaseline().flatMap(summary => {
      const input = JSON.parse(summary.completeProviderInput!.json).input as { type: string }[]
      return input.filter(item => item.type.includes('output'))
    }).map(item => JSON.stringify(item)).filter(output => output.includes('Synthetic notes.'))
    expect(toolOutputs.length).toBeGreaterThan(0)
    // Web caps what the gateway returns; Codex's own default limit still trims what reaches the model.
    for (const output of toolOutputs) {
      expect(output).toMatch(/truncat/iu)
      expect(output.length).toBeLessThan(gateway.state.resultText.length)
    }
    await turn('identical-warm', [entry])
    const beforeRestricted = gateway.state.admittedRequests
    stub.markRequestBaseline()
    stub.captureProviderRequestDiagnostics({ completeInput: true })
    stub.queue({ functionCall: { namespace: 'functions', name: 'exec_command', arguments: { cmd: `/usr/bin/curl --max-time 2 -X POST ${origin}/v1/${entry.id}/${entry.generation}/${entry.catalog}/mcp -d '{}'` } } }, { text: 'Restricted synthetic turn complete.' })
    await executeCodexAppServerTurn({
      ...scenario.turnInput, env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog },
      threadConfig: READ_ONLY_ASSISTANT_ASK_THREAD_CONFIG, dynamicTools: [],
      permissions: MURPH_GROUP_READ_PERMISSION_PROFILE, sandbox: undefined, processLifetime: 'one-shot', ephemeral: true, approvalPolicy: 'never',
      runtimeWorkspaceRoots: [scenario.turnInput.workingDirectory], prompt: 'Attempt the synthetic network boundary.',
    })
    expect(gateway.state.admittedRequests).toBe(beforeRestricted)
    const restrictedInput = stub.requestSummariesSinceBaseline()[0]!.completeProviderInput!.json
    expect(restrictedInput.includes('read_notes')).toBe(false)
    const restrictedOutputs = stub.requestSummariesSinceBaseline().flatMap(summary => summary.functionCallOutputs ?? []).join(' ')
    // Linux sandboxes refuse the socket; macOS refuses the connection. Either way nothing reached the relay above.
    expect(restrictedOutputs).toMatch(/not permitted|denied|couldn't connect|failed to connect/iu)
    const oldUrl = `${origin}/v1/${entry.id}/${entry.generation}/${entry.catalog}/mcp`
    gateway.state.connection = { ...entry, catalog: 'b'.repeat(43) }; gateway.state.schemaField = 'search_text'
    await turn('schema-reapproved', [gateway.state.connection])
    expect((await fetch(oldUrl, { method: 'POST', body: '{}' })).status).toBe(404)
    const priorGenerationUrl = `${origin}/v1/${gateway.state.connection.id}/${gateway.state.connection.generation}/${gateway.state.connection.catalog}/mcp`
    gateway.state.connection = { ...gateway.state.connection, generation: 2 }
    await turn('generation-replaced', [gateway.state.connection])
    expect((await fetch(priorGenerationUrl, { method: 'POST', body: '{}' })).status).toBe(404)
    gateway.state.connection = null
    await turn('connection-removed', [])
    timings.length = 0
    for (const mounted of [false, true, true, false, false, true]) {
      await stopWarmCodexAppServer()
      previousThread = null; previousFingerprint = null
      gateway.state.connection = mounted ? entry : null; gateway.state.schemaField = 'query'
      await turn(mounted ? 'one-mount-cold' : 'no-mount-cold', mounted ? [entry] : [], false, false)
      await turn(mounted ? 'one-mount-warm' : 'no-mount-warm', mounted ? [entry] : [], false, false)
    }
    process.stdout.write(`custom-connections native timings ${JSON.stringify(timings)}\n`)
  } finally {
    await stopWarmCodexAppServer()
    await stub.close()
    await gateway.close()
  }
}, 60_000)
