import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import {
  executeCodexAppServerTurn,
  resolveMurphDynamicTools,
  stopWarmCodexAppServer,
} from '../src/assistant-codex.ts'
import {
  buildCodexThreadResumeParams,
  buildCodexThreadStartParams,
} from '../src/assistant-codex/app-server-requests.ts'
import {
  MURPH_GENERATE_SONG_TOOL,
  parseGenerateSongArguments,
} from '../src/assistant-codex/dynamic-tools/generate-song.ts'
import { MURPH_AUTOMATION_TOOL } from '../src/assistant-codex/dynamic-tools/automation.ts'
import type { AssistantProviderDynamicTool } from '../src/assistant/providers/types.ts'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { assertNoSongAttachmentFailure } from './support/song-receipt-proof.ts'
import {
  prepareScriptedTurnScenario,
  readRecord,
  startScriptedResponsesStub,
  type ScriptedStub,
  type ScriptedResponse,
} from './support/codex-scripted-provider.ts'
import {
  collectCanonicalToolInventory,
  partitionToolInventory,
} from './support/codex-tool-contract-inventory.ts'
import {
  assertModelVisibleToolContract,
  CONTRACT_CAPTURE_DONE,
  queueCodeMetadataCapture,
  readNativeToolContracts,
  readProviderNativeTools,
  readVisibleCanonicalSchema,
  replaceVisibleSchema,
  type VisibleToolContract,
} from './support/codex-tool-contract-proof.ts'

// This lane is default-on and credential-free. It starts the installed, pinned
// App Server, with only a loopback Responses endpoint. No converter is mocked.
const MODES = ['eager-native', 'deferred-native', 'code-only'] as const
const inventory = collectCanonicalToolInventory()
const temporaryPaths: string[] = []
let stub: ScriptedStub | null = null
const noExternalFetch: typeof fetch = async () => { throw new Error('Unexpected external effect') }

const sentinel = {
  namespace: 'schema_sentinel',
  name: 'complete_contract',
  description: 'Synthetic only: preserve café, 漢字, "quotes", backslashes \\ and */ without changing meaning.',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://schema.invalid/contract',
    title: 'Complete synthetic contract',
    description: 'Root description: not a keyword-presence test.\nSecond line */ café.',
    type: 'object',
    additionalProperties: false,
    minProperties: 2,
    maxProperties: 12,
    propertyNames: { pattern: '^[a-z][A-Za-z]+$' },
    $defs: {
      label: { type: 'string', minLength: 2, maxLength: 17, pattern: '^[A-Z]+$', description: 'Root-scoped label' },
      scoped: {
        $id: 'nested',
        type: 'object',
        $defs: { label: { type: 'string', const: 'SCOPED', description: 'Nested scope, not root label' } },
        properties: { local: { $ref: '#/$defs/label' } },
        required: ['local'],
        additionalProperties: false,
      },
    },
    definitions: { legacy: { type: 'integer', minimum: 41, maximum: 43 } },
    properties: {
      mode: { type: 'string', enum: ['brief', 'detailed'], default: 'brief' },
      count: { type: 'number', minimum: 2, maximum: 19, exclusiveMinimum: 1, exclusiveMaximum: 20, multipleOf: 0.5 },
      label: { $ref: '#/$defs/label', description: 'Keep reference plus sibling annotation' },
      legacy: { $ref: '#/definitions/legacy' },
      scoped: { $ref: '#/$defs/scoped' },
      nullable: { type: ['string', 'null'], minLength: 3, maxLength: 11, default: null },
      email: { type: 'string', format: 'email', maxLength: 123, examples: ['synthetic@example.invalid'] },
      rows: {
        type: 'array', minItems: 1, maxItems: 6, uniqueItems: true,
        items: {
          type: 'object', additionalProperties: false, minProperties: 1, maxProperties: 2,
          properties: {
            cells: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 23, pattern: '^cell-' } },
            tag: { type: 'string', const: 'ROW', description: 'Row-specific constant' },
          },
          required: ['cells'],
        },
      },
      branch: {
        type: 'object',
        oneOf: [
          { type: 'object', properties: { kind: { type: 'string', const: 'short' }, value: { type: 'string', maxLength: 7, description: 'Only short branch' } }, required: ['kind', 'value'], additionalProperties: false },
          { type: 'object', properties: { kind: { type: 'string', const: 'long' }, value: { type: 'string', minLength: 8, maxLength: 31, description: 'Only long branch' } }, required: ['kind', 'value'], additionalProperties: false },
        ],
      },
    },
    required: ['mode', 'rows'],
    anyOf: [{ type: 'object', required: ['label'] }, { type: 'object', required: ['branch'] }],
    allOf: [{ type: 'object', properties: { count: { type: 'number', maximum: 18 } } }],
    if: { properties: { mode: { const: 'detailed' } }, required: ['mode'] },
    then: { required: ['branch'], properties: { rows: { minItems: 3 } } },
    else: { properties: { rows: { maxItems: 2 } } },
    dependentRequired: { email: ['label'] },
    not: { required: ['legacy', 'scoped'] },
  },
} satisfies AssistantProviderDynamicTool
const largeSentinel: AssistantProviderDynamicTool = {
  ...sentinel,
  name: 'large_contract',
  inputSchema: {
    ...sentinel.inputSchema,
    // Above Codex's current 5,000-byte compaction boundary, with constraints
    // after the padding. Neither definitions nor the deep tail may disappear.
    description: 'Large schema description. '.repeat(260),
    properties: {
      ...sentinel.inputSchema.properties,
      tail: {
        type: 'object', required: ['payload'], additionalProperties: false,
        properties: { payload: { type: 'object', properties: { value: { type: 'string', maxLength: 29, description: 'FINAL_DEEP_SENTINEL_DESCRIPTION' } }, required: ['value'], additionalProperties: false } },
      },
    },
  },
}

