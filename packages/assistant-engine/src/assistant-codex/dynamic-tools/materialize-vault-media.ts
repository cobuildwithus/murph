import * as z from '@murphai/contracts/zod-runtime'
import { assistantVaultFileMaxBytes } from '@murphai/operator-config/assistant-cli-contracts'
import { readHostedMediaReferenceCatalogueValue } from '@murphai/runtime-state/node'
import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import type { AssistantWorkspaceArtifactMaterializer } from '../../assistant/execution-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

// Reject root selectors before handing paths to the broader workspace port.
const vaultRelativePathPattern = '^(?!/)(?![A-Za-z]:|(?:vault|operator-home):)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*[\\\\\\u0000-\\u001F\\u007F])[^/]+(?:/[^/]+)*$'
const vaultRelativePath = z.string().min(1).max(4096).regex(new RegExp(vaultRelativePathPattern, 'u'))
const argumentsSchema = z.object({
  paths: z.array(vaultRelativePath).min(1).max(100).optional(),
  all: z.literal(true).optional(),
}).strict().refine(value => (value.paths !== undefined) !== (value.all === true), 'Supply paths or all: true, not both.')

// Retention and deletion removed these on purpose. An export must not present
// them as failures, while an exact request still gets the specific reason.
const REMOVED_BY_POLICY: ReadonlySet<string> = new Set(['expired', 'obsolete'])

export const VAULT_MEDIA_EXPORT_GUIDANCE = 'call materialize_vault_media with all: true before archiving; disclose unavailable paths and reasons without claiming completeness. Unavailable means unrestored, not excluded: preserve any local copy as unverified. Never drop files to fit the 100 MiB send cap; if the finished ZIP exceeds it, report that it cannot be sent. Archive'

export const MURPH_MATERIALIZE_VAULT_MEDIA_TOOL = {
  namespace: 'murph',
  name: 'materialize_vault_media',
  deferLoading: true,
  description: 'Restore retained vault media when a saved photo or file is missing locally, or before an export. Supply exact vault-relative paths, or all: true for the full hosted catalogue including cold history. Returns counts and unavailable paths/reasons, never bytes. Unavailable files were not verified; disclose them rather than claiming a complete export. `removed` counts media already gone through retention or deletion, which is expected.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      paths: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 4096, pattern: vaultRelativePathPattern } },
      all: { type: 'boolean', const: true },
    },
    oneOf: [{ required: ['paths'] }, { required: ['all'] }],
  },
} as const

export function parseMaterializeVaultMediaArguments(value: unknown) {
  return parseDynamicToolArguments({ schema: argumentsSchema, schemaRootKeys: ['paths', 'all'], toolName: 'murph.materialize_vault_media', value })
}

export function readMaterializeVaultMediaToolRequest(request: { tool: string | null; arguments: unknown }):
  | { kind: 'materialize-vault-media'; args: z.infer<typeof argumentsSchema> }
  | { kind: 'invalid-materialize-vault-media-arguments'; validationDigest: SafeToolCallValidationDigest }
  | null {
  if (request.tool !== MURPH_MATERIALIZE_VAULT_MEDIA_TOOL.name) return null
  const parsed = parseMaterializeVaultMediaArguments(request.arguments)
  return parsed.ok
    ? { kind: 'materialize-vault-media', args: parsed.args }
    : { kind: 'invalid-materialize-vault-media-arguments', validationDigest: parsed.validationDigest }
}

export async function materializeVaultMedia(input: {
  args: z.infer<typeof argumentsSchema>
  vaultRoot: string
  materialize: AssistantWorkspaceArtifactMaterializer
  signal?: AbortSignal | null
}) {
  input.signal?.throwIfAborted()
  const paths = input.args.all
    ? (await readHostedMediaReferenceCatalogueValue(input.vaultRoot)).entries.map(entry => {
        // The catalogue reader owns descriptor interpretation; only vault scope
        // is checked here. Do not silently skip an invalid catalogue path.
        const value = z.object({ relativePath: vaultRelativePath }).parse(entry)
        return value.relativePath
      })
    : input.args.paths ?? []
  const uniquePaths = [...new Set(paths)]
  const unavailable: { path: string; reason: string }[] = []
  let available = 0
  let removed = 0
  // The port already processes media sequentially and reads the catalogue once.
  // Keep a bulk request together rather than re-reading it for every batch.
  const result = await input.materialize(uniquePaths.map(ref => `vault:${ref}`), {
    maxFileBytes: assistantVaultFileMaxBytes, signal: input.signal,
  })
  for (const ref of uniquePaths) {
    const key = `vault:${ref}`
    const reason = result.missingArtifactPaths.get(key)
    if (!reason && result.materializedArtifactPaths.has(key)) available += 1
    else if (input.args.all && reason && REMOVED_BY_POLICY.has(reason)) removed += 1
    else unavailable.push({ path: ref, reason: reason ?? 'missing' })
  }
  input.signal?.throwIfAborted()
  return { requested: uniquePaths.length, available, removed, unavailable }
}
