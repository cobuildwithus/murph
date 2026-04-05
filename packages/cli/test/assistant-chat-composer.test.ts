import type { Key } from 'ink'
import { describe, expect, it } from 'vitest'

import {
  applyComposerEditingInput,
  reconcileComposerControlledValue,
  resolveComposerTerminalAction,
  resolveComposerVerticalCursorMove,
} from '@murphai/assistant-cli/assistant/ui/composer-editor'

function createKey(overrides: Partial<Key> = {}): Key {
  return overrides as Key
}

describe('composer-editor', () => {
  it('treats raw meta+up arrow sequences as edit-last-queued', () => {
    expect(
      resolveComposerTerminalAction('\u001b[1;3A', createKey()),
    ).toEqual({ kind: 'edit-last-queued' })
  })

  it('keeps the newest local draft visible until the pending queue catches up', () => {
    expect(
      reconcileComposerControlledValue({
        cursorOffset: 6,
        currentValue: 'newest',
        nextControlledValue: 'older',
        pendingValues: ['older', 'newest'],
        previousControlledValue: 'original',
      }),
    ).toEqual({
      cursorOffset: 6,
      nextValue: 'newest',
      pendingValues: ['newest'],
    })
  })

  it('preserves the preferred column when moving across shorter lines', () => {
    expect(
      resolveComposerVerticalCursorMove({
        cursorOffset: 3,
        direction: 'down',
        preferredColumn: null,
        value: 'abcd\nef',
      }),
    ).toEqual({
      cursorOffset: 7,
      preferredColumn: 3,
    })
  })

  it('supports word-delete editing commands without changing the component layer', () => {
    expect(
      applyComposerEditingInput(
        {
          cursorOffset: 11,
          killBuffer: '',
          value: 'hello world',
        },
        '',
        createKey({ backspace: true, meta: true }),
      ),
    ).toEqual({
      cursorOffset: 6,
      handled: true,
      killBuffer: 'world',
      value: 'hello ',
    })
  })
})
