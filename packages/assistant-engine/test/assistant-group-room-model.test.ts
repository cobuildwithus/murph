import { readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, test } from 'vitest'

import { initializeVault } from '@murphai/core'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import {
  appendKnowledgePageSection,
  getKnowledgePage,
  listKnowledgePages,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  upsertKnowledgePage,
} from '../src/knowledge/service.ts'
import {
  buildKnowledgeMarkdown,
  buildKnowledgePageRelativePath,
} from '../src/knowledge/documents.ts'
import {
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_MAX_BYTES,
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
  ASSISTANT_GROUP_ROOM_MODEL_PROMPT_MAX_BYTES,
  ASSISTANT_GROUP_ROOM_MODEL_SLUG,
  initializeAssistantGroupRoomModel,
  readAssistantGroupRoomModelState,
  readAssistantGroupRoomModelBody,
  readAssistantGroupRoomModelPrompt,
  replaceAssistantGroupRoomModel,
} from '../src/assistant/group-room-model.ts'
import { assistantConversationHistoryUtf8Bytes } from '../src/assistant/shared.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

test('returns a bounded, explicitly advisory group room model prompt', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-group-room-model-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })

  const repeatedTip = '- Watson likes mock legal rulings.\n'.repeat(100)
  const missing = await readAssistantGroupRoomModelState({ vaultRoot })
  if (missing.kind !== 'missing') {
    throw new Error('Expected a missing room model.')
  }
  await replaceAssistantGroupRoomModel({
    body: [
      '## People',
      '- Jimmy gets teased about the combine.',
      repeatedTip,
    ].join('\n'),
    expectedDigest: missing.digest,
    vaultRoot,
  })

  const prompt = await readAssistantGroupRoomModelPrompt({ vaultRoot })

  expect(prompt).toContain('Optional rough room tips')
  expect(prompt).toContain('Jimmy gets teased about the combine')
  expect(prompt).toContain('"roomModelStatus":"active"')
  expect(prompt).toContain('"truncated":false')
  expect(prompt).toContain(
    'Murph builds longitudinal understanding of this room and its participants across turns',
  )
  expect(prompt).toContain(
    'Never say Murph only sees recent messages or has no memory by design',
  )
  expect(prompt).toContain(
    'Current conversation, explicit room settings, safety, and tool results win',
  )
  expect(prompt).toContain('Do not force callbacks')
  expect(prompt).toContain('expose internal handles')
  expect(prompt).toContain('\\n')
  expect(assistantConversationHistoryUtf8Bytes(prompt ?? '')).toBeLessThanOrEqual(
    ASSISTANT_GROUP_ROOM_MODEL_PROMPT_MAX_BYTES,
  )
})

test('initializes explicit room setup once and never overwrites conflicting state', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-group-room-model-initialize-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })

  const body = '## Explicit setup\n\nKeep this room low-key.'
  await expect(initializeAssistantGroupRoomModel({
    body,
    vaultRoot,
  })).resolves.toMatchObject({
    kind: 'initialized',
    state: { body },
  })
  await expect(initializeAssistantGroupRoomModel({
    body,
    vaultRoot,
  })).resolves.toMatchObject({
    kind: 'already_initialized',
    state: { body },
  })
  await expect(initializeAssistantGroupRoomModel({
    body: '## Explicit setup\n\nUse a formal tone.',
    vaultRoot,
  })).rejects.toMatchObject({
    code: 'group_room_model_initialization_conflict',
  })
  await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
    .resolves.toBe(body)
})

test('rejects an oversized multibyte room model without replacing the prior page', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-group-room-model-size-limit-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })

  const priorBody = '## What to avoid\n- Retire the combine nickname.'
  const missing = await readAssistantGroupRoomModelState({ vaultRoot })
  if (missing.kind !== 'missing') {
    throw new Error('Expected a missing room model.')
  }
  const prior = await replaceAssistantGroupRoomModel({
    body: priorBody,
    expectedDigest: missing.digest,
    vaultRoot,
  })

  const oversizedBody = '🧠'.repeat(
    Math.floor(ASSISTANT_GROUP_ROOM_MODEL_PAGE_MAX_BYTES / 4) + 1,
  )
  await expect(replaceAssistantGroupRoomModel({
    body: oversizedBody,
    expectedDigest: prior.digest,
    vaultRoot,
  })).rejects.toMatchObject({
    code: 'group_room_model_prompt_too_large',
  })
  await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
    .resolves.toBe(priorBody)
})

