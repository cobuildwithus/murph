import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { assistantPreferenceCausalSeqSchema } from '@murphai/contracts'
import {
  resolveAssistantStatePaths,
  writeTextFileAtomic,
} from '@murphai/runtime-state/node'

import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import { readAssistantInputEvent } from './input-store.js'

const ASSISTANT_PREFERENCE_CAUSAL_SEQ_FILE = 'assistant-preference-causal-seq'

export function resolveAssistantPreferenceCausalSeqPath(vault: string): string {
  return path.join(
    resolveAssistantStatePaths(vault).stateDirectory,
    ASSISTANT_PREFERENCE_CAUSAL_SEQ_FILE,
  )
}

async function resolveAssistantPreferenceCausalSeq(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
  vault: string
}): Promise<string | null> {
  let causalSeq: bigint | null = null
  for (const item of input.acceptedInputItems) {
    if (item.source !== 'assistant-input') {
      continue
    }
    const event = await readAssistantInputEvent({
      inputId: item.id,
      vault: input.vault,
    })
    if (event?.sourceRef.kind !== 'hosted-mailbox') {
      continue
    }
    const candidate = BigInt(event.sourceRef.causalSeq ?? '0')
    if (causalSeq === null || candidate > causalSeq) {
      causalSeq = candidate
    }
  }
  return causalSeq?.toString() ?? null
}

export async function initializeAssistantPreferenceCausalSeq(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
  vault: string
}): Promise<void> {
  const causalSeq = await resolveAssistantPreferenceCausalSeq(input)
  if (causalSeq === null) {
    await rm(resolveAssistantPreferenceCausalSeqPath(input.vault), { force: true })
    return
  }
  await writeAssistantPreferenceCausalSeq(input.vault, causalSeq)
}

export async function advanceAssistantPreferenceCausalSeq(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
  vault: string
}): Promise<void> {
  const candidate = await resolveAssistantPreferenceCausalSeq(input)
  if (candidate === null) {
    return
  }

  const current = await readAssistantPreferenceCausalSeq(input.vault)
  if (current !== null && BigInt(current) >= BigInt(candidate)) {
    return
  }
  await writeAssistantPreferenceCausalSeq(input.vault, candidate)
}

async function readAssistantPreferenceCausalSeq(vault: string): Promise<string | null> {
  try {
    const value = (await readFile(
      resolveAssistantPreferenceCausalSeqPath(vault),
      'utf8',
    )).trim()
    return value.length > 0
      ? assistantPreferenceCausalSeqSchema.parse(value)
      : null
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return null
    }
    throw error
  }
}

async function writeAssistantPreferenceCausalSeq(
  vault: string,
  causalSeq: string,
): Promise<void> {
  await writeTextFileAtomic(
    resolveAssistantPreferenceCausalSeqPath(vault),
    causalSeq,
    { mode: 0o600, trailingNewline: causalSeq.length > 0 },
  )
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ENOENT'
}
