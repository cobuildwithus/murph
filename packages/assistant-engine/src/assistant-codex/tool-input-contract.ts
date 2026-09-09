import type { AssistantProviderDynamicTool } from '../assistant/providers/types.js'

/**
 * Codex's schema normalization and code-mode renderer are not lossless JSON
 * Schema transports. Keep the canonical document outside that schema object.
 * This is model-visible guidance, not a second validator or execution authority.
 */
export function withCodexToolInputContract(
  tool: AssistantProviderDynamicTool,
): AssistantProviderDynamicTool {
  const schemaJson = JSON.stringify(tool.inputSchema, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, record[key]]),
    )
  }).replaceAll('*/', '*\\/')
  const supplement = [
    '',
    '',
    'Canonical input contract: the following JSON is the complete input schema document (including reference scope). Follow all its constraints, not only the generated signature. Runtime validation remains authoritative.',
    `MURPH_INPUT_SCHEMA_JSON: ${schemaJson}`,
  ].join('\n')
  // Idempotent for repeated boundary composition; never mutate the catalog or
  // replace inputSchema, tool identity, loading policy, or handler dispatch.
  return tool.description.endsWith(supplement)
    ? tool
    : { ...tool, description: tool.description + supplement }
}