test('rejects raw Telegram sender ids and hides identifying stored state', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-group-room-model-telegram-sender-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })

  const priorBody = '## People\n- Casey likes dry rulings.'
  const missing = await readAssistantGroupRoomModelState({ vaultRoot })
  if (missing.kind !== 'missing') {
    throw new Error('Expected a missing room model.')
  }
  const prior = await replaceAssistantGroupRoomModel({
    body: priorBody,
    expectedDigest: missing.digest,
    vaultRoot,
  })
  const identifyingBodies = [
    '## People\n- Sender: 456 likes dry rulings.',
    '## People\n- **Sender:** 456 likes dry rulings.',
    '## People\n- Sender: `456` likes dry rulings.',
    '## People\n- __Sender__: 456 likes dry rulings.',
    '## People\n- _Sender_: `456` likes dry rulings.',
    '## People\n- Call (555) 123-4567 for the ruling.',
    '## People\n- Call 555-123-4567 for the ruling.',
    '## People\n- Call +1 (555) 123-4567 for the ruling.',
    '## People\n- Call +44 20 7946 0958 for the ruling.',
    '## People\n- Call 555.123.4567 for the ruling.',
  ]
  for (const body of identifyingBodies) {
    await expect(replaceAssistantGroupRoomModel({
      body,
      expectedDigest: prior.digest,
      vaultRoot,
    })).rejects.toMatchObject({
      code: 'group_room_model_participant_handle_forbidden',
    })
    await expect(readAssistantGroupRoomModelBody({ vaultRoot }))
      .resolves.toBe(priorBody)
  }

  const ordinaryNumericBody = [
    '## Running bits and callbacks',
    '- Keep 2 callbacks at most.',
    '- Start at 4 a.m.',
    '- Use a 3-person format.',
    '- Sender: 2FA is the name of the running bit.',
  ].join('\n')
  await expect(replaceAssistantGroupRoomModel({
    body: ordinaryNumericBody,
    expectedDigest: prior.digest,
    vaultRoot,
  })).resolves.toMatchObject({
    body: ordinaryNumericBody,
    kind: 'present',
  })

  const pagePath = await resolveAssistantVaultPath(
    vaultRoot,
    buildKnowledgePageRelativePath(ASSISTANT_GROUP_ROOM_MODEL_SLUG),
    'file path',
  )
  for (const body of identifyingBodies) {
    await writeFile(pagePath, buildKnowledgeMarkdown({
      body,
      compiledAt: '2026-07-25T00:00:00.000Z',
      librarySlugs: [],
      pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
      relatedSlugs: [],
      slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
      sourcePaths: [],
      status: 'active',
      summary: null,
      title: 'Group room model',
    }), 'utf8')
    await expect(readAssistantGroupRoomModelState({ vaultRoot }))
      .resolves.toEqual({ kind: 'unavailable' })
    const prompt = await readAssistantGroupRoomModelPrompt({ vaultRoot })
    expect(prompt).toContain('"roomModelStatus":"unavailable"')
    expect(prompt).toContain('could not be read on this turn')
    expect(prompt).not.toContain(body)
  }
})

