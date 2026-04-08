import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as coreModule from '@murphai/core'
import type { InboxServices } from '@murphai/inbox-services'
import * as operatorConfigModule from '@murphai/operator-config/operator-config'
import {
  hasHealthCommandDescriptor,
  healthEntityDescriptors,
  type VaultServices,
} from '@murphai/vault-usecases'

import {
  createAssistantCliExecutorToolDefinitions,
  createAssistantKnowledgeReadToolDefinitions,
  createAssistantKnowledgeWriteToolDefinitions,
  createAssistantRuntimeToolDefinitions,
  createCanonicalVaultWriteToolDefinitions,
  createHealthUpsertToolDefinitions,
  createInboxPromotionToolDefinitions,
  createOutwardSideEffectToolDefinitions,
  createVaultQueryToolDefinitions,
  createVaultTextReadToolDefinitions,
  createWebFetchToolDefinitions,
  createWebPdfReadToolDefinitions,
  createWebSearchToolDefinitions,
} from '../src/assistant-cli-tools/capability-definitions.ts'
import {
  createDefaultAssistantCapabilityRegistry,
  createDefaultAssistantToolCatalog,
  createInboxRoutingAssistantCapabilityRegistry,
  createInboxRoutingAssistantToolCatalog,
  createProviderTurnAssistantCapabilityRuntime,
  createProviderTurnAssistantCapabilityRegistry,
  createProviderTurnAssistantToolCatalog,
} from '../src/assistant-cli-tools/catalog-profiles.ts'
import {
  executeAssistantCliCommand,
  readAssistantCliLlmsManifest,
  readAssistantTextFile,
  withAssistantPayloadFile,
} from '../src/assistant-cli-tools/execution-adapters.ts'
import type { AssistantToolContext } from '../src/assistant-cli-tools/shared.ts'
import * as executionAdapters from '../src/assistant-cli-tools/execution-adapters.ts'
import * as knowledge from '../src/knowledge.ts'
import * as webFetch from '../src/assistant/web-fetch.ts'
import * as webPdfRead from '../src/assistant/web-pdf-read.ts'
import * as webSearch from '../src/assistant/web-search.ts'
import { createTempVaultContext, restoreEnvironmentVariable } from './test-helpers.js'

const createdRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    createdRoots.splice(0).map((targetRoot) =>
      rm(targetRoot, { force: true, recursive: true }),
    ),
  )
})

