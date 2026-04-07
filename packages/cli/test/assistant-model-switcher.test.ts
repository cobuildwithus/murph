import assert from 'node:assert/strict'
import { test } from 'vitest'

import { resolveAssistantModelCatalog } from '@murphai/assistant-engine/assistant-provider-catalog'
import {
  createModelSwitcherState,
  dismissModelSwitcher,
  offsetModelSwitcherSelection,
  resolveModelSwitcherSelection,
} from '@murphai/assistant-cli/assistant/ui/model-switcher'

function createCatalog() {
  return resolveAssistantModelCatalog({
    provider: 'codex-cli',
    currentModel: 'gpt-5.4',
    currentReasoningEffort: 'high',
  })
}

test('assistant model switcher state starts from the active model and reasoning option', () => {
  const catalog = createCatalog()
  const state = createModelSwitcherState({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'high',
    models: catalog.models,
    modelOptions: catalog.modelOptions,
  })

  assert.equal(state.mode, 'model')
  assert.equal(state.modelOptions[state.modelIndex]?.value, 'gpt-5.4')
  assert.equal(state.reasoningOptions[state.reasoningIndex]?.value, 'high')
})

test('assistant model switcher offsets model selection and re-derives reasoning choices from the new model', () => {
  const catalog = createCatalog()
  const initialState = createModelSwitcherState({
    activeModel: catalog.modelOptions[0]?.value ?? null,
    activeReasoningEffort: 'medium',
    models: catalog.models,
    modelOptions: catalog.modelOptions,
  })

  const nextState = offsetModelSwitcherSelection({
    activeReasoningEffort: 'medium',
    delta: 1,
    state: initialState,
  })

  assert.equal(
    nextState.modelOptions[nextState.modelIndex]?.value,
    catalog.modelOptions[1]?.value ?? catalog.modelOptions[0]?.value,
  )
  assert.equal(nextState.reasoningOptions[nextState.reasoningIndex]?.value, 'medium')
})

test('assistant model switcher dismiss returns to model mode before closing', () => {
  const catalog = createCatalog()
  const modelState = createModelSwitcherState({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'medium',
    models: catalog.models,
    modelOptions: catalog.modelOptions,
  })
  const reasoningState = {
    ...modelState,
    mode: 'reasoning' as const,
  }

  assert.deepEqual(dismissModelSwitcher(reasoningState), modelState)
  assert.equal(dismissModelSwitcher(modelState), null)
})

test('assistant model switcher resolves the selected label and reasoning fallback', () => {
  const catalog = createCatalog()
  const state = createModelSwitcherState({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'medium',
    models: catalog.models,
    modelOptions: catalog.modelOptions,
  })
  const selection = {
    ...state,
    mode: 'reasoning' as const,
    reasoningIndex: 2,
  }

  assert.deepEqual(
    resolveModelSwitcherSelection({
      activeModel: 'gpt-5.4',
      activeReasoningEffort: 'medium',
      selection,
    }),
    {
      nextModel: 'gpt-5.4',
      nextReasoningEffort: 'high',
      selectedLabel: 'gpt-5.4 high',
    },
  )
})
