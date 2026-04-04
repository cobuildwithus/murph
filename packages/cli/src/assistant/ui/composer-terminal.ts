import type { Key } from 'ink'

export type ComposerSubmitMode = 'enter' | 'tab'

export type ComposerTerminalAction =
  | {
      kind: 'edit'
      input: string
      key: Key
    }
  | {
      kind: 'edit-last-queued'
    }
  | {
      kind: 'submit'
      mode: ComposerSubmitMode
    }

const MODIFIED_RETURN_SEQUENCE = /^\u001b?\[27;(\d+);13~$/u
const RAW_ARROW_SEQUENCE = /^\u001b?(?:\[(?:(\d+;)?(\d+))?([ABCD])|O([ABCD]))$/u
const MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH = 88

function resolveComposerModifiedReturnAction(
  input: string,
  key: Key,
): ComposerTerminalAction | null {
  const match = MODIFIED_RETURN_SEQUENCE.exec(input)
  if (!match) {
    return null
  }

  const modifier = Math.max(0, Number.parseInt(match[1] ?? '1', 10) - 1)
  const shift = key.shift || (modifier & 1) === 1

  if (!shift) {
    return {
      kind: 'submit',
      mode: 'enter',
    }
  }

  return {
    kind: 'edit',
    input: '\n',
    key: {
      ...key,
      return: false,
      shift: true,
    },
  }
}

export function normalizeAssistantInkArrowKey(input: string, key: Key): Key {
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
    return key
  }

  const match = RAW_ARROW_SEQUENCE.exec(input)
  const direction = match?.[3] ?? match?.[4]

  if (!direction) {
    return key
  }

  const modifier = Math.max(0, Number.parseInt(match?.[2] ?? '1', 10) - 1)

  return {
    ...key,
    ctrl: key.ctrl || (modifier & 4) === 4,
    downArrow: direction === 'B',
    leftArrow: direction === 'D',
    meta: key.meta || (modifier & 2) === 2,
    rightArrow: direction === 'C',
    shift: key.shift || (modifier & 1) === 1,
    upArrow: direction === 'A',
  }
}

export function mergeComposerDraftWithQueuedPrompts(
  draft: string,
  queuedPrompts: readonly string[],
): string {
  return [draft, ...queuedPrompts]
    .filter((value) => value.trim().length > 0)
    .join('\n\n')
}

export function resolveComposerTerminalAction(
  input: string,
  key: Key,
): ComposerTerminalAction {
  const normalizedKey = normalizeAssistantInkArrowKey(input, key)
  const modifiedReturnAction = resolveComposerModifiedReturnAction(input, normalizedKey)
  if (modifiedReturnAction) {
    return modifiedReturnAction
  }

  if (
    (input === '\u007f' || input === '\b') &&
    !normalizedKey.ctrl &&
    !normalizedKey.meta &&
    !normalizedKey.shift &&
    !normalizedKey.super &&
    !normalizedKey.hyper
  ) {
    return {
      kind: 'edit',
      input: '',
      key: {
        ...normalizedKey,
        backspace: true,
        delete: false,
      },
    }
  }

  if (normalizedKey.meta && normalizedKey.upArrow) {
    return {
      kind: 'edit-last-queued',
    }
  }

  if (normalizedKey.tab && !normalizedKey.shift) {
    return {
      kind: 'submit',
      mode: 'tab',
    }
  }

  if (normalizedKey.return) {
    if (!normalizedKey.shift) {
      return {
        kind: 'submit',
        mode: 'enter',
      }
    }

    return {
      kind: 'edit',
      input: '\n',
      key: {
        ...normalizedKey,
        return: false,
      },
    }
  }

  if (normalizedKey.delete) {
    return {
      kind: 'edit',
      input,
      key: {
        ...normalizedKey,
        backspace: true,
        delete: false,
      },
    }
  }

  return {
    kind: 'edit',
    input,
    key: normalizedKey,
  }
}

export function formatQueuedFollowUpPreview(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/gu, ' ')

  if (normalized.length <= MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH) {
    return normalized
  }

  const truncated = normalized
    .slice(0, MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH - 1)
    .trimEnd()
  const boundary = truncated.lastIndexOf(' ')
  const preview =
    boundary >= Math.floor(MAX_QUEUED_FOLLOW_UP_PREVIEW_LENGTH / 2)
      ? truncated.slice(0, boundary).trimEnd()
      : truncated

  return `${preview}…`
}