describe('assistant CLI tool capability seam', () => {
  const originalWebFetchEnabled = process.env.MURPH_WEB_FETCH_ENABLED
  const originalExaApiKey = process.env.EXA_API_KEY

  afterEach(() => {
    restoreEnvironmentVariable('MURPH_WEB_FETCH_ENABLED', originalWebFetchEnabled)
    restoreEnvironmentVariable('EXA_API_KEY', originalExaApiKey)
  })

  it('executes helper, CLI, native file, and configured web capability definitions', async () => {
    const { vaultRoot } = await createOwnedVaultContext('murph-assistant-cli-tools-runtime-')
    const context = createToolContext({ vault: vaultRoot })

    const knowledgeListSpy = vi.spyOn(knowledge, 'listKnowledgePages').mockResolvedValue({
      pages: ['list'],
    })
    const knowledgeSearchSpy = vi.spyOn(knowledge, 'searchKnowledgePages').mockResolvedValue({
      pages: ['search'],
    })
    const knowledgeGetSpy = vi.spyOn(knowledge, 'getKnowledgePage').mockResolvedValue({
      slug: 'sleep-quality',
    })
    const knowledgeLintSpy = vi.spyOn(knowledge, 'lintKnowledgePages').mockResolvedValue({
      ok: true,
    })
    const knowledgeUpsertSpy = vi.spyOn(knowledge, 'upsertKnowledgePage').mockResolvedValue({
      slug: 'sleep-quality',
    })
    const knowledgeRebuildSpy = vi.spyOn(knowledge, 'rebuildKnowledgeIndex').mockResolvedValue({
      rebuilt: true,
    })
    const listTargetsSpy = vi
      .spyOn(operatorConfigModule, 'listAssistantSelfDeliveryTargets')
      .mockResolvedValue([{ channel: 'telegram' }])
    const showTargetSpy = vi
      .spyOn(operatorConfigModule, 'resolveAssistantSelfDeliveryTarget')
      .mockResolvedValue({ channel: 'telegram', target: '@murph' })
    const cliExecuteSpy = vi
      .spyOn(executionAdapters, 'executeAssistantCliCommand')
      .mockResolvedValue({
        argv: ['vault-cli', '--help'],
        exitCode: 0,
        json: { ok: true },
        stderr: '',
        stdout: '{"ok":true}',
      })
    const readFileSpy = vi
      .spyOn(executionAdapters, 'readAssistantTextFile')
      .mockResolvedValue({
        path: 'journal/notes.txt',
        text: 'hello',
        totalChars: 5,
        truncated: false,
      })
    const webSearchSpy = vi.spyOn(webSearch, 'searchAssistantWeb').mockResolvedValue({
      results: [{ title: 'Responses API' }],
    })
    const webFetchSpy = vi.spyOn(webFetch, 'fetchAssistantWeb').mockResolvedValue({
      url: 'https://example.com/page',
      text: 'page',
    })
    const webPdfSpy = vi.spyOn(webPdfRead, 'readAssistantWebPdf').mockResolvedValue({
      url: 'https://example.com/menu.pdf',
      text: 'pdf',
      pagesRead: 1,
    })

    process.env.EXA_API_KEY = 'test-exa-key'
    process.env.MURPH_WEB_FETCH_ENABLED = '1'

    const knowledgeReadTools = createAssistantKnowledgeReadToolDefinitions(context)
    expect(await executeTool(knowledgeReadTools, 'assistant.knowledge.list', {
      pageType: 'concept',
      status: 'draft',
    })).toEqual({ pages: ['list'] })
    expect(await executeTool(knowledgeReadTools, 'assistant.knowledge.search', {
      query: 'sleep magnesium',
      limit: 3,
      pageType: 'concept',
      status: 'draft',
    })).toEqual({ pages: ['search'] })
    expect(await executeTool(knowledgeReadTools, 'assistant.knowledge.get', {
      slug: 'sleep-quality',
    })).toEqual({ slug: 'sleep-quality' })
    expect(await executeTool(knowledgeReadTools, 'assistant.knowledge.lint', {})).toEqual({
      ok: true,
    })
    expect(knowledgeListSpy).toHaveBeenCalledWith({
      vault: vaultRoot,
      pageType: 'concept',
      status: 'draft',
    })
    expect(knowledgeSearchSpy).toHaveBeenCalledWith({
      vault: vaultRoot,
      query: 'sleep magnesium',
      limit: 3,
      pageType: 'concept',
      status: 'draft',
    })
    expect(knowledgeGetSpy).toHaveBeenCalledWith({
      vault: vaultRoot,
      slug: 'sleep-quality',
    })
    expect(knowledgeLintSpy).toHaveBeenCalledWith({
      vault: vaultRoot,
    })

    const knowledgeWriteTools = createAssistantKnowledgeWriteToolDefinitions(context)
    expect(await executeTool(knowledgeWriteTools, 'assistant.knowledge.upsert', {
      title: 'Sleep quality',
      slug: 'sleep-quality',
      body: '# Sleep quality',
      pageType: 'concept',
      status: 'draft',
      clearLibrarySlugs: true,
      librarySlugs: ['sleep-architecture'],
      relatedSlugs: ['sleep'],
      sourcePaths: ['research/2026/04/sleep.md'],
    })).toEqual({ slug: 'sleep-quality' })
    expect(await executeTool(knowledgeWriteTools, 'assistant.knowledge.rebuildIndex', {})).toEqual({
      rebuilt: true,
    })
    expect(knowledgeUpsertSpy).toHaveBeenCalledWith({
      vault: vaultRoot,
      title: 'Sleep quality',
      slug: 'sleep-quality',
      body: '# Sleep quality',
      pageType: 'concept',
      status: 'draft',
      clearLibrarySlugs: true,
      librarySlugs: ['sleep-architecture'],
      relatedSlugs: ['sleep'],
      sourcePaths: ['research/2026/04/sleep.md'],
    })
    expect(knowledgeRebuildSpy).toHaveBeenCalledWith({
      vault: vaultRoot,
    })

    const runtimeTools = createAssistantRuntimeToolDefinitions(context, {
      includeStatefulWriteTools: false,
    })
    expect(await executeTool(runtimeTools, 'assistant.selfTarget.list', {})).toEqual([
      { channel: 'telegram' },
    ])
    expect(await executeTool(runtimeTools, 'assistant.selfTarget.show', {
      channel: 'telegram',
    })).toEqual({ channel: 'telegram', target: '@murph' })
    expect(listTargetsSpy).toHaveBeenCalledTimes(1)
    expect(showTargetSpy).toHaveBeenCalledWith('telegram')

    const cliTools = createAssistantCliExecutorToolDefinitions(context)
    expect(await executeTool(cliTools, 'murph.cli.run', {
      args: ['device', 'provider', 'list'],
      stdin: '{"hello":true}',
      timeoutMs: 1000,
    })).toEqual({
      argv: ['vault-cli', '--help'],
      exitCode: 0,
      json: { ok: true },
      stderr: '',
      stdout: '{"ok":true}',
    })
    expect(cliExecuteSpy).toHaveBeenCalledWith({
      args: ['device', 'provider', 'list'],
      stdin: '{"hello":true}',
      timeoutMs: 1000,
      input: context,
    })

    const textReadTools = createVaultTextReadToolDefinitions(context)
    expect(await executeTool(textReadTools, 'vault.fs.readText', {
      path: 'journal/notes.txt',
      maxChars: 50,
    })).toEqual({
      path: 'journal/notes.txt',
      text: 'hello',
      totalChars: 5,
      truncated: false,
    })
    expect(readFileSpy).toHaveBeenCalledWith(vaultRoot, 'journal/notes.txt', 50)

    const searchTools = createWebSearchToolDefinitions()
    const fetchTools = createWebFetchToolDefinitions()
    const pdfTools = createWebPdfReadToolDefinitions()
    expect(await executeTool(searchTools, 'web.search', {
      query: 'OpenAI Responses API',
      provider: 'auto',
      count: 5,
      country: 'us',
      language: 'en',
      freshness: 'week',
      dateAfter: '2026-04-01',
      dateBefore: '2026-04-08',
      domainFilter: ['platform.openai.com'],
    })).toEqual({
      results: [{ title: 'Responses API' }],
    })
    expect(await executeTool(fetchTools, 'web.fetch', {
      url: 'https://example.com/page',
      extractMode: 'markdown',
      maxChars: 1000,
    })).toEqual({
      url: 'https://example.com/page',
      text: 'page',
    })
    expect(await executeTool(pdfTools, 'web.pdf.read', {
      url: 'https://example.com/menu.pdf',
      maxChars: 1000,
      maxPages: 2,
    })).toEqual({
      url: 'https://example.com/menu.pdf',
      text: 'pdf',
      pagesRead: 1,
    })
    expect(webSearchSpy).toHaveBeenCalledWith({
      query: 'OpenAI Responses API',
      provider: 'auto',
      count: 5,
      country: 'us',
      language: 'en',
      freshness: 'week',
      dateAfter: '2026-04-01',
      dateBefore: '2026-04-08',
      domainFilter: ['platform.openai.com'],
    })
    expect(webFetchSpy).toHaveBeenCalledWith({
      url: 'https://example.com/page',
      extractMode: 'markdown',
      maxChars: 1000,
    })
    expect(webPdfSpy).toHaveBeenCalledWith({
      url: 'https://example.com/menu.pdf',
      maxChars: 1000,
      maxPages: 2,
    })
  })

  it('executes inbox promotion, query, canonical write, outward, and health upsert tools', async () => {
    const { parentRoot, vaultRoot } = await createOwnedVaultContext('murph-assistant-cli-tools-write-')
    await writeVaultTextFile(
      vaultRoot,
      'raw/inbox/captures/cap_123/attachments/1/report.pdf',
      'document',
    )
    await writeVaultTextFile(
      vaultRoot,
      'raw/inbox/captures/cap_123/attachments/1/photo.jpg',
      'photo',
    )
    await writeVaultTextFile(
      vaultRoot,
      'raw/inbox/captures/cap_123/attachments/1/audio.m4a',
      'audio',
    )
    await writeVaultTextFile(
      vaultRoot,
      'raw/inbox/captures/cap_123/attachments/1/assessment.json',
      '{"ok":true}',
    )

    const inboxCalls: Array<{ name: string; input: unknown }> = []
    const queryCalls: Array<{ name: string; input: unknown }> = []
    const coreCalls: Array<{ name: string; input: unknown }> = []
    const importerCalls: Array<{ name: string; input: unknown }> = []

    const inboxServices = {
      promoteDocument: vi.fn(async (input) => {
        inboxCalls.push({ name: 'promoteDocument', input })
        return { ok: true, kind: 'document' }
      }),
      promoteExperimentNote: vi.fn(async (input) => {
        inboxCalls.push({ name: 'promoteExperimentNote', input })
        return { ok: true, kind: 'experimentNote' }
      }),
      promoteJournal: vi.fn(async (input) => {
        inboxCalls.push({ name: 'promoteJournal', input })
        return { ok: true, kind: 'journal' }
      }),
      promoteMeal: vi.fn(async (input) => {
        inboxCalls.push({ name: 'promoteMeal', input })
        return { ok: true, kind: 'meal' }
      }),
    } as InboxServices

    const vaultServices = createVaultServicesStub({
      coreCalls,
      importerCalls,
      queryCalls,
    })
    const buildSharePackSpy = vi.spyOn(coreModule, 'buildSharePackFromVault').mockResolvedValue({
      packType: 'share',
      title: 'Morning Smoothie',
    })
    const context = createToolContext({
      captureId: 'cap_123',
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(async ({ provider }) => ({
            provider,
            url: `https://example.com/connect/${provider}`,
          })),
          issueShareLink: vi.fn(async (input) => ({
            ...input,
            shareId: 'share_123',
            url: 'https://example.com/share/share_123',
          })),
        },
      } as NonNullable<AssistantToolContext['executionContext']>,
      inboxServices,
      requestId: 'req_123',
      vault: vaultRoot,
      vaultServices,
    })

    const inboxTools = createInboxPromotionToolDefinitions(context)
    expect(inboxTools.map((tool) => tool.name)).toEqual([
      'inbox.promote.meal',
      'inbox.promote.document',
      'inbox.promote.journal',
      'inbox.promote.experimentNote',
    ])
    for (const tool of inboxTools) {
      await executeBoundTool(tool, {
        captureId: 'cap_123',
      })
    }
    expect(inboxCalls).toEqual([
      {
        name: 'promoteMeal',
        input: { captureId: 'cap_123', requestId: 'req_123', vault: vaultRoot },
      },
      {
        name: 'promoteDocument',
        input: { captureId: 'cap_123', requestId: 'req_123', vault: vaultRoot },
      },
      {
        name: 'promoteJournal',
        input: { captureId: 'cap_123', requestId: 'req_123', vault: vaultRoot },
      },
      {
        name: 'promoteExperimentNote',
        input: { captureId: 'cap_123', requestId: 'req_123', vault: vaultRoot },
      },
    ])

    const queryTools = createVaultQueryToolDefinitions(context)
    expect(await executeTool(queryTools, 'vault.show', { id: 'journal:2026-03-13' })).toMatchObject({
      ok: true,
      method: 'show',
    })
    await executeTool(queryTools, 'vault.list', { kind: 'goal', limit: 10 })
    await executeTool(queryTools, 'vault.wearables.day', { date: '2026-03-31' })
    await executeTool(queryTools, 'vault.wearables.sleep', { from: '2026-03-25' })
    await executeTool(queryTools, 'vault.wearables.activity', { date: '2026-03-31' })
    await executeTool(queryTools, 'vault.wearables.body', {})
    await executeTool(queryTools, 'vault.wearables.recovery', { from: '2026-03-25' })
    await executeTool(queryTools, 'vault.wearables.sources', {})
    await executeTool(queryTools, 'vault.recipe.show', { id: 'sheet-pan-salmon-bowls' })
    await executeTool(queryTools, 'vault.recipe.list', { status: 'saved' })
    await executeTool(queryTools, 'vault.food.show', { id: 'regular-acai-bowl' })
    await executeTool(queryTools, 'vault.food.list', { status: 'active' })
    expect(findCall(queryCalls, 'listWearableSleep')).toMatchObject({
      limit: 14,
    })
    expect(findCall(queryCalls, 'listWearableBodyState')).toMatchObject({
      limit: 14,
    })
    expect(findCall(queryCalls, 'listWearableSources')).toMatchObject({
      limit: 10,
    })
    expect(findCall(queryCalls, 'listRecipes')).toMatchObject({
      limit: 10,
    })
    expect(findCall(queryCalls, 'listFoods')).toMatchObject({
      limit: 10,
    })

    const writeToolsWithoutState = createCanonicalVaultWriteToolDefinitions(context, {
      includeStatefulWriteTools: false,
    })
    expect(writeToolsWithoutState.some((tool) => tool.name === 'vault.protocol.stop')).toBe(false)

    const writeTools = createCanonicalVaultWriteToolDefinitions(context)
    await executeTool(writeTools, 'vault.document.import', {
      file: 'raw/inbox/captures/cap_123/attachments/1/report.pdf',
      title: 'Report',
      occurredAt: '2026-04-08T09:30:00Z',
      note: 'note',
      source: 'import',
    })
    await executeTool(writeTools, 'vault.meal.add', {
      photo: 'raw/inbox/captures/cap_123/attachments/1/photo.jpg',
      audio: 'raw/inbox/captures/cap_123/attachments/1/audio.m4a',
      note: 'Post-workout meal',
      occurredAt: '2026-04-08T10:00:00Z',
    })
    await executeTool(writeTools, 'vault.meal.add', {
      photo: 'raw/inbox/captures/cap_123/attachments/1/photo.jpg',
    })
    await executeTool(writeTools, 'vault.journal.ensure', {
      date: '2026-04-08',
    })
    await executeTool(writeTools, 'vault.journal.append', {
      date: '2026-04-08',
      text: 'Workout complete.',
    })
    await executeTool(writeTools, 'vault.experiment.create', {
      slug: 'creatine-trial',
      title: 'Creatine Trial',
      hypothesis: 'Improves recovery',
      startedOn: '2026-04-08',
      status: 'active',
    })
    await executeTool(writeTools, 'vault.provider.upsert', {
      payload: { providerId: 'prov_example', title: 'Example Provider' },
    })
    await executeTool(writeTools, 'vault.recipe.upsert', {
      payload: { title: 'Sheet Pan Salmon Bowls' },
    })
    await executeTool(writeTools, 'vault.food.upsert', {
      payload: { title: 'Regular Acai Bowl' },
    })
    await executeTool(writeTools, 'vault.event.upsert', {
      payload: { kind: 'note', title: 'Example event' },
    })
    await executeTool(writeTools, 'vault.samples.add', {
      payload: { stream: 'body_weight', samples: [] },
    })
    await executeTool(writeTools, 'vault.intake.import', {
      file: 'raw/inbox/captures/cap_123/attachments/1/assessment.json',
    })
    await executeTool(writeTools, 'vault.intake.project', {
      assessmentId: 'asmt_example',
    })
    await executeTool(writeTools, 'vault.profile.rebuildCurrent', {})
    await executeTool(writeTools, 'vault.protocol.stop', {
      protocolId: 'prot_example',
      stoppedOn: '2026-04-08',
    })

    const healthTools = createHealthUpsertToolDefinitions(context)
    expect(healthTools.length).toBeGreaterThan(0)
    for (const tool of healthTools) {
      await executeBoundTool(tool, {
        payload: tool.inputExample?.payload ?? {
          title: `payload-${tool.name}`,
        },
      })
    }
    await expect(
      access(path.join(parentRoot, 'vault', '.runtime', 'tmp', 'assistant', 'payloads')),
    ).resolves.toBeUndefined()
    expect(findCall(importerCalls, 'importDocument')).toMatchObject({
      file: path.join(vaultRoot, 'raw/inbox/captures/cap_123/attachments/1/report.pdf'),
      requestId: 'req_123',
      title: 'Report',
    })
    expect(findCall(coreCalls, 'addMeal')).toMatchObject({
      audio: path.join(vaultRoot, 'raw/inbox/captures/cap_123/attachments/1/audio.m4a'),
      photo: path.join(vaultRoot, 'raw/inbox/captures/cap_123/attachments/1/photo.jpg'),
    })
    expect(findCall(coreCalls, 'projectAssessment')).toMatchObject({
      assessmentId: 'asmt_example',
    })
    expect(findCall(coreCalls, 'stopProtocol')).toMatchObject({
      protocolId: 'prot_example',
      stoppedOn: '2026-04-08',
    })
    for (const descriptor of healthEntityDescriptors.filter(hasHealthCommandDescriptor)) {
      const methodName = descriptor.core.upsertServiceMethod
      expect(findCall(coreCalls, methodName)).toMatchObject({
        requestId: 'req_123',
        vault: vaultRoot,
      })
    }

    const nullRequestContext = createToolContext({
      vault: vaultRoot,
      vaultServices,
    })
    const nullRequestWriteTools = createCanonicalVaultWriteToolDefinitions(nullRequestContext)
    await executeTool(nullRequestWriteTools, 'vault.document.import', {
      file: 'raw/inbox/captures/cap_123/attachments/1/report.pdf',
    })
    await executeTool(nullRequestWriteTools, 'vault.meal.add', {
      photo: 'raw/inbox/captures/cap_123/attachments/1/photo.jpg',
    })
    await executeTool(nullRequestWriteTools, 'vault.journal.ensure', {
      date: '2026-04-09',
    })
    await executeTool(nullRequestWriteTools, 'vault.journal.append', {
      date: '2026-04-09',
      text: 'Null request journal append.',
    })
    await executeTool(nullRequestWriteTools, 'vault.experiment.create', {
      slug: 'null-request-experiment',
    })
    await executeTool(nullRequestWriteTools, 'vault.provider.upsert', {
      payload: { providerId: 'prov_null' },
    })
    await executeTool(nullRequestWriteTools, 'vault.recipe.upsert', {
      payload: { title: 'Null Request Recipe' },
    })
    await executeTool(nullRequestWriteTools, 'vault.food.upsert', {
      payload: { title: 'Null Request Food' },
    })
    await executeTool(nullRequestWriteTools, 'vault.event.upsert', {
      payload: { kind: 'note', title: 'Null Request Event' },
    })
    await executeTool(nullRequestWriteTools, 'vault.samples.add', {
      payload: { stream: 'body_weight', samples: [] },
    })
    await executeTool(nullRequestWriteTools, 'vault.intake.import', {
      file: 'raw/inbox/captures/cap_123/attachments/1/assessment.json',
    })
    await executeTool(nullRequestWriteTools, 'vault.intake.project', {
      assessmentId: 'asmt_null',
    })
    await executeTool(nullRequestWriteTools, 'vault.profile.rebuildCurrent', {})
    await executeTool(nullRequestWriteTools, 'vault.protocol.stop', {
      protocolId: 'prot_null',
    })
    await executeBoundTool(createHealthUpsertToolDefinitions(nullRequestContext)[0]!, {
      payload: {
        title: 'Null request health payload',
      },
    })
    expect(findLastCall(coreCalls, 'projectAssessment')).toMatchObject({
      assessmentId: 'asmt_null',
      requestId: null,
    })
    expect(findLastCall(coreCalls, 'rebuildCurrentProfile')).toMatchObject({
      requestId: null,
    })
    expect(findLastCall(coreCalls, 'stopProtocol')).toMatchObject({
      protocolId: 'prot_null',
      requestId: null,
    })
    expect(findLastCall(importerCalls, 'importDocument')).toMatchObject({
      requestId: null,
    })
    expect(findLastCall(importerCalls, 'importAssessmentResponse')).toMatchObject({
      requestId: null,
    })

    const outwardTools = createOutwardSideEffectToolDefinitions(context)
    expect(await executeTool(outwardTools, 'murph.device.connect', {
      provider: 'whoop',
    })).toEqual({
      provider: 'whoop',
      url: 'https://example.com/connect/whoop',
    })
    expect(await executeTool(outwardTools, 'vault.share.createLink', {
      title: 'Morning Smoothie',
      foods: [{ slug: 'morning-smoothie' }],
      includeAttachedProtocols: true,
      logMeal: {
        food: {
          slug: 'morning-smoothie',
        },
      },
      recipientPhoneNumber: '+15555550123',
      inviteCode: 'invite_123',
      expiresInHours: 12,
    })).toMatchObject({
      shareId: 'share_123',
      url: 'https://example.com/share/share_123',
    })
    expect(buildSharePackSpy).toHaveBeenCalledWith({
      vaultRoot,
      title: 'Morning Smoothie',
      foods: [{ slug: 'morning-smoothie' }],
      protocols: undefined,
      recipes: undefined,
      includeAttachedProtocols: true,
      logMeal: {
        food: {
          slug: 'morning-smoothie',
        },
      },
    })
    expect(() =>
      outwardTools
        .find((tool) => tool.name === 'vault.share.createLink')
        ?.inputSchema.parse({
          foods: [{ group: 'bundle' }],
        }),
    ).toThrow('Provide either an id or slug.')
  })

  it('covers registry factory branches and dependency-gated empty capability lists', async () => {
    const { vaultRoot } = await createOwnedVaultContext('murph-assistant-cli-tools-registry-')
    const context = createToolContext({
      captureId: 'cap_123',
      inboxServices: {
        promoteDocument: vi.fn(),
        promoteExperimentNote: vi.fn(),
        promoteJournal: vi.fn(),
        promoteMeal: vi.fn(),
      } as InboxServices,
      vault: vaultRoot,
      vaultServices: createVaultServicesStub({
        coreCalls: [],
        importerCalls: [],
        queryCalls: [],
      }),
    })

    expect(createInboxPromotionToolDefinitions(createToolContext({ vault: vaultRoot }))).toEqual([])
    expect(createVaultQueryToolDefinitions(createToolContext({ vault: vaultRoot }))).toEqual([])
    expect(createCanonicalVaultWriteToolDefinitions(createToolContext({ vault: vaultRoot }))).toEqual([])
    expect(createHealthUpsertToolDefinitions(createToolContext({ vault: vaultRoot }))).toEqual([])
    expect(createOutwardSideEffectToolDefinitions(createToolContext({ vault: vaultRoot }))).toEqual([])

    const defaultRegistry = createDefaultAssistantCapabilityRegistry(context)
    expect(defaultRegistry.hasCapability('assistant.knowledge.list')).toBe(true)

    const defaultCatalog = createDefaultAssistantToolCatalog(context)
    expect(defaultCatalog.hasTool('vault.journal.append')).toBe(true)

    const inboxRegistry = createInboxRoutingAssistantCapabilityRegistry(context)
    expect(inboxRegistry.hasCapability('inbox.promote.document')).toBe(true)
    expect(inboxRegistry.hasCapability('assistant.knowledge.upsert')).toBe(false)
    const inboxCatalog = createInboxRoutingAssistantToolCatalog(context)
    expect(inboxCatalog.hasTool('inbox.promote.document')).toBe(true)

    process.env.EXA_API_KEY = 'test-exa-key'
    process.env.MURPH_WEB_FETCH_ENABLED = '1'
    const providerRegistry = createProviderTurnAssistantCapabilityRegistry(
      createToolContext({ vault: vaultRoot }),
    )
    expect(providerRegistry.hasCapability('murph.cli.run')).toBe(true)
    expect(providerRegistry.hasCapability('web.fetch')).toBe(true)

    const providerCatalog = createProviderTurnAssistantToolCatalog(
      createToolContext({ vault: vaultRoot }),
    )
    const providerRuntime = createProviderTurnAssistantCapabilityRuntime(
      createToolContext({ vault: vaultRoot }),
    )
    expect(providerCatalog.hasTool('murph.cli.run')).toBe(true)
    expect(providerRuntime.toolCatalog.hasTool('murph.cli.run')).toBe(true)
  })
})

