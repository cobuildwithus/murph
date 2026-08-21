import { createHash, randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { adoptAssistantStateFileIntoExclusiveName } from '@murphai/runtime-state/node/assistant-state-fs'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  writeJsonFileAtomic,
} from './shared.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { resolveAssistantStateDocumentPath } from './state.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'

export interface AssistantFirstContactLocator {
  actorId?: string | null
  channel?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface AssistantTelegramOnboardingFollowupFirstContactAnchor {
  acceptedTurnId: string
}

const ASSISTANT_TELEGRAM_ONBOARDING_FOLLOWUP_FIRST_CONTACT_DOC_ID =
  'onboarding/first-contact/telegram-onboarding-followup-anchor'
const ASSISTANT_TELEGRAM_ONBOARDING_FOLLOWUP_FIRST_CONTACT_SCHEMA =
  'murph.assistant-telegram-onboarding-followup-first-contact.v1'

export async function hasAssistantSeenFirstContact(input: {
  docIds: readonly string[]
  vault: string
}): Promise<boolean> {
  return hasAssistantSeenStateDocs(input)
}

export async function markAssistantFirstContactSeen(input: {
  onboardingFollowupAcceptedTurnId?: string | null
  docIds: readonly string[]
  seenAt: string
  vault: string
}): Promise<void> {
  const docIds = uniqueAssistantFirstContactDocIds(input.docIds)
  const firstContactAlreadySeen = await hasAssistantSeenStateDocs({
    docIds,
    vault: input.vault,
  })
  const onboardingFollowupAcceptedTurnId = normalizeNullableString(
    input.onboardingFollowupAcceptedTurnId,
  )
  if (
    !firstContactAlreadySeen &&
    docIds.length > 0 &&
    onboardingFollowupAcceptedTurnId !== null
  ) {
    await withAssistantRuntimeWriteLock(input.vault, async () => {
      await markAssistantTelegramOnboardingFollowupFirstContact({
        acceptedTurnId: onboardingFollowupAcceptedTurnId,
        vault: input.vault,
      })
    })
  }
  await markAssistantStateDocsSeen({
    ...input,
    docIds,
    schemaVersion: 'murph.assistant-first-contact.v1',
  })
}

export async function readAssistantTelegramOnboardingFollowupFirstContactAnchor(
  vault: string,
): Promise<AssistantTelegramOnboardingFollowupFirstContactAnchor | null> {
  const stateDirectory = resolveAssistantStatePaths(vault).stateDirectory
  const snapshot = await readAssistantFirstContactStateRecord(
    stateDirectory,
    ASSISTANT_TELEGRAM_ONBOARDING_FOLLOWUP_FIRST_CONTACT_DOC_ID,
  )
  if (
    snapshot?.schemaVersion !==
      ASSISTANT_TELEGRAM_ONBOARDING_FOLLOWUP_FIRST_CONTACT_SCHEMA
  ) {
    return null
  }

  const acceptedTurnId = normalizeNullableString(
    typeof snapshot.acceptedTurnId === 'string'
      ? snapshot.acceptedTurnId
      : null,
  )
  if (acceptedTurnId === null) {
    return null
  }

  return { acceptedTurnId }
}

async function markAssistantTelegramOnboardingFollowupFirstContact(input: {
  acceptedTurnId: string
  vault: string
}): Promise<void> {
  const stateDirectory = resolveAssistantStatePaths(input.vault).stateDirectory
  const documentPath = resolveAssistantStateDocumentPath(
    { stateDirectory },
    ASSISTANT_TELEGRAM_ONBOARDING_FOLLOWUP_FIRST_CONTACT_DOC_ID,
  )
  await ensureAssistantStateDirectory(path.dirname(documentPath))
  const stagedPath = path.join(
    path.dirname(documentPath),
    `.telegram-onboarding-followup-anchor-${randomUUID()}.json`,
  )
  await writeJsonFileAtomic(stagedPath, {
    acceptedTurnId: input.acceptedTurnId,
    schemaVersion:
      ASSISTANT_TELEGRAM_ONBOARDING_FOLLOWUP_FIRST_CONTACT_SCHEMA,
  })
  try {
    await adoptAssistantStateFileIntoExclusiveName(stagedPath, documentPath)
  } finally {
    await unlink(stagedPath).catch((error) => {
      if (!isMissingFileError(error)) {
        throw error
      }
    })
  }
}

async function markAssistantStateDocsSeen(input: {
  docIds: readonly string[]
  schemaVersion: string
  seenAt: string
  vault: string
}): Promise<void> {
  const stateDirectory = resolveAssistantStatePaths(input.vault).stateDirectory
  await ensureAssistantStateDirectory(stateDirectory)
  for (const docId of uniqueAssistantFirstContactDocIds(input.docIds)) {
    const documentPath = resolveAssistantStateDocumentPath(
      { stateDirectory },
      docId,
    )
    await ensureAssistantStateDirectory(path.dirname(documentPath))
    await writeJsonFileAtomic(documentPath, {
      schemaVersion: input.schemaVersion,
      seenAt: input.seenAt,
    })
  }
}

export function resolveAssistantFirstContactStateDocIds(
  input: AssistantFirstContactLocator,
): string[] {
  return resolveAssistantScopedOnboardingStateDocIds({
    input,
    scopeName: 'first-contact',
  })
}

function resolveAssistantScopedOnboardingStateDocIds(input: {
  input: AssistantFirstContactLocator
  scopeName: 'first-contact'
}): string[] {
  const channel = normalizeNullableString(input.input.channel)
  const identityId = normalizeNullableString(input.input.identityId)
  const actorId = normalizeNullableString(input.input.actorId)
  const threadId = normalizeNullableString(input.input.threadId)
  const threadIsDirect =
    typeof input.input.threadIsDirect === 'boolean' ? input.input.threadIsDirect : null

  if (!channel) {
    return []
  }

  return uniqueAssistantFirstContactDocIds([
    actorId && threadIsDirect !== false
      ? buildAssistantFirstContactStateDocId({
          channel,
          identityId,
          scopeName: input.scopeName,
          scope: ['actor', actorId],
        })
      : null,
    threadId
      ? buildAssistantFirstContactStateDocId({
          channel,
          identityId,
          scopeName: input.scopeName,
          scope: ['thread', threadId],
        })
      : null,
  ])
}

function buildAssistantFirstContactStateDocId(input: {
  channel: string
  identityId: string | null
  scopeName: 'first-contact'
  scope: ['actor' | 'thread', string]
}): string {
  const key = [
    `channel:${encodeURIComponent(input.channel)}`,
    input.identityId ? `identity:${encodeURIComponent(input.identityId)}` : null,
    `${input.scope[0]}:${encodeURIComponent(input.scope[1])}`,
  ]
    .filter((value): value is string => value !== null)
    .join('|')

  return `onboarding/${input.scopeName}/${createHash('sha256').update(key).digest('hex')}`
}

function uniqueAssistantFirstContactDocIds(
  docIds: ReadonlyArray<string | null>,
): string[] {
  return [
    ...new Set(
      docIds
        .map((docId) => normalizeNullableString(docId))
        .filter((docId): docId is string => docId !== null),
    ),
  ]
}

async function readAssistantFirstContactStateRecord(
  stateDirectory: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const documentPath = resolveAssistantStateDocumentPath({ stateDirectory }, docId)
  try {
    const raw = await readFile(documentPath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    return parsed as Record<string, unknown>
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
}

async function hasAssistantSeenStateDocs(input: {
  docIds: readonly string[]
  vault: string
}): Promise<boolean> {
  const stateDirectory = resolveAssistantStatePaths(input.vault).stateDirectory
  for (const docId of uniqueAssistantFirstContactDocIds(input.docIds)) {
    const snapshot = await readAssistantFirstContactStateRecord(stateDirectory, docId)
    if (snapshot !== null) {
      return true
    }
  }

  return false
}
