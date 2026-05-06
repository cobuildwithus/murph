import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildSetupWizardAssistantMethodBadges,
  buildSetupWizardAssistantProviderBadges,
  doesSetupWizardAssistantProviderRequireMethod,
  findSetupAssistantWizardProviderIndex,
  findSetupWizardAssistantMethodIndex,
  findSetupWizardAssistantProviderIndex,
  getDefaultSetupWizardAssistantPreset,
  inferSetupWizardAssistantMethod,
  inferSetupWizardAssistantProvider,
  listSetupAssistantWizardProviderOptions,
  listSetupWizardAssistantMethodOptions,
  listSetupWizardAssistantProviderOptions,
  normalizeSetupAssistantWizardProvider,
  resolveSetupWizardAssistantMethodForProvider,
  resolveSetupWizardAssistantSelection,
} from '../src/setup-assistant-wizard.js'

test('setup assistant wizard provider lists and indices normalize to Codex defaults', () => {
  assert.equal(getDefaultSetupWizardAssistantPreset(), 'codex')

  const allProviders = listSetupWizardAssistantProviderOptions()
  const selectableProviders = listSetupAssistantWizardProviderOptions()

  assert.deepEqual(
    allProviders.map((option) => option.provider),
    ['codex-cloud', 'codex-local', 'venice', 'skip'],
  )
  assert.deepEqual(
    selectableProviders.map((option) => option.provider),
    ['codex-cloud', 'codex-local', 'venice'],
  )
  assert.equal(findSetupWizardAssistantProviderIndex('codex-cloud'), 0)
  assert.equal(findSetupWizardAssistantProviderIndex('codex-local'), 1)
  assert.equal(findSetupWizardAssistantProviderIndex('venice'), 2)
  assert.equal(findSetupWizardAssistantProviderIndex('skip'), 3)
  assert.equal(findSetupAssistantWizardProviderIndex('skip'), 0)
  assert.equal(
    findSetupWizardAssistantProviderIndex(
      'not-real' as Parameters<typeof findSetupWizardAssistantProviderIndex>[0],
    ),
    0,
  )
  assert.equal(normalizeSetupAssistantWizardProvider('skip'), 'codex-cloud')
  assert.equal(normalizeSetupAssistantWizardProvider('codex-local'), 'codex-local')
})

test('setup assistant wizard infers Codex cloud, local, and skip selections', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'codex',
      oss: false,
    }),
    'codex-cloud',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'codex',
      modelProvider: 'venice',
      oss: false,
    }),
    'venice',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'codex',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
    }),
    'vercel-ai-gateway',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'codex',
      oss: true,
    }),
    'codex-local',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'skip',
    }),
    'skip',
  )

  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'codex',
      provider: 'codex-cloud',
      oss: false,
    }),
    'codex-cloud',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'codex',
      provider: 'venice',
      oss: false,
    }),
    'venice',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'codex',
      provider: 'vercel-ai-gateway',
      oss: false,
    }),
    'vercel-ai-gateway',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'codex',
      provider: 'codex-local',
      oss: false,
    }),
    'codex-local',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'skip',
      provider: 'skip',
      oss: null,
    }),
    'skip',
  )
})

test('setup assistant wizard method helpers are pass-through for Codex-only flows', () => {
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('codex-cloud'), false)
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('codex-local'), false)
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('venice'), false)
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('skip'), false)
  assert.deepEqual(listSetupWizardAssistantMethodOptions('codex-cloud'), [])
  assert.deepEqual(listSetupWizardAssistantMethodOptions('codex-local'), [])
  assert.equal(
    findSetupWizardAssistantMethodIndex('codex-cloud', 'codex-cloud'),
    0,
  )
  assert.equal(
    findSetupWizardAssistantMethodIndex('codex-local', 'codex-cloud'),
    1,
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'codex-cloud',
      provider: 'venice',
    }),
    'venice',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'codex-cloud',
      provider: 'vercel-ai-gateway',
    }),
    'vercel-ai-gateway',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'codex-cloud',
      provider: 'codex-local',
    }),
    'codex-local',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'codex-local',
      provider: 'skip',
    }),
    'skip',
  )
})

test('setup assistant wizard resolves provider selections into Codex setup choices', () => {
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'skip',
      method: 'skip',
    }),
    {
      detail: 'Murph will leave your current assistant settings alone for now.',
      methodLabel: null,
      modelProvider: null,
      oss: null,
      preset: 'skip',
      providerLabel: 'Skip for now',
      summary: 'Skip for now',
    },
  )

  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'codex-local',
      method: 'codex-local',
    }),
    {
      detail: 'Murph will ask which local model id to save next.',
      methodLabel: null,
      modelProvider: null,
      oss: true,
      preset: 'codex',
      providerLabel: 'Codex local model',
      summary: 'Codex local model',
    },
  )

  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'codex-cloud',
      method: 'codex-cloud',
    }),
    {
      detail: 'Murph will use your saved Codex / ChatGPT sign-in.',
      methodLabel: null,
      modelProvider: null,
      oss: false,
      preset: 'codex',
      providerLabel: 'ChatGPT / Codex sign-in',
      summary: 'ChatGPT / Codex sign-in',
    },
  )

  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'venice',
      method: 'venice',
    }),
    {
      detail: 'Murph will ask which Venice model id to save next.',
      methodLabel: null,
      modelProvider: 'venice',
      oss: false,
      preset: 'codex',
      providerLabel: 'Venice.ai',
      summary: 'Venice.ai',
    },
  )
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'vercel-ai-gateway',
      method: 'vercel-ai-gateway',
    }),
    {
      detail: 'Murph will ask which model id to save next.',
      methodLabel: null,
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      preset: 'codex',
      providerLabel: 'Vercel AI Gateway',
      summary: 'Vercel AI Gateway',
    },
  )
})

test('setup assistant wizard badges reflect Codex kind and current selections', () => {
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'codex-cloud',
      provider: 'codex-cloud',
    }),
    [
      { label: 'recommended', tone: 'success' },
      { label: 'current', tone: 'accent' },
    ],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'codex-cloud',
      provider: 'codex-local',
    }),
    [{ label: 'local', tone: 'accent' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'codex-cloud',
      provider: 'venice',
    }),
    [{ label: 'api key', tone: 'accent' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'codex-cloud',
      provider: 'skip',
    }),
    [{ label: 'no change', tone: 'muted' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantMethodBadges({
      currentMethod: 'codex-local',
      method: 'codex-local',
      optionBadges: [{ label: 'local', tone: 'accent' }],
    }),
    [
      { label: 'local', tone: 'accent' },
      { label: 'current', tone: 'accent' },
    ],
  )
})
