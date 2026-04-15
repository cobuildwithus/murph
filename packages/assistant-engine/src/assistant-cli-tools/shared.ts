export interface AssistantToolContext {
  allowSensitiveHealthContext?: boolean
  captureId?: string
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('../assistant/execution-context.js').AssistantExecutionContext | null
  inboxServices?: import('@murphai/inbox-services').InboxServices
  requestId?: string | null
  sessionId?: string | null
  vault: string
  vaultServices?: import('@murphai/vault-usecases/vault-services').VaultServices
  workingDirectory?: string | null
}

export interface AssistantToolCatalogOptions {
  includeAssistantRuntimeTools?: boolean
  includeCanonicalWriteTools?: boolean
  includeOutwardSideEffectTools?: boolean
  includeQueryTools?: boolean
  includeStatefulWriteTools?: boolean
  includeVaultTextReadTool?: boolean
  includeWebSearchTools?: boolean
}

export interface AssistantCliLlmsManifestSchemaNode {
  description?: string
  enum?: readonly string[]
  items?: AssistantCliLlmsManifestSchemaNode
  properties?: Record<string, AssistantCliLlmsManifestSchemaNode>
  required?: readonly string[]
  type?: string
}

export interface AssistantCliLlmsManifestCommandSchema {
  args?: AssistantCliLlmsManifestSchemaNode
  options?: AssistantCliLlmsManifestSchemaNode
  output?: AssistantCliLlmsManifestSchemaNode
}

export interface AssistantCliLlmsManifestCommand {
  description?: string
  examples?: readonly unknown[]
  name: string
  schema?: AssistantCliLlmsManifestCommandSchema
}

export interface AssistantCliLlmsManifest {
  commands: AssistantCliLlmsManifestCommand[]
  version?: string
}

export const assistantToolTextReadDefaultMaxChars = 8_000
export const assistantToolTextReadMaxChars = 20_000
export const assistantToolTextReadChunkBytes = 4_096
export const assistantCliExecutorToolName = 'vault.cli.run'
export const assistantCliDefaultTimeoutMs = 10 * 60 * 1000
export const assistantCliMaxTimeoutMs = 60 * 60 * 1000
export const assistantCliMaxOutputChars = 80_000