afterEach(async () => {
  await stopWarmCodexAppServer()
  stub?.resetQueue()
})
afterAll(async () => {
  await stub?.close()
  await Promise.all(temporaryPaths.map((directory) => rm(directory, { recursive: true, force: true })))
})

function registration(tools: readonly AssistantProviderDynamicTool[]) {
  return {
    approvalPolicy: 'never' as const,
    dynamicTools: tools,
    prompt: 'Synthetic contract inspection only.',
    workingDirectory: '/synthetic-contract-fixture',
  }
}

async function observeContracts(
  tools: readonly AssistantProviderDynamicTool[],
  mode: typeof MODES[number],
): Promise<VisibleToolContract[]> {
  stub ??= await startScriptedResponsesStub()
  const scenario = await prepareScriptedTurnScenario(stub, temporaryPaths)
  const modelCatalogJson = await writeHostedOpenAiMixedModeModelCatalogJson({
    codexCommand: scenario.turnInput.codexCommand,
    directory: scenario.turnInput.codexHome,
    ...(mode === 'code-only' ? { toolMode: 'code_mode_only' } : {}),
  })
  const registered = tools.map((tool) => ({ ...tool, deferLoading: mode !== 'eager-native' }))
  stub.captureProviderRequestDiagnostics({ completeInput: true })
  let codeMetadata: VisibleToolContract[] = []
  if (mode === 'code-only') {
    codeMetadata = queueCodeMetadataCapture(stub, registered)
  } else if (mode === 'deferred-native' && tools.length > 0) {
    // Search ranks descriptions, so a top-1 name query can select another tool.
    // Every entry includes its namespace; leave room for the entire fixture.
    const namespaces = [...new Set(tools.map((tool) => tool.namespace))]
    stub.queue(...namespaces.map((namespace, index) => ({
      ...(index === 0 ? { beforeRespond: async () => { stub!.captureProviderRequestDiagnostics() } } : {}),
      toolSearchCall: { query: namespace, limit: tools.length },
    })), { text: CONTRACT_CAPTURE_DONE })
  } else {
    stub.queue({ text: CONTRACT_CAPTURE_DONE })
  }
  const result = await executeCodexAppServerTurn({
    ...scenario.turnInput,
    dynamicTools: registered,
    env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: modelCatalogJson },
    fetchImpl: noExternalFetch,
    prompt: 'Inspect synthetic tool contracts; do not invoke a Murph tool or make any external call.',
  })
  expect(result.finalMessage).toBe(CONTRACT_CAPTURE_DONE)
  expect(result.runtimeIssueInputs).toEqual([])
  expect(result.responseCard).toBeNull()
  expect(result.responseMedia).toEqual([])
  expect(result.jsonEvents.filter((event) => readRecord(event)?.method === 'item/tool/call')).toEqual([])
  const summaries = stub.requestSummariesSinceBaseline()
  const first = summaries[0]?.completeProviderInput
  assert.ok(first, 'complete first request captured after real App Server conversion')
  if (mode !== 'eager-native') {
    // This must remain deferred: the first request may advertise a search or
    // ALL_TOOLS facility, but must not eagerly contain the full contracts.
    expect(first.json).not.toContain('MURPH_INPUT_SCHEMA_JSON:')
  }
  const observed = mode === 'code-only'
    ? codeMetadata
    : mode === 'eager-native'
      ? readProviderNativeTools(first.json)
      : readNativeToolContracts(summaries.flatMap((summary) => summary.toolSearchOutputTools ?? []))
  if (mode !== 'code-only') {
    const ownedNamespaces = new Set(['murph', ...tools.map((tool) => tool.namespace)])
    const identities = observed.filter((tool) => ownedNamespaces.has(tool.namespace))
      .map((tool) => `${tool.namespace}.${tool.name}`)
    expect([...new Set(identities)].sort(), 'no leaked or missing native registrations').toEqual(
      tools.map((tool) => `${tool.namespace}.${tool.name}`).sort(),
    )
    if (mode === 'eager-native') expect(identities).toHaveLength(tools.length)
  }
  const selected = tools.map((tool) => {
    const match = observed.find((candidate) => candidate.namespace === tool.namespace && candidate.name === tool.name)
    assert.ok(match, `actual provider-visible contract missing: ${tool.namespace}.${tool.name}`)
    assertModelVisibleToolContract(tool, match)
    return match
  })
  // Fingerprint OBSERVED, complete provider-visible documents, not inputs sent
  // to Codex. Digests supplement (never substitute for) structural equality.
  process.stdout.write(`[codex-contract-proof] ${JSON.stringify({
    mode, tools: tools.length, providerRequests: summaries.length,
    observedUtf8Bytes: selected.reduce((sum, tool) => sum + Buffer.byteLength(tool.description), 0),
    observedSha256: createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
  })}\n`)
  await stopWarmCodexAppServer()
  return selected
}

