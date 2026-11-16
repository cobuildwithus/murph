import { buildMurphHostedPermissionProfileTomlLines, MURPH_GROUP_READ_PERMISSION_PROFILE, MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE } from '@murphai/hosted-execution/assistant-permissions'
import { READ_ONLY_ASSISTANT_ASK_THREAD_CONFIG } from '../src/assistant-ask.ts'
import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { startCustomConnectionsGateway } from './support/custom-connections-gateway.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
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
    const scenario = await prepareScriptedTurnScenario(stub, roots, { additionalTomlLines: buildMurphHostedPermissionProfileTomlLines })
    const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({ codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome })
    let previousFingerprint: string | null = null
    let previousThread: string | null = null
    const timings: { stage: string; firstTokenMs: number }[] = []
    async function turn(stage: string, manifest: HostedCustomConnectionManifestEntry[], invoke = false, discover = true) {
      const fingerprint = buildAssistantCodexContractFingerprint({ customConnections: manifest, dynamicTools: [], routeFingerprint: 'synthetic-route' })
      const config = buildCustomConnectionsThreadConfig(manifest)
      // Only the transport origin changes for loopback proof; paths and native options are production-built.
      for (const mount of Object.values(config?.mcp_servers ?? {})) mount.url = mount.url.replace('http://connections.worker', origin)
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


it('pinned native member shell denies Codex home writes while workspace and temp writes succeed', async () => {
  const stub = await startScriptedResponsesStub()
  try {
    const scenario = await prepareScriptedTurnScenario(stub, roots, { additionalTomlLines: buildMurphHostedPermissionProfileTomlLines })
    const { codexHome, codexCommand, workingDirectory } = scenario.turnInput
    expect(execFileSync(codexCommand, ['--version'], { encoding: 'utf8', env: { ...scenario.turnInput.env, CODEX_HOME: codexHome, HOME: workingDirectory } }).trim()).toBe('codex-cli 0.167.1')
    const original = await readFile(path.join(codexHome, 'config.toml'), 'utf8')
    const temp = await mkdtemp(path.join(tmpdir(), 'murph-sandbox-temp-'))
    const slashTemp = await mkdtemp('/tmp/murph-sandbox-slash-temp-')
    roots.push(temp, slashTemp)
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const command = [
      `CODEX_HOME=${quote(codexHome)}`,
      // A shell write to host-owned config must fail before any later thread can reload it.
      `if printf '\n[mcp_servers.injected]\nurl="https://notes.example.com/mcp"\n' >> "$CODEX_HOME/config.toml" 2>/dev/null; then echo CONFIG_WRITE_ALLOWED; else echo CONFIG_WRITE_DENIED; fi`,
      `if cat "$CODEX_HOME/config.toml" >/dev/null 2>&1; then echo CONFIG_READ_ALLOWED; else echo CONFIG_READ_DENIED; fi`,
      `printf workspace-ok > workspace-proof.txt`,
      `printf temp-ok > ${quote(path.join(temp, 'proof.txt'))}`,
      `printf slash-temp-ok > ${quote(path.join(slashTemp, 'proof.txt'))}`,
    ].join('; ')
    stub.captureProviderRequestDiagnostics({ completeInput: true })
    stub.queue({ functionCall: { namespace: 'functions', name: 'exec_command', arguments: { cmd: command, login: false } } }, { text: 'Synthetic sandbox proof complete.' })
    const result = await executeCodexAppServerTurn({ ...scenario.turnInput,
      permissions: MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE, sandbox: undefined,
      approvalPolicy: 'never', runtimeWorkspaceRoots: [workingDirectory], dynamicTools: [],
      threadConfig: { project_doc_max_bytes: 0, allow_login_shell: false },
      prompt: 'Run the synthetic sandbox probe.',
    })
    expect(result.finalMessage).toBe('Synthetic sandbox proof complete.')
    const outputs = stub.requestSummariesSinceBaseline().flatMap(summary => summary.functionCallOutputs ?? []).join(' ')
    expect(outputs).toContain('CONFIG_WRITE_DENIED')
    expect(outputs).toContain('CONFIG_READ_DENIED')
    expect(outputs).not.toContain('CONFIG_WRITE_ALLOWED')
    expect(await readFile(path.join(codexHome, 'config.toml'), 'utf8')).toBe(original)
    expect(await readFile(path.join(workingDirectory, 'workspace-proof.txt'), 'utf8')).toBe('workspace-ok')
    expect(await readFile(path.join(temp, 'proof.txt'), 'utf8')).toBe('temp-ok')
    expect(await readFile(path.join(slashTemp, 'proof.txt'), 'utf8')).toBe('slash-temp-ok')
  } finally {
    await stopWarmCodexAppServer()
    await stub.close()
  }
}, 30_000)
