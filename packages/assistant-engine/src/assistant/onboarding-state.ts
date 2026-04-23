import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type {
  AssistantOnboardingCompletionReason,
  AssistantOnboardingState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantOnboardingCompletionReasonValues,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { resolveAssistantStateDocumentPath } from './state.js'

const ASSISTANT_ONBOARDING_STATE_DOC_ID = 'onboarding/conversation'
const ASSISTANT_ONBOARDING_STATE_SCHEMA_VERSION =
  'murph.assistant-onboarding.v1' as const

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

export function resolveAssistantOnboardingStatePath(vault: string): string {
  return resolveAssistantStateDocumentPath(resolveAssistantStatePaths(vault), ASSISTANT_ONBOARDING_STATE_DOC_ID)
}

export async function readAssistantOnboardingState(vault: string): Promise<AssistantOnboardingState> {
  const stateDirectory = resolveAssistantStatePaths(vault).stateDirectory
  const statePath = resolveAssistantStateDocumentPath(
    { stateDirectory },
    ASSISTANT_ONBOARDING_STATE_DOC_ID,
  )

  try {
    const raw = await readFile(statePath, 'utf8')
    return normalizeAssistantOnboardingState(
      assistantPersistedOnboardingStateSchema.parse(JSON.parse(raw)),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return createDefaultAssistantOnboardingState()
    }

    return createDefaultAssistantOnboardingState()
  }
}

export async function completeAssistantOnboarding(input: {
  completedAt?: string
  reason: AssistantOnboardingCompletionReason
  vault: string
}): Promise<AssistantOnboardingState> {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const existing = await readAssistantOnboardingState(input.vault)
  const persisted = buildPersistedAssistantOnboardingState({
    completedAt,
    createdAt: existing.createdAt ?? completedAt,
    completedReason: input.reason,
  })
  await writeAssistantOnboardingState(input.vault, persisted)
  return normalizeAssistantOnboardingState(persisted)
}

export async function reopenAssistantOnboarding(input: {
  reopenedAt?: string
  vault: string
}): Promise<AssistantOnboardingState> {
  const reopenedAt = input.reopenedAt ?? new Date().toISOString()
  const existing = await readAssistantOnboardingState(input.vault)
  const persisted = buildPersistedAssistantOnboardingState({
    completedAt: null,
    createdAt: existing.createdAt ?? reopenedAt,
    completedReason: null,
    updatedAt: reopenedAt,
  })
  await writeAssistantOnboardingState(input.vault, persisted)
  return normalizeAssistantOnboardingState(persisted)
}

export async function isAssistantOnboardingOpen(vault: string): Promise<boolean> {
  return (await readAssistantOnboardingState(vault)).status === 'open'
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
