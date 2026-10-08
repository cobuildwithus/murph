import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildSetupWizardAssistantProviderBadges,
  findSetupAssistantWizardProviderIndex,
  findSetupWizardAssistantProviderIndex,
  getDefaultSetupWizardAssistantPreset,
  inferSetupWizardAssistantMethod,
  inferSetupWizardAssistantProvider,
  listSetupAssistantWizardProviderOptions,
  listSetupWizardAssistantProviderOptions,
  normalizeSetupAssistantWizardProvider,
  resolveSetupWizardAssistantMethodForProvider,
  resolveSetupWizardAssistantSelection,
} from '../src/setup-assistant-wizard.ts'

test('setup offers OpenAI through Codex and an unchanged-settings choice', () => {
  assert.equal(getDefaultSetupWizardAssistantPreset(), 'codex')
  assert.deepEqual(listSetupWizardAssistantProviderOptions().map(({ provider }) => provider), ['codex-cloud', 'skip'])
  assert.deepEqual(listSetupAssistantWizardProviderOptions().map(({ provider }) => provider), ['codex-cloud'])
  assert.equal(findSetupWizardAssistantProviderIndex('skip'), 1)
  assert.equal(findSetupAssistantWizardProviderIndex('skip'), 0)
  assert.equal(findSetupAssistantWizardProviderIndex('codex-cloud'), 0)
})

test('assistant selection preserves skip only in full onboarding', () => {
  assert.equal(inferSetupWizardAssistantProvider({ preset: 'codex' }), 'codex-cloud')
  assert.equal(inferSetupWizardAssistantProvider({ preset: 'skip' }), 'skip')
  assert.equal(normalizeSetupAssistantWizardProvider('skip'), 'codex-cloud')
  assert.equal(normalizeSetupAssistantWizardProvider('codex-cloud'), 'codex-cloud')
  assert.equal(inferSetupWizardAssistantMethod({ preset: 'codex', provider: 'codex-cloud' }), 'codex-cloud')
  assert.equal(inferSetupWizardAssistantMethod({ preset: 'skip', provider: 'codex-cloud' }), 'skip')
  assert.equal(resolveSetupWizardAssistantMethodForProvider({ currentMethod: 'skip', provider: 'codex-cloud' }), 'codex-cloud')
  assert.deepEqual(resolveSetupWizardAssistantSelection({ method: 'codex-cloud', provider: 'codex-cloud' }), {
    detail: 'Murph will use your saved Codex / ChatGPT sign-in.',
    methodLabel: null,
    modelProvider: null,
    oss: false,
    preset: 'codex',
    providerLabel: 'ChatGPT / Codex sign-in',
    summary: 'ChatGPT / Codex sign-in',
  })
  assert.equal(resolveSetupWizardAssistantSelection({ method: 'skip', provider: 'skip' }).preset, 'skip')
  assert.deepEqual(buildSetupWizardAssistantProviderBadges({ currentProvider: 'codex-cloud', provider: 'codex-cloud' }), [
    { label: 'recommended', tone: 'success' },
    { label: 'current', tone: 'accent' },
  ])
  assert.deepEqual(buildSetupWizardAssistantProviderBadges({ currentProvider: 'codex-cloud', provider: 'skip' }), [
    { label: 'no change', tone: 'muted' },
  ])
})
