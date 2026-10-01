import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AssistantOnboardingCompletionReason,
  AssistantOnboardingState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantOnboardingCompletionReasonValues,
} from '@murphai/operator-config/assistant-cli-contracts'
import * as z from '@murphai/contracts/zod-runtime'

import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { resolveAssistantStateDocumentPath } from './state.js'
import { resolveAssistantStatePaths } from './store/paths.js'

const ASSISTANT_ONBOARDING_STATE_DOC_ID = 'onboarding/conversation'
const ASSISTANT_ONBOARDING_STATE_SCHEMA_VERSION =
  'murph.assistant-onboarding.v1' as const
const ASSISTANT_ONBOARDING_STATE_RELATIVE_PATH =
  '.runtime/operations/assistant/state/onboarding/conversation.json' as const

const assistantPersistedOnboardingStateSchema = z
  .object({
    schemaVersion: z.literal(ASSISTANT_ONBOARDING_STATE_SCHEMA_VERSION),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    completedAt: z.string().min(1).nullable(),
    completedReason: z
      .enum(assistantOnboardingCompletionReasonValues)
      .nullable(),
  })
  .strict()

type AssistantPersistedOnboardingState = z.infer<
  typeof assistantPersistedOnboardingStateSchema
>

type AssistantOnboardingStateReadFailureReason =
  | 'invalid-json'
  | 'invalid-schema'
  | 'read-failed'

export class AssistantOnboardingStateReadError extends Error {
  readonly reason: AssistantOnboardingStateReadFailureReason
  readonly relativeStatePath = ASSISTANT_ONBOARDING_STATE_RELATIVE_PATH

  constructor(input: {
    cause: unknown
    reason: AssistantOnboardingStateReadFailureReason
  }) {
    super(buildAssistantOnboardingStateReadErrorMessage(input.reason), {
      cause: input.cause,
    })
    this.name = 'AssistantOnboardingStateReadError'
    this.reason = input.reason
  }
}

export function isAssistantOnboardingStateReadError(
  error: unknown,
): error is AssistantOnboardingStateReadError {
  return error instanceof AssistantOnboardingStateReadError
}

export function resolveAssistantOnboardingStatePath(vault: string): string {
  return resolveAssistantStateDocumentPath(
    resolveAssistantStatePaths(vault),
    ASSISTANT_ONBOARDING_STATE_DOC_ID,
  )
}

export async function readAssistantOnboardingState(
  vault: string,
): Promise<AssistantOnboardingState> {
  const stateDirectory = resolveAssistantStatePaths(vault).stateDirectory
  const statePath = resolveAssistantStateDocumentPath(
    { stateDirectory },
    ASSISTANT_ONBOARDING_STATE_DOC_ID,
  )

  try {
    const raw = await readFile(statePath, 'utf8')
    return normalizeAssistantOnboardingState(
      parsePersistedAssistantOnboardingState(raw),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return createDefaultAssistantOnboardingState()
    }

    if (isAssistantOnboardingStateReadError(error)) {
      throw error
    }

    throw new AssistantOnboardingStateReadError({
      cause: error,
      reason: 'read-failed',
    })
  }
}

export async function completeAssistantOnboarding(input: {
  completedAt?: string
  reason: AssistantOnboardingCompletionReason
  vault: string
}): Promise<AssistantOnboardingState> {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const existing = await readAssistantOnboardingStateForExplicitWrite(input.vault)
  const persisted = buildPersistedAssistantOnboardingState({
    completedAt,
    completedReason: input.reason,
    createdAt: existing.createdAt ?? completedAt,
  })
  await writeAssistantOnboardingState(input.vault, persisted)
  return normalizeAssistantOnboardingState(persisted)
}

export async function startAssistantOnboarding(input: {
  startedAt?: string
  vault: string
}): Promise<AssistantOnboardingState> {
  const existing = await readAssistantOnboardingState(input.vault)
  if (existing.createdAt !== null) {
    return existing
  }

  const startedAt = input.startedAt ?? new Date().toISOString()
  const persisted = buildPersistedAssistantOnboardingState({
    completedAt: null,
    completedReason: null,
    createdAt: startedAt,
  })
  await writeAssistantOnboardingState(input.vault, persisted)
  return normalizeAssistantOnboardingState(persisted)
}

