import path from 'node:path'
import type { AssistantMemoryRecordProvenance } from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import { VAULT_ENV } from '../../operator-config.js'
import { normalizeNullableString } from '../shared.js'

const ASSISTANT_MEMORY_TURN_VAULT_ENV =
  'ASSISTANT_MEMORY_BOUND_VAULT'
const ASSISTANT_MEMORY_TURN_PRIVATE_CONTEXT_ENV =
  'ASSISTANT_MEMORY_BOUND_PRIVATE_CONTEXT'
const ASSISTANT_MEMORY_TURN_SOURCE_PROMPT_ENV =
  'ASSISTANT_MEMORY_BOUND_SOURCE_PROMPT'
const ASSISTANT_MEMORY_TURN_SESSION_ID_ENV =
  'ASSISTANT_MEMORY_BOUND_SESSION_ID'
const ASSISTANT_MEMORY_TURN_ID_ENV =
  'ASSISTANT_MEMORY_BOUND_TURN_ID'

export const assistantMemoryTurnEnvKeys = [
  VAULT_ENV,
  ASSISTANT_MEMORY_TURN_VAULT_ENV,
  ASSISTANT_MEMORY_TURN_PRIVATE_CONTEXT_ENV,
  ASSISTANT_MEMORY_TURN_SOURCE_PROMPT_ENV,
  ASSISTANT_MEMORY_TURN_SESSION_ID_ENV,
  ASSISTANT_MEMORY_TURN_ID_ENV,
] as const

export interface AssistantMemoryTurnContextInput {
  allowSensitiveHealthContext: boolean
  sessionId: string
  sourcePrompt: string
  turnId: string
  vault: string
}

export interface AssistantMemoryTurnContext {
  allowSensitiveHealthContext: boolean
  provenance: AssistantMemoryRecordProvenance
  sourcePrompt: string
  vault: string
}

export function createAssistantMemoryTurnContextEnv(
  input: AssistantMemoryTurnContextInput,
): NodeJS.ProcessEnv {
  const resolvedVault = path.resolve(input.vault)

  return {
    [VAULT_ENV]: resolvedVault,
    [ASSISTANT_MEMORY_TURN_ID_ENV]: input.turnId,
    [ASSISTANT_MEMORY_TURN_PRIVATE_CONTEXT_ENV]: input.allowSensitiveHealthContext
      ? '1'
      : '0',
    [ASSISTANT_MEMORY_TURN_SESSION_ID_ENV]: input.sessionId,
    [ASSISTANT_MEMORY_TURN_SOURCE_PROMPT_ENV]: input.sourcePrompt,
    [ASSISTANT_MEMORY_TURN_VAULT_ENV]: resolvedVault,
  }
}

export function resolveAssistantMemoryTurnContext(
  env: NodeJS.ProcessEnv = process.env,
): AssistantMemoryTurnContext | null {
  const vault = normalizeNullableString(env[ASSISTANT_MEMORY_TURN_VAULT_ENV])
  const sourcePrompt = normalizeNullableString(
    env[ASSISTANT_MEMORY_TURN_SOURCE_PROMPT_ENV],
  )
  const sessionId = normalizeNullableString(
    env[ASSISTANT_MEMORY_TURN_SESSION_ID_ENV],
  )
  const turnId = normalizeNullableString(env[ASSISTANT_MEMORY_TURN_ID_ENV])

  if (!vault || !sourcePrompt || !sessionId || !turnId) {
    return null
  }

  return {
    allowSensitiveHealthContext:
      env[ASSISTANT_MEMORY_TURN_PRIVATE_CONTEXT_ENV]?.trim() === '1',
    provenance: {
      writtenBy: 'assistant',
      sessionId,
      turnId,
    },
    sourcePrompt,
    vault: path.resolve(vault),
  }
}

export function assertAssistantMemoryTurnContextVault(
  context: AssistantMemoryTurnContext,
  vault: string,
): void {
  if (context.vault !== path.resolve(vault)) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_TURN_VAULT_MISMATCH',
      'Assistant memory turn context is only valid for the active assistant vault.',
    )
  }
}