describe('assistant CLI execution adapters', () => {
  it('executes vault-cli successfully and cleans up staged stdin payload files', async () => {
    const { vaultRoot } = await createOwnedVaultContext('murph-assistant-cli-exec-')
    const pathRoot = await createOwnedPathRoot('murph-assistant-cli-path-')
    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"status":"ok"}\\n\'',
      ].join('\n'),
    )

    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: pathRoot,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).resolves.toMatchObject({
      argv: expect.arrayContaining(['vault-cli']),
      exitCode: 0,
      json: { status: 'ok' },
      stdout: '{"status":"ok"}',
    })

    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@"',
      ].join('\n'),
    )
    const stagedPayloadRun = await executeAssistantCliCommand({
      args: ['audit', 'list', '--input', '-'],
      stdin: '{"payload":true}',
      input: {
        cliEnv: {
          HOME: pathRoot,
          PATH: '/usr/bin:/bin',
        },
        vault: vaultRoot,
      },
    })
    expect(stagedPayloadRun.stdout).toContain('@/')
    expect(stagedPayloadRun.stdout).toContain('--vault')
  })

  it('surfaces command failures, timeouts, manifest-shape guards, and invalid UTF-8 reads', async () => {
    const { vaultRoot } = await createOwnedVaultContext('murph-assistant-cli-failures-')
    const pathRoot = await createOwnedPathRoot('murph-assistant-cli-failure-path-')

    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf "stderr output" >&2',
        'exit 2',
      ].join('\n'),
    )
    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: pathRoot,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_FAILED',
      context: expect.objectContaining({
        exitCode: 2,
        stderr: 'stderr output',
      }),
    })

    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'sleep 1',
      ].join('\n'),
    )
    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: pathRoot,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_TIMEOUT',
    })

    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf "plain text\\n"',
      ].join('\n'),
    )
    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: pathRoot,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).resolves.toMatchObject({
      json: null,
      stdout: 'plain text',
    })

    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'exit 0',
      ].join('\n'),
    )
    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: pathRoot,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).resolves.toMatchObject({
      json: null,
      stdout: '',
    })

    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'"manifest"\\n\'',
      ].join('\n'),
    )
    await expect(
      readAssistantCliLlmsManifest({
        cliEnv: {
          HOME: pathRoot,
          PATH: '/usr/bin:/bin',
        },
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_FAILED',
      message: 'vault-cli --llms --format json returned an unexpected manifest shape.',
    })

    await writeVaultBinaryFile(
      vaultRoot,
      'journal/invalid-utf8.txt',
      Buffer.from([0xc3, 0x28]),
    )
    await expect(
      readAssistantTextFile(vaultRoot, 'journal/invalid-utf8.txt'),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TOOL_FILE_NOT_TEXT',
      message: 'Assistant file path "journal/invalid-utf8.txt" must reference a UTF-8 text file inside the vault.',
    })

    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        access: vi.fn(async (candidatePath: Parameters<typeof actual.access>[0], mode?: Parameters<typeof actual.access>[1]) => {
          if (mode === 0) {
            throw Object.assign(new Error(`Missing ${String(candidatePath)}`), {
              code: 'ENOENT',
            })
          }

          return await actual.access(candidatePath, mode)
        }),
      }
    })
    const mockedExecutionAdapters = await import(
      '../src/assistant-cli-tools/execution-adapters.ts?missing-built-cli'
    )
    const missingHome = await createOwnedPathRoot('murph-assistant-cli-missing-home-')
    await expect(
      mockedExecutionAdapters.executeAssistantCliCommand({
        args: ['--help'],
        input: {
          cliEnv: {
            HOME: missingHome,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_FAILED',
      message: 'Could not resolve `vault-cli` on PATH and no local built workspace CLI artifact was available.',
    })
    vi.doUnmock('node:fs/promises')

    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        writeFile: vi.fn(async (targetPath: Parameters<typeof actual.writeFile>[0], data: Parameters<typeof actual.writeFile>[1], options?: Parameters<typeof actual.writeFile>[2]) => {
          if (String(targetPath).endsWith('payload.json')) {
            throw new Error('write failed')
          }

          return await actual.writeFile(targetPath, data, options)
        }),
      }
    })
    const failingWriteExecutionAdapters = await import(
      '../src/assistant-cli-tools/execution-adapters.ts?payload-write-failure'
    )
    await expect(
      failingWriteExecutionAdapters.withAssistantPayloadFile(
        vaultRoot,
        'vault.provider.upsert',
        { providerId: 'prov_fail' },
        async () => 'ok',
      ),
    ).rejects.toThrow('write failed')
    vi.doUnmock('node:fs/promises')

    vi.resetModules()
    vi.doMock('node:path', async () => {
      const actual = await vi.importActual<typeof import('node:path')>('node:path')
      const mockedIsAbsolute = vi.fn((value: string) =>
        value === 'vault-cli' || actual.isAbsolute(value),
      )
      return {
        ...actual,
        default: {
          ...actual,
          isAbsolute: mockedIsAbsolute,
        },
        isAbsolute: mockedIsAbsolute,
      }
    })
    const absoluteExecutionAdapters = await import(
      '../src/assistant-cli-tools/execution-adapters.ts?absolute-cli'
    )
    await writeExecutable(
      path.join(pathRoot, 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"absolute":true}\\n\'',
      ].join('\n'),
    )
    await writeExecutable(
      path.join(pathRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"absolute":true}\\n\'',
      ].join('\n'),
    )
    const originalCwd = process.cwd()
    process.chdir(pathRoot)
    try {
      await expect(
        absoluteExecutionAdapters.executeAssistantCliCommand({
          args: ['audit', 'list'],
          input: {
            cliEnv: {
              HOME: pathRoot,
              PATH: '/usr/bin:/bin',
            },
            vault: vaultRoot,
          },
        }),
      ).resolves.toMatchObject({
        exitCode: 0,
        json: {
          absolute: true,
        },
      })
    } finally {
      process.chdir(originalCwd)
    }
    vi.doUnmock('node:path')

    vi.resetModules()
    vi.doMock('node:url', async () => {
      const actual = await vi.importActual<typeof import('node:url')>('node:url')
      return {
        ...actual,
        fileURLToPath: vi.fn(() => {
          throw new TypeError('broken url')
        }),
      }
    })
    const brokenUrlExecutionAdapters = await import(
      '../src/assistant-cli-tools/execution-adapters.ts?broken-import-meta'
    )
    const brokenHome = await createOwnedPathRoot('murph-assistant-cli-broken-url-home-')
    await expect(
      brokenUrlExecutionAdapters.executeAssistantCliCommand({
        args: ['--help'],
        input: {
          cliEnv: {
            HOME: brokenHome,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_FAILED',
      message: 'Could not resolve `vault-cli` on PATH and no local built workspace CLI artifact was available.',
    })
    vi.doUnmock('node:url')
  })

  it('returns full text reads and sanitizes payload staging names', async () => {
    const { vaultRoot } = await createOwnedVaultContext('murph-assistant-cli-read-')
    await writeVaultTextFile(vaultRoot, 'journal/notes.txt', 'Hydration note')

    await expect(
      readAssistantTextFile(vaultRoot, 'journal/notes.txt'),
    ).resolves.toEqual({
      path: 'journal/notes.txt',
      text: 'Hydration note',
      totalChars: 14,
      truncated: false,
    })

    let stagedInputFile = ''
    await expect(
      withAssistantPayloadFile(
        vaultRoot,
        'vault.provider.upsert / test',
        { providerId: 'prov_example' },
        async (inputFile) => {
          stagedInputFile = inputFile
          expect(path.basename(path.dirname(inputFile))).toMatch(/^vault-provider-upsert-test-/u)
          expect(await readFile(inputFile, 'utf8')).toContain('"providerId": "prov_example"')
          return 'ok'
        },
      ),
    ).resolves.toBe('ok')

    expect(stagedInputFile).not.toBe('')
    await expect(access(stagedInputFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function createToolContext(
  overrides: Partial<AssistantToolContext> = {},
): AssistantToolContext {
  return {
    vault: '/tmp/murph-vault',
    ...overrides,
  }
}

async function createOwnedVaultContext(prefix: string) {
  const context = await createTempVaultContext(prefix)
  createdRoots.push(context.parentRoot)
  return context
}

async function createOwnedPathRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  createdRoots.push(root)
  return root
}

async function writeVaultTextFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

async function writeVaultBinaryFile(
  vaultRoot: string,
  relativePath: string,
  content: Buffer,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

async function writeExecutable(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  await chmod(targetPath, 0o755)
}

function createVaultServicesStub(input: {
  coreCalls: Array<{ name: string; input: unknown }>
  importerCalls: Array<{ name: string; input: unknown }>
  queryCalls: Array<{ name: string; input: unknown }>
}): VaultServices {
  const makeCoreMethod = (name: string) =>
    vi.fn(async (methodInput: unknown) => {
      input.coreCalls.push({
        name,
        input: methodInput,
      })
      const inputPath =
        (methodInput as { input?: string; inputFile?: string }).input ??
        (methodInput as { input?: string; inputFile?: string }).inputFile
      if (typeof inputPath === 'string') {
        await expect(access(inputPath)).resolves.toBeUndefined()
      }
      return {
        ok: true,
        method: name,
      }
    })
  const makeImporterMethod = (name: string) =>
    vi.fn(async (methodInput: unknown) => {
      input.importerCalls.push({
        name,
        input: methodInput,
      })
      return {
        ok: true,
        method: name,
      }
    })
  const makeQueryMethod = (name: string) =>
    vi.fn(async (methodInput: unknown) => {
      input.queryCalls.push({
        name,
        input: methodInput,
      })
      return {
        ok: true,
        method: name,
      }
    })

  const core = {
    addMeal: makeCoreMethod('addMeal'),
    ensureJournal: makeCoreMethod('ensureJournal'),
    appendJournal: makeCoreMethod('appendJournal'),
    createExperiment: makeCoreMethod('createExperiment'),
    upsertProvider: makeCoreMethod('upsertProvider'),
    upsertRecipe: makeCoreMethod('upsertRecipe'),
    upsertFood: makeCoreMethod('upsertFood'),
    upsertEvent: makeCoreMethod('upsertEvent'),
    addSamples: makeCoreMethod('addSamples'),
    projectAssessment: makeCoreMethod('projectAssessment'),
    rebuildCurrentProfile: makeCoreMethod('rebuildCurrentProfile'),
    stopProtocol: makeCoreMethod('stopProtocol'),
  } as Record<string, ReturnType<typeof vi.fn>>

  for (const descriptor of healthEntityDescriptors.filter(hasHealthCommandDescriptor)) {
    core[descriptor.core.upsertServiceMethod] = makeCoreMethod(
      descriptor.core.upsertServiceMethod,
    )
  }

  return {
    core,
    devices: {},
    importers: {
      importAssessmentResponse: makeImporterMethod('importAssessmentResponse'),
      importDocument: makeImporterMethod('importDocument'),
    },
    query: {
      list: makeQueryMethod('list'),
      listFoods: makeQueryMethod('listFoods'),
      listRecipes: makeQueryMethod('listRecipes'),
      listWearableActivity: makeQueryMethod('listWearableActivity'),
      listWearableBodyState: makeQueryMethod('listWearableBodyState'),
      listWearableRecovery: makeQueryMethod('listWearableRecovery'),
      listWearableSleep: makeQueryMethod('listWearableSleep'),
      listWearableSources: makeQueryMethod('listWearableSources'),
      show: makeQueryMethod('show'),
      showFood: makeQueryMethod('showFood'),
      showRecipe: makeQueryMethod('showRecipe'),
      showWearableDay: makeQueryMethod('showWearableDay'),
    },
  } as unknown as VaultServices
}

async function executeTool(
  tools: Array<{
    name: string
    preferredHostKind: keyof NonNullable<unknown>
    executionBindings: Record<string, ((input: Record<string, unknown>) => Promise<unknown>) | undefined>
  }>,
  toolName: string,
  toolInput: Record<string, unknown>,
) {
  const tool = tools.find((candidate) => candidate.name === toolName)
  if (!tool) {
    throw new Error(`Missing tool ${toolName}`)
  }

  return executeBoundTool(tool, toolInput)
}

async function executeBoundTool(
  tool: {
    preferredHostKind: string
    executionBindings: Record<string, ((input: Record<string, unknown>) => Promise<unknown>) | undefined>
  },
  toolInput: Record<string, unknown>,
) {
  const executor = tool.executionBindings[tool.preferredHostKind]
  if (!executor) {
    throw new Error(`Missing executor for ${tool.preferredHostKind}`)
  }

  return await executor(toolInput)
}

function findCall(
  calls: Array<{ name: string; input: unknown }>,
  name: string,
): Record<string, unknown> {
  const match = calls.find((candidate) => candidate.name === name)
  if (!match || !match.input || typeof match.input !== 'object') {
    throw new Error(`Missing call ${name}`)
  }

  return match.input as Record<string, unknown>
}

function findLastCall(
  calls: Array<{ name: string; input: unknown }>,
  name: string,
): Record<string, unknown> {
  const match = [...calls].reverse().find((candidate) => candidate.name === name)
  if (!match || !match.input || typeof match.input !== 'object') {
    throw new Error(`Missing call ${name}`)
  }

  return match.input as Record<string, unknown>
}
