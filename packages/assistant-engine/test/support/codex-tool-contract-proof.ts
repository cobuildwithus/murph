import assert from 'node:assert/strict'

import type { AssistantProviderDynamicTool } from '../../src/assistant/providers/types.ts'
import {
  readRecord,
  type ScriptedResponse,
  type ScriptedStub,
} from './codex-scripted-provider.ts'

// Deliberately independent of the adapter. The oracle is the ORIGINAL catalog
// document; the observed description must come back from the provider wire.
const SCHEMA_LINE = /^MURPH_INPUT_SCHEMA_JSON: (.+)$/gmu
const FRAME = /SCHEMA_METADATA_CHUNK=(\{[^\n]*\})/u
export const CONTRACT_CAPTURE_DONE = 'SYNTHETIC_CANONICAL_CONTRACTS_CAPTURED'

export interface VisibleToolContract {
  namespace: string
  name: string
  description: string
}

export function readNativeToolContracts(tools: readonly unknown[]): VisibleToolContract[] {
  return tools.flatMap((value) => {
    const tool = readRecord(value)
    if (!tool) return []
    if (Array.isArray(tool.tools)) {
      return readNativeToolContracts(tool.tools).map((child) => ({
        ...child,
        namespace: typeof tool.name === 'string' ? tool.name : child.namespace,
      }))
    }
    if (typeof tool.name !== 'string' || typeof tool.description !== 'string') return []
    return [{
      name: tool.name,
      namespace: typeof tool.namespace === 'string' ? tool.namespace : '',
      description: tool.description,
    }]
  })
}

export function readProviderNativeTools(json: string): VisibleToolContract[] {
  const body = readRecord(JSON.parse(json))
  assert.ok(body, 'complete provider request must be an object')
  const additional = (Array.isArray(body.input) ? body.input : [])
    .map(readRecord)
    .filter((item) => item?.type === 'additional_tools')
    .flatMap((item) => Array.isArray(item?.tools) ? item.tools : [])
  return readNativeToolContracts([
    ...(Array.isArray(body.tools) ? body.tools : []),
    ...additional,
  ])
}

export function readVisibleCanonicalSchema(description: string): object {
  const matches = [...description.matchAll(SCHEMA_LINE)]
  assert.equal(matches.length, 1, 'exactly one complete canonical schema supplement')
  const parsed: unknown = JSON.parse(matches[0]![1]!)
  assert.ok(parsed !== null && typeof parsed === 'object', 'canonical schema document')
  return parsed
}

export function assertModelVisibleToolContract(
  expected: AssistantProviderDynamicTool,
  observed: VisibleToolContract,
): void {
  assert.equal(observed.namespace, expected.namespace, 'tool namespace identity')
  assert.equal(observed.name, expected.name, 'tool name identity')
  // Code mode may prepend native namespace context. Require the unchanged
  // original description exactly once at its canonical-contract boundary,
  // without stripping prefixes or accepting a detached copy elsewhere.
  const descriptionBoundary = `${expected.description}\n\nCanonical input contract:`
  assert.equal(
    observed.description.split(descriptionBoundary).length,
    2,
    `${expected.namespace}.${expected.name}: complete original tool description exactly once at canonical boundary`,
  )
  assert.deepEqual(
    readVisibleCanonicalSchema(observed.description),
    expected.inputSchema,
    `${expected.namespace}.${expected.name}: exact canonical schema, including branch/ref scope and descriptions`,
  )
}

export function replaceVisibleSchema(
  observed: VisibleToolContract,
  schema: object,
): VisibleToolContract {
  return {
    ...observed,
    description: observed.description.replace(SCHEMA_LINE, () =>
      `MURPH_INPUT_SCHEMA_JSON: ${JSON.stringify(schema)}`),
  }
}

/**
 * Read ALL_TOOLS from real code-mode execution, not from registration inputs or
 * a test renderer. Every chunk reaches a subsequent Responses request. Length,
 * offset, identity and end coverage are checked before joining the metadata.
 * Small output chunks avoid confusing Codex's ordinary output budget with
 * schema loss. No input digest or test-owned schema is sent into the cell.
 */
export function queueCodeMetadataCapture(
  stub: ScriptedStub,
  tools: readonly AssistantProviderDynamicTool[],
): VisibleToolContract[] {
  const captured: VisibleToolContract[] = []
  let index = 0
  let offset = 0
  let totalLength: number | null = null
  let description = ''
  let awaitingChunk = false
  const response: ScriptedResponse = {
    respond: (request) => {
      stub.captureProviderRequestDiagnostics()
      if (awaitingChunk) {
        const output = request.customToolCallOutputs?.at(-1) ?? ''
        const frame = FRAME.exec(output)
        assert.ok(frame, 'untruncated generated metadata chunk on the provider wire')
        const chunk = readRecord(JSON.parse(frame[1]!))
        const expected = tools[index]!
        assert.equal(chunk?.name, `${expected.namespace}__${expected.name}`, 'ALL_TOOLS identity')
        assert.equal(chunk?.offset, offset, 'contiguous metadata offsets')
        if (index === 0 && offset === 0) {
          assert.deepEqual(chunk?.names, tools.map((tool) => `${tool.namespace}__${tool.name}`).sort(), 'no leaked or missing ALL_TOOLS registrations')
        }
        assert.ok(typeof chunk?.totalLength === 'number' && Number.isSafeInteger(chunk.totalLength))
        assert.ok(chunk.totalLength > 0 && chunk.totalLength < 2_000_000, 'bounded fixture metadata size')
        totalLength ??= chunk.totalLength
        assert.equal(chunk.totalLength, totalLength, 'metadata does not change between reads')
        assert.equal(typeof chunk.text, 'string', 'metadata chunk text')
        const text = chunk.text as string
        assert.equal(text.length, Math.min(2_000, totalLength - offset), 'complete chunk')
        description += text
        offset += text.length
        if (offset === totalLength) {
          assert.equal(description.length, totalLength, 'complete generated metadata length')
          captured.push({ namespace: expected.namespace, name: expected.name, description })
          index += 1
          offset = 0
          totalLength = null
          description = ''
        }
      }
      if (index === tools.length) return { text: CONTRACT_CAPTURE_DONE }
      const tool = tools[index]!
      const name = JSON.stringify(`${tool.namespace}__${tool.name}`)
      const prefixes = JSON.stringify([...new Set(['murph', ...tools.map((entry) => entry.namespace)])].map((namespace) => `${namespace}__`))
      const names = index === 0 && offset === 0
        ? `ALL_TOOLS.filter(t => ${prefixes}.some(prefix => t.name.startsWith(prefix))).map(t => t.name).sort()`
        : 'undefined'
      awaitingChunk = true
      stub.queue(response)
      return { customToolCall: {
        name: 'exec',
        input: `const t = ALL_TOOLS.find(t => t.name === ${name});
if (!t) throw new Error("Missing generated metadata for " + ${name});
text("SCHEMA_METADATA_CHUNK=" + JSON.stringify({names:${names},name:t.name,totalLength:t.description.length,offset:${offset},text:t.description.slice(${offset},${offset + 2_000})}));`,
      } }
    },
  }
  stub.queue(response)
  return captured
}