export async function reopenAssistantOnboarding(input: {
  reopenedAt?: string
  vault: string
}): Promise<AssistantOnboardingState> {
  const reopenedAt = input.reopenedAt ?? new Date().toISOString()
  const existing = await readAssistantOnboardingStateForExplicitWrite(input.vault)
  const persisted = buildPersistedAssistantOnboardingState({
    completedAt: null,
    completedReason: null,
    createdAt: existing.createdAt ?? reopenedAt,
    updatedAt: reopenedAt,
  })
  await writeAssistantOnboardingState(input.vault, persisted)
  return normalizeAssistantOnboardingState(persisted)
}

export async function isAssistantOnboardingOpen(vault: string): Promise<boolean> {
  return (await readAssistantOnboardingState(vault)).status === 'open'
}

async function readAssistantOnboardingStateForExplicitWrite(
  vault: string,
): Promise<AssistantOnboardingState> {
  try {
    return await readAssistantOnboardingState(vault)
  } catch (error) {
    if (
      isAssistantOnboardingStateReadError(error) &&
      (error.reason === 'invalid-json' || error.reason === 'invalid-schema')
    ) {
      return createDefaultAssistantOnboardingState()
    }

    throw error
  }
}

function createDefaultAssistantOnboardingState(): AssistantOnboardingState {
  return {
    schemaVersion: ASSISTANT_ONBOARDING_STATE_SCHEMA_VERSION,
    status: 'open',
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    completedReason: null,
  }
}

function normalizeAssistantOnboardingState(
  value: AssistantPersistedOnboardingState,
): AssistantOnboardingState {
  return {
    schemaVersion: value.schemaVersion,
    status: value.completedAt ? 'completed' : 'open',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
    completedReason: value.completedReason,
  }
}

function parsePersistedAssistantOnboardingState(
  raw: string,
): AssistantPersistedOnboardingState {
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(raw)
  } catch (error) {
    throw new AssistantOnboardingStateReadError({
      cause: error,
      reason: 'invalid-json',
    })
  }

  const parsed = assistantPersistedOnboardingStateSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new AssistantOnboardingStateReadError({
      cause: parsed.error,
      reason: 'invalid-schema',
    })
  }

  return parsed.data
}

function buildAssistantOnboardingStateReadErrorMessage(
  reason: AssistantOnboardingStateReadFailureReason,
): string {
  switch (reason) {
    case 'invalid-json':
      return `Assistant onboarding state at ${ASSISTANT_ONBOARDING_STATE_RELATIVE_PATH} is not valid JSON. Repair it or run \`vault-cli assistant onboarding reopen\` to overwrite it explicitly.`
    case 'invalid-schema':
      return `Assistant onboarding state at ${ASSISTANT_ONBOARDING_STATE_RELATIVE_PATH} does not match the expected schema. Repair it or run \`vault-cli assistant onboarding reopen\` to overwrite it explicitly.`
    case 'read-failed':
      return `Assistant onboarding state at ${ASSISTANT_ONBOARDING_STATE_RELATIVE_PATH} could not be read. Fix the runtime-state permissions or repair the file before continuing.`
  }
}

function buildPersistedAssistantOnboardingState(input: {
  completedAt: string | null
  completedReason: AssistantOnboardingCompletionReason | null
  createdAt: string
  updatedAt?: string
}): AssistantPersistedOnboardingState {
  return {
    schemaVersion: ASSISTANT_ONBOARDING_STATE_SCHEMA_VERSION,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.completedAt ?? input.createdAt,
    completedAt: input.completedAt,
    completedReason: input.completedReason,
  }
}

async function writeAssistantOnboardingState(
  vault: string,
  value: AssistantPersistedOnboardingState,
): Promise<void> {
  const stateDirectory = resolveAssistantStatePaths(vault).stateDirectory
  const documentPath = resolveAssistantStateDocumentPath(
    { stateDirectory },
    ASSISTANT_ONBOARDING_STATE_DOC_ID,
  )
  await ensureAssistantStateDirectory(stateDirectory)
  await ensureAssistantStateDirectory(path.dirname(documentPath))
  await writeJsonFileAtomic(documentPath, value)
}
