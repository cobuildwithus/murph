import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { expect, it } from 'vitest'
import {
  HOSTED_ASSISTANT_ASTRA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
} from '@murphai/hosted-execution/assistant-model'
import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'

// Captured from the release verified against OpenAI in #5185. Revalidate changes
// on both live models before updating this independent, read-only fixture.
const acceptedParameters = JSON.parse(await readFile(
  new URL('./fixtures/hosted-web-run.parameters.json', import.meta.url), 'utf8',
))

it.each([
  { model: HOSTED_ASSISTANT_SOL_MODEL, astraAllowed: false },
  { model: HOSTED_ASSISTANT_SOL_MODEL, astraAllowed: true },
  { model: HOSTED_ASSISTANT_ASTRA_MODEL, astraAllowed: true },
])('emits the accepted web.run contract for $model (Astra catalog: $astraAllowed)', {
  timeout: 45_000,
}, async ({ model, astraAllowed }) => {
  const stub = await startScriptedResponsesStub()
  const directories: string[] = []
  try {
    const { turnInput } = await prepareScriptedTurnScenario(stub, directories, {
      model,
      // Custom providers must opt in to the native web tool. Otherwise a
      // synthetic turn can succeed without ever exercising reserved tool admission.
      additionalTomlLines: [
        'supports_standalone_web_search = true',
        '[features]',
        'standalone_web_search = true',
      ],
    })
    const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({
      // Temporary negative control for the PR's first CI run. Reproduce the
      // pre-#5185 catalog in this test only; the shipping Dockerfile stays fixed.
      dockerfile: (await readFile(new URL('../../../Dockerfile.cloudflare-hosted-runner', import.meta.url), 'utf8'))
        .replace('($launch[0].models | map(.experimental_supported_tools -= ["literature_search_query"]))', '$launch[0].models'),
      codexCommand: turnInput.codexCommand, directory: turnInput.codexHome, astraAllowed,
    })
    const { models } = JSON.parse(await readFile(catalog, 'utf8'))
    expect(models).toContainEqual(expect.objectContaining({ slug: model, tool_mode: 'code_mode' }))

    stub.captureProviderRequestDiagnostics({ completeInput: true })
    stub.queue({ text: 'ORCHID' })
    const result = await executeCodexAppServerTurn({
      ...turnInput,
      dynamicTools: [],
      prompt: 'Name a greenhouse flower.',
      env: { ...turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog },
    })
    expect(result.finalMessage).toBe('ORCHID')
    expect(stub.requestCountSinceBaseline()).toBe(1)
    const [request] = stub.requestSummariesSinceBaseline()
    assert.ok(request?.completeProviderInput)
    const body = readRecord(JSON.parse(request.completeProviderInput.json))
    assert.ok(body && Array.isArray(body.input))
    expect(body.model).toBe(model)
    const additionalTools = body.input.map(readRecord)
      .filter(item => item?.type === 'additional_tools')
      .flatMap(item => Array.isArray(item?.tools) ? item.tools : [])
    const tools = [...(Array.isArray(body.tools) ? body.tools : []), ...additionalTools].map(readRecord)
    const web = tools.filter(tool => tool?.name === 'web' || tool?.name === 'web.run')
    expect(web).toEqual([{
      type: 'namespace', name: 'web', description: expect.any(String),
      tools: [{
        type: 'function', name: 'run', strict: false, description: expect.any(String),
        parameters: acceptedParameters,
      }],
    }])
  } finally {
    await stopWarmCodexAppServer()
    await stub.close()
    await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true })))
  }
})