function assertRejectsDamagedProof(expected: AssistantProviderDynamicTool, observed: VisibleToolContract): void {
  // Each mutation starts from content actually returned by the pinned runtime.
  // Whole-document equality checks the value AND its precise branch location.
  const mutations: [string, (schema: typeof sentinel.inputSchema) => void][] = [
    ['removed bound', (s) => { Reflect.deleteProperty(s.properties.rows, 'maxItems') }],
    ['altered bound', (s) => { s.properties.count.minimum = 0 }],
    ['removed required', (s) => { s.required = ['mode'] }],
    ['altered enum', (s) => { s.properties.mode.enum.push('other') }],
    ['changed type', (s) => { s.properties.count.type = 'string' }],
    ['removed branch', (s) => { s.properties.branch.oneOf.pop() }],
    ['branch-specific required loss', (s) => { s.properties.branch.oneOf[1].required = ['kind'] }],
    ['bound moved to wrong branch', (s) => { s.properties.branch.oneOf[0].properties.value.maxLength = 31; s.properties.branch.oneOf[1].properties.value.maxLength = 7 }],
    ['removed keyword', (s) => { Reflect.deleteProperty(s.properties.email, 'format') }],
    ['changed property description', (s) => { s.$defs.label.description = 'Wrong meaning' }],
    ['changed reference scope', (s) => { Reflect.deleteProperty(s.$defs.scoped, '$id') }],
  ]
  for (const [label, mutate] of mutations) {
    const schema = structuredClone(readVisibleCanonicalSchema(observed.description)) as typeof sentinel.inputSchema
    mutate(schema)
    expect(() => assertModelVisibleToolContract(expected, replaceVisibleSchema(observed, schema)), label).toThrow(/exact canonical schema/u)
  }
  expect(() => assertModelVisibleToolContract(expected, { ...observed, name: 'wrong_tool' })).toThrow(/identity/u)
  expect(() => assertModelVisibleToolContract(expected, { ...observed, namespace: 'wrong_route' })).toThrow(/identity/u)
  expect(() => assertModelVisibleToolContract(expected, { ...observed, description: observed.description.replace(expected.description, 'Lost tool description') })).toThrow(/original tool description/u)
  // A surviving copy in namespace context cannot hide loss at the boundary.
  expect(() => assertModelVisibleToolContract(expected, {
    ...observed,
    description: `${expected.description}\n\n${observed.description.replace(expected.description, 'Lost tool description')}`,
  })).toThrow(/original tool description/u)
  const marker = observed.description.indexOf('MURPH_INPUT_SCHEMA_JSON:')
  expect(() => assertModelVisibleToolContract(expected, { ...observed, description: observed.description.slice(0, marker + 80) })).toThrow()
  const schemaLine = /^MURPH_INPUT_SCHEMA_JSON: .+$/mu.exec(observed.description)![0]
  expect(() => assertModelVisibleToolContract(expected, { ...observed, description: `${observed.description}\n${schemaLine}` })).toThrow(/exactly one/u)
}

