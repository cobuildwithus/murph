import * as React from 'react'
import { Box, Text, useInput, type Key } from 'ink'
import { normalizeNullableString } from '@murphai/assistant-engine/assistant-runtime'

import {
  resolveAssistantCatalogReasoningOptions,
  type AssistantCatalogModel,
} from '../provider-catalog.js'
import {
  findAssistantModelOptionIndex,
  findAssistantReasoningOptionIndex,
  type AssistantModelOption,
  type AssistantReasoningOption,
} from './view-model.js'
import { normalizeAssistantInkArrowKey } from './composer-editor.js'
import type { AssistantInkTheme } from './theme.js'

export interface ModelSwitcherProps {
  currentModel: string | null
  currentReasoningEffort: string | null
  mode: 'model' | 'reasoning'
  modelIndex: number
  modelOptions: readonly AssistantModelOption[]
  onCancel: () => void
  onConfirm: () => void
  onMove: (delta: number) => void
  reasoningIndex: number
  reasoningOptions: readonly AssistantReasoningOption[]
  theme: AssistantInkTheme
}

export interface ModelSwitcherState {
  models: readonly AssistantCatalogModel[]
  mode: 'model' | 'reasoning'
  modelIndex: number
  reasoningIndex: number
  modelOptions: readonly AssistantModelOption[]
  reasoningOptions: readonly AssistantReasoningOption[]
}

function isCurrentReasoningOption(
  option: string,
  currentReasoningEffort: string | null,
): boolean {
  const normalizedCurrent = normalizeNullableString(currentReasoningEffort) ?? 'medium'
  return normalizeNullableString(option) === normalizedCurrent
}

function wrapPickerIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0
  }

  return ((index % count) + count) % count
}

function renderSwitcherRow(input: {
  current: boolean
  description: string
  index: number
  label: string
  selected: boolean
  theme: AssistantInkTheme
}): React.ReactElement {
  const createElement = React.createElement
  const textColor = input.selected
    ? input.theme.switcherSelectionTextColor
    : input.theme.switcherTextColor
  const descriptionColor = input.selected
    ? input.theme.switcherSelectionTextColor
    : input.theme.switcherMutedColor

  return createElement(
    Box,
    {
      backgroundColor: input.selected
        ? input.theme.switcherSelectionBackground
        : undefined,
      key: `${input.label}:${input.index}`,
      flexDirection: 'column',
      marginBottom: 1,
      paddingX: 1,
      width: '100%',
    },
    createElement(
      Text,
      {
        color: textColor,
      },
      createElement(Text, { color: textColor }, input.selected ? '●' : '○'),
      ` ${input.index + 1}. ${input.label}`,
      input.current
        ? createElement(
            Text,
            {
              color: input.selected ? textColor : input.theme.accentColor,
            },
            ' · current',
          )
        : null,
    ),
    createElement(
      Text,
      {
        color: descriptionColor,
        wrap: 'wrap',
      },
      input.description,
    ),
  )
}

export function createModelSwitcherState(input: {
  activeModel: string | null
  activeReasoningEffort: string | null
  models: readonly AssistantCatalogModel[]
  modelOptions: readonly AssistantModelOption[]
}): ModelSwitcherState {
  const modelIndex = findAssistantModelOptionIndex(
    input.activeModel,
    input.modelOptions,
  )
  const reasoningOptions = resolveAssistantCatalogReasoningOptions(
    input.models[modelIndex],
  )

  return {
    models: input.models,
    mode: 'model',
    modelIndex,
    reasoningIndex: findAssistantReasoningOptionIndex(
      input.activeReasoningEffort,
      reasoningOptions,
    ),
    modelOptions: input.modelOptions,
    reasoningOptions,
  }
}

export function offsetModelSwitcherSelection(input: {
  activeReasoningEffort: string | null
  delta: number
  state: ModelSwitcherState
}): ModelSwitcherState {
  if (input.state.mode === 'model') {
    const modelIndex = wrapPickerIndex(
      input.state.modelIndex + input.delta,
      input.state.modelOptions.length,
    )
    const reasoningOptions = resolveAssistantCatalogReasoningOptions(
      input.state.models[modelIndex],
    )

    return {
      ...input.state,
      modelIndex,
      reasoningIndex: findAssistantReasoningOptionIndex(
        input.activeReasoningEffort,
        reasoningOptions,
      ),
      reasoningOptions,
    }
  }

  return {
    ...input.state,
    reasoningIndex: wrapPickerIndex(
      input.state.reasoningIndex + input.delta,
      input.state.reasoningOptions.length,
    ),
  }
}