test('keeps the reserved page out of generic knowledge surfaces', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-group-room-model-append-size-limit-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })

  const missing = await readAssistantGroupRoomModelState({ vaultRoot })
  if (missing.kind !== 'missing') {
    throw new Error('Expected a missing room model.')
  }
  await replaceAssistantGroupRoomModel({
    body: '## People\n- Casey likes dry rulings.',
    expectedDigest: missing.digest,
    vaultRoot,
  })
  const pagePath = await resolveAssistantVaultPath(
    vaultRoot,
    buildKnowledgePageRelativePath(ASSISTANT_GROUP_ROOM_MODEL_SLUG),
    'file path',
  )
  await expect(appendKnowledgePageSection({
    body: 'must not append',
    heading: 'More',
    slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
    vault: vaultRoot,
  })).rejects.toMatchObject({
    code: 'knowledge_page_reserved',
  })
  await expect(upsertKnowledgePage({
    body: 'must not replace',
    pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
    slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
    vault: vaultRoot,
  })).rejects.toMatchObject({
    code: 'knowledge_page_reserved',
  })
  await expect(getKnowledgePage({
    slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
    vault: vaultRoot,
  })).rejects.toMatchObject({ code: 'knowledge_page_reserved' })
  await expect(listKnowledgePages({ vault: vaultRoot }))
    .resolves.toMatchObject({ pageCount: 0, pages: [] })
  await expect(searchKnowledgePages({
    query: 'dry rulings',
    vault: vaultRoot,
  })).resolves.toMatchObject({ hits: [], total: 0 })
  await rebuildKnowledgeIndex({ vault: vaultRoot })
  const indexPath = await resolveAssistantVaultPath(
    vaultRoot,
    'derived/knowledge/index.md',
    'file path',
  )
  await expect(readFile(indexPath, 'utf8')).resolves.not.toContain(
    'group-room-model',
  )
  await expect(readFile(pagePath, 'utf8')).resolves.toContain(
    'Casey likes dry rulings.',
  )
})

test('renders truthful continuity status for missing, inactive, and unreadable room models', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-group-room-model-status-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })

  const missingPrompt = await readAssistantGroupRoomModelPrompt({ vaultRoot })
  expect(missingPrompt).toContain('"roomModelStatus":"missing"')
  expect(missingPrompt).toContain('not initialized yet')
  expect(missingPrompt).toContain(
    'Murph builds longitudinal understanding of this room and its participants across turns',
  )
  expect(missingPrompt).not.toContain('tipsMarkdown')

  const missing = await readAssistantGroupRoomModelState({ vaultRoot })
  if (missing.kind !== 'missing') {
    throw new Error('Expected a missing room model.')
  }
  await replaceAssistantGroupRoomModel({
    body: '## Tips\n- one old bit',
    expectedDigest: missing.digest,
    vaultRoot,
  })

  const pagePath = await resolveAssistantVaultPath(
    vaultRoot,
    buildKnowledgePageRelativePath(ASSISTANT_GROUP_ROOM_MODEL_SLUG),
    'file path',
  )
  await writeFile(pagePath, buildKnowledgeMarkdown({
    body: '## Tips\n- one old bit',
    compiledAt: '2026-07-25T00:00:00.000Z',
    librarySlugs: [],
    pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
    relatedSlugs: [],
    slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
    sourcePaths: [],
    status: 'archived',
    summary: 'one old bit',
    title: 'Group room model',
  }), 'utf8')
  const inactivePrompt = await readAssistantGroupRoomModelPrompt({ vaultRoot })
  expect(inactivePrompt).toContain('"roomModelStatus":"inactive"')
  expect(inactivePrompt).toContain('currently inactive')
  expect(inactivePrompt).not.toContain('tipsMarkdown')

  await writeFile(pagePath, buildKnowledgeMarkdown({
    body: '## Tips\n- one old bit',
    compiledAt: '2026-07-25T00:00:00.000Z',
    librarySlugs: [],
    pageType: 'concept',
    relatedSlugs: [],
    slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
    sourcePaths: [],
    status: 'active',
    summary: 'one old bit',
    title: 'Group room model',
  }), 'utf8')
  const unavailablePrompt = await readAssistantGroupRoomModelPrompt({ vaultRoot })
  expect(unavailablePrompt).toContain('"roomModelStatus":"unavailable"')
  expect(unavailablePrompt).toContain('could not be read on this turn')
  expect(unavailablePrompt).not.toContain('tipsMarkdown')
})