describe('Codex canonical tool input contract upgrade guard', () => {
  it('preserves every catalog/route registration, loading policy and schema without mutation or duplicate supplements', () => {
    // No frozen tool count or name list: additions to canonical registrations
    // automatically join the real-runtime matrix below.
    expect(inventory.length).toBeGreaterThan(0)
    const quiet = resolveMurphDynamicTools({ allowFinishWithoutReply: true, imageGenerationAvailable: false, progressUpdatesAvailable: false })
    for (const tools of [[], quiet, ...partitionToolInventory(inventory)]) {
      const before = JSON.stringify(tools)
      const start = buildCodexThreadStartParams(registration(tools))
      const offered = start.dynamicTools as AssistantProviderDynamicTool[]
      expect(offered).toHaveLength(tools.length)
      offered.forEach((tool, index) => {
        const original = tools[index]!
        expect(tool.inputSchema).toBe(original.inputSchema)
        expect({ ...tool, description: original.description }).toEqual(original)
        assertModelVisibleToolContract(original, tool)
      })
      expect(JSON.stringify(tools)).toBe(before)
      const repeated = buildCodexThreadStartParams(registration(offered)).dynamicTools
      expect(repeated).toEqual(offered)
      expect(buildCodexThreadResumeParams({ input: registration(tools), codexThreadId: 'existing-thread' })).not.toHaveProperty('dynamicTools')
    }
  })

  it.skipIf(process.env.MURPH_MEASURE_AUTOMATION_INPUT !== '1').each(['direct', 'group'] as const)(
    'automation edit: complete first provider input (%s)', { timeout: 90_000 }, async (scope) => {
      stub ??= await startScriptedResponsesStub()
      const scenario = await prepareScriptedTurnScenario(stub, temporaryPaths)
      const tools = resolveMurphDynamicTools({
        allowFinishWithoutReply: true,
        automationAvailable: true,
        groupSharedReadAvailable: scope === 'group',
        imageGenerationAvailable: false,
        progressUpdatesAvailable: true,
        progressUpdateMode: scope,
      })
      const layers = buildAssistantSystemPromptLayers({
        assistantCliContract: null, assistantHostedAutomationAvailable: true,
        assistantProgressUpdatesAvailable: true, channel: 'linq',
        cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
        conversationScope: scope, currentLocalDate: '2026-10-14',
        currentInstant: '2026-10-14T16:00:00.000Z', currentTimeZone: 'America/New_York',
        hostedRuntime: true, modelBehaviorProfile: 'gpt5-agentic',
        onboardingGuidance: false, ordinaryInboundTurn: true,
      })
      const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({
        codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome,
      })
      stub.captureProviderRequestDiagnostics({ completeInput: true })
      stub.queue({ text: CONTRACT_CAPTURE_DONE })
      await executeCodexAppServerTurn({
        ...scenario.turnInput, dynamicTools: tools,
        developerInstructions: [layers.staticCacheableCorePrompt, layers.stableRouteCapabilityPrompt, layers.threadContextPrompt].join('\n\n'),
        prompt: [layers.dynamicTurnContextPrompt, 'Update the wording of my existing reminders.'].join('\n\n'),
        env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog },
      })
      const captured = stub.requestSummariesSinceBaseline()[0]?.completeProviderInput
      assert.ok(captured)
      const body = readRecord(JSON.parse(captured.json))
      assert.ok(body)
      delete body.prompt_cache_key
      process.stdout.write('[automation-input-proof] ' + JSON.stringify({
        scope, decodedRequestUtf8Bytes: Buffer.byteLength(JSON.stringify(body)),
        automationRegistrationUtf8Bytes: Buffer.byteLength(JSON.stringify(MURPH_AUTOMATION_TOOL)),
        tokens: null, tokenLimitation: 'No exact Terra tokenizer configured.',
        exclusions: ['prompt_cache_key'],
      }) + '\n')
    },
  )

  it('renders actionable automation edit types in real Codex code-mode discovery', { timeout: 180_000 }, async () => {
    const [observed] = await observeContracts([MURPH_AUTOMATION_TOOL], 'code-only')
    assert.ok(observed)
    const declaration = observed.description.replace(/^MURPH_INPUT_SCHEMA_JSON: .+$/mu, '')
    expect(/expectedUpdatedAt:\s*string/u.test(declaration), 'required typed edit version').toBe(true)
    expect(/expectedUpdatedAt\??:\s*unknown/u.test(declaration), 'no unknown edit version').toBe(false)
    expect(observed.description.includes('Required current automation updatedAt'), 'canonical version readback documentation').toBe(true)
    expect(/lookup:\s*string/u.test(declaration), 'typed exact lookup').toBe(true)
    expect(/instructions\??:\s*string/u.test(declaration), 'typed replacement instructions').toBe(true)
  })

  it.each(MODES)('preserves complete sentinel contracts and rejects corrupted runtime evidence (%s)', { timeout: 180_000 }, async (mode) => {
    expect(Buffer.byteLength(JSON.stringify(sentinel.inputSchema))).toBeLessThan(5_000)
    expect(Buffer.byteLength(JSON.stringify(largeSentinel.inputSchema))).toBeGreaterThan(5_000)
    const observed = await observeContracts([sentinel, largeSentinel], mode)
    assertRejectsDamagedProof(sentinel, observed[0]!)
    assertRejectsDamagedProof(largeSentinel, observed[1]!)
    const prefixed = {
      ...observed[0]!,
      description: `Synthetic namespace context.\n\n${observed[0]!.description}`,
    }
    assertModelVisibleToolContract(sentinel, prefixed)
    assertRejectsDamagedProof(sentinel, prefixed)
  })

  it.each(MODES)('preserves the complete automatically collected catalog and route-only variants (%s)', { timeout: 600_000 }, async (mode) => {
    for (const batch of partitionToolInventory(inventory)) {
      const before = JSON.stringify(batch)
      await observeContracts(batch, mode)
      expect(JSON.stringify(batch)).toBe(before)
    }
  })

  it.each([
    { label: 'empty', tools: [] },
    { label: 'quiet', tools: resolveMurphDynamicTools({ allowFinishWithoutReply: true, imageGenerationAvailable: false, progressUpdatesAvailable: false }) },
  ])(
    'keeps $label routes isolated at the native provider boundary',
    { timeout: 90_000 },
    async ({ tools }) => {
      const observed = await observeContracts(tools, 'eager-native')
      expect(observed.map(({ namespace, name }) => `${namespace}.${name}`)).toEqual(tools.map(({ namespace, name }) => `${namespace}.${name}`))
    },
  )

  it.each(['native', 'code-only'] as const)('keeps invalid calls effect-free and generates exactly once after correction (%s)', { timeout: 90_000 }, async (mode) => {
    stub ??= await startScriptedResponsesStub()
    const scenario = await prepareScriptedTurnScenario(stub, temporaryPaths)
    const modelCatalogJson = await writeHostedOpenAiMixedModeModelCatalogJson({
      codexCommand: scenario.turnInput.codexCommand,
      directory: scenario.turnInput.codexHome,
      ...(mode === 'code-only' ? { toolMode: 'code_mode_only' } : {}),
    })
    const bounds = MURPH_GENERATE_SONG_TOOL.inputSchema.properties
    const valid = { durationSeconds: bounds.durationSeconds.maximum, instrumental: true, prompt: 'p'.repeat(bounds.prompt.maxLength) }
    const calls = [
      { ...valid, durationSeconds: bounds.durationSeconds.minimum - 1 },
      { ...valid, durationSeconds: bounds.durationSeconds.maximum + 1 },
      { ...valid, prompt: valid.prompt + 'p' },
      valid,
    ]
    const responses: ScriptedResponse[] = calls.map((argumentsValue) => mode === 'native'
      ? { functionCall: { name: 'generate_song', namespace: 'murph', arguments: argumentsValue } }
      : { customToolCall: { name: 'exec', input: `text(await tools.murph__generate_song(${JSON.stringify(argumentsValue)}));` } })
    stub.queue(...responses, {
      respond: (request) => {
        // Observe what the next model request actually receives from the REAL
        // CLI, not just a successful dynamic event or attached host-side media.
        const output = (mode === 'code-only'
          ? request.customToolCallOutputs : request.functionCallOutputs)?.at(-1)
        expect(output).toContain('generated song attached to the final response')
        expect(output).not.toMatch(/Script failed|expects an image generation result object|TypeError|ReferenceError/iu)
        return { text: `Generated one ${valid.durationSeconds}-second synthetic instrumental.` }
      },
    })
    const generations: unknown[] = []
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: [MURPH_GENERATE_SONG_TOOL],
      env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: modelCatalogJson },
      fetchImpl: noExternalFetch,
      publicInternetFetch: noExternalFetch,
      prompt: 'Generate one synthetic original instrumental. This local protocol test deliberately attempts invalid arguments before correction.',
      voiceMemoRuntime: {
        elevenLabs: { apiKeyAvailable: true, modelId: 'eleven_multilingual_v2', voiceId: 'voice_synthetic' },
        kind: 'linq',
        generateAndUpload: async (input) => {
          generations.push(input.generation)
          return { attachmentId: 'attachment_synthetic_schema_song', filename: 'synthetic-schema-song.mp3' }
        },
      },
    })
    expect(generations).toEqual([expect.objectContaining({
      durationMs: valid.durationSeconds * 1_000,
      forceInstrumental: true,
      kind: 'elevenlabs_music',
      prompt: valid.prompt,
    })])
    const attempts = result.jsonEvents.filter((event) => readRecord(event)?.method === 'item/tool/call')
    expect(attempts).toHaveLength(calls.length)
    const completions = result.jsonEvents.map(readRecord)
      .filter((event) => event?.method === 'item/completed')
      .map((event) => readRecord(readRecord(event?.params)?.item))
      .filter((item) => item?.type === 'dynamicToolCall')
    expect(completions.map((item) => item?.success)).toEqual([false, false, false, true])
    expect(completions.at(-1)).toMatchObject({
      tool: MURPH_GENERATE_SONG_TOOL.name,
      contentItems: [{ type: 'inputText', text: 'generated song attached to the final response' }],
    })
    expect(stub.requestCountSinceBaseline()).toBe(calls.length + 1)
    expect(result.responseCard).toBeNull()
    expect(result.responseMedia).toEqual([{
      filename: 'synthetic-schema-song.mp3', kind: 'voice_memo', transcript: null,
      transport: { attachmentId: 'attachment_synthetic_schema_song', kind: 'linq_attachment' },
    }])
    expect(result.finalMessage).toBe(`Generated one ${valid.durationSeconds}-second synthetic instrumental.`)
  })

  it('rejects false attachment claims without rejecting truthful duration limits', () => {
    const duration = MURPH_GENERATE_SONG_TOOL.inputSchema.properties.durationSeconds.maximum
    const prefix = `I made ${duration} seconds, shortened from ${duration + 60}. `
    // Includes the parent's synthetic false-pass reply and both claim orders.
    for (const claim of [
      'The audio attachment could not be completed.',
      'The audio attachment couldn’t be completed.',
      'I could not attach the audio.',
      'I can’t deliver the file.',
      'The attachment failed.',
      'The audio is unavailable.',
      'Audio attachments are unsupported.',
      'Audio attachments aren’t supported here.',
      'The file is not attached.',
      'I do not support audio attachments.',
    ]) expect(() => assertNoSongAttachmentFailure(prefix + claim)).toThrow(/attached song/iu)
    for (const reply of [
      prefix + 'Your audio is attached.',
      `Your track is attached, shortened because ${duration + 60} seconds is not supported.`,
      `I could not provide ${duration + 60} seconds, so I shortened it to ${duration}. Your audio is attached.`,
      `The ${duration + 60}-second duration is unsupported, so I shortened it to ${duration} seconds. Your track is attached.`,
    ]) expect(() => assertNoSongAttachmentFailure(reply)).not.toThrow()
  })

  it('retains tight canonical song admission including defaults and one-over boundaries', () => {
    const schema = MURPH_GENERATE_SONG_TOOL.inputSchema.properties
    for (const durationSeconds of [schema.durationSeconds.minimum, schema.durationSeconds.maximum]) {
      expect(parseGenerateSongArguments({ prompt: 'x'.repeat(schema.prompt.maxLength), durationSeconds }).ok).toBe(true)
    }
    for (const args of [
      { prompt: 'x', durationSeconds: schema.durationSeconds.minimum - 1 },
      { prompt: 'x', durationSeconds: schema.durationSeconds.maximum + 1 },
      { prompt: 'x'.repeat(schema.prompt.maxLength + 1) },
      { prompt: '' }, {}, { prompt: 'x', unexpected: true },
    ]) expect(parseGenerateSongArguments(args).ok).toBe(false)
    expect(parseGenerateSongArguments({ prompt: 'x' })).toMatchObject({ ok: true, args: { durationSeconds: schema.durationSeconds.default, instrumental: schema.instrumental.default, prompt: 'x' } })
  })
})