export function dismissModelSwitcher(
  state: ModelSwitcherState,
): ModelSwitcherState | null {
  if (state.mode === 'reasoning') {
    return {
      ...state,
      mode: 'model',
    }
  }

  return null
}

export function resolveModelSwitcherSelection(input: {
  activeModel: string | null
  activeReasoningEffort: string | null
  selection: ModelSwitcherState
}): {
  nextModel: string | null
  nextReasoningEffort: string | null
  selectedLabel: string
} {
  const nextModel =
    input.selection.modelOptions[input.selection.modelIndex]?.value ??
    input.activeModel ??
    null
  const nextReasoningEffort =
    input.selection.reasoningOptions.length > 0
      ? input.selection.reasoningOptions[input.selection.reasoningIndex]?.value ??
        input.activeReasoningEffort ??
        'medium'
      : null
  const selectedLabel = [
    nextModel ?? 'the configured model',
    normalizeNullableString(nextReasoningEffort),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')

  return {
    nextModel,
    nextReasoningEffort,
    selectedLabel,
  }
}

export function ModelSwitcher(props: ModelSwitcherProps): React.ReactElement {
  const createElement = React.createElement
  const onCancelRef = React.useRef(props.onCancel)
  const onConfirmRef = React.useRef(props.onConfirm)
  const onMoveRef = React.useRef(props.onMove)

  onCancelRef.current = props.onCancel
  onConfirmRef.current = props.onConfirm
  onMoveRef.current = props.onMove

  const handleModelSwitcherInput = React.useCallback((input: string, key: Key) => {
    const normalizedKey = normalizeAssistantInkArrowKey(input, key)

    if (normalizedKey.escape) {
      onCancelRef.current()
      return
    }

    if (normalizedKey.upArrow || input === 'k') {
      onMoveRef.current(-1)
      return
    }

    if (normalizedKey.downArrow || input === 'j') {
      onMoveRef.current(1)
      return
    }

    if (normalizedKey.return) {
      onConfirmRef.current()
    }
  }, [])

  useInput(handleModelSwitcherInput)

  const selectedModelLabel =
    props.modelOptions[props.modelIndex]?.value ??
    props.currentModel ??
    'the current model'
  const canChooseReasoning = props.reasoningOptions.length > 0
  const title =
    props.mode === 'model'
      ? 'Choose a model'
      : `Choose reasoning for ${selectedModelLabel}`
  const subtitle =
    props.mode === 'model'
      ? canChooseReasoning
        ? 'Step 1 of 2. Enter continues to reasoning depth.'
        : 'Enter confirms the active model.'
      : 'Step 2 of 2. Enter confirms the active reasoning depth.'
  const helpText =
    props.mode === 'model'
      ? canChooseReasoning
        ? '↑/↓ move · Enter next · Esc close'
        : '↑/↓ move · Enter confirm · Esc close'
      : '↑/↓ move · Enter confirm · Esc back'
  const options =
    props.mode === 'model'
      ? props.modelOptions.map((option, index) =>
          renderSwitcherRow({
            current:
              normalizeNullableString(option.value) ===
              normalizeNullableString(props.currentModel),
            description: option.description,
            index,
            label: option.value,
            selected: index === props.modelIndex,
            theme: props.theme,
          }),
        )
      : props.reasoningOptions.map((option, index) =>
          renderSwitcherRow({
            current: isCurrentReasoningOption(option.value, props.currentReasoningEffort),
            description: option.description,
            index,
            label:
              option.value === 'medium'
                ? `${option.label} (default)`
                : option.label,
            selected: index === props.reasoningIndex,
            theme: props.theme,
          }),
        )

  return createElement(
    Box,
    {
      backgroundColor: props.theme.switcherBackground,
      flexDirection: 'column',
      marginBottom: 1,
      paddingX: 1,
      width: '100%',
    },
    createElement(
      Text,
      {
        bold: true,
        color: props.theme.switcherTextColor,
      },
      title,
    ),
    createElement(
      Text,
      {
        color: props.theme.switcherMutedColor,
      },
      subtitle,
    ),
    createElement(Box, {
      height: 1,
    }),
    ...options,
    createElement(Box, {
      height: 1,
    }),
    createElement(
      Text,
      {
        color: props.theme.switcherMutedColor,
      },
      helpText,
    ),
  )
}
