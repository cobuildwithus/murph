import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import * as React from 'react'
import { type Key } from 'ink'
import { renderToString } from 'ink'

export function collectElementText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => collectElementText(child)).join('')
  }

  if (React.isValidElement(node)) {
    return collectElementText(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props.children,
    )
  }

  return ''
}

export function renderInkOutput(
  node: React.ReactNode,
  options: {
    columns?: number
  } = {},
): string {
  return stripAnsiHyperlinks(
    stripVTControlCharacters(
      renderToString(node, {
        columns: options.columns ?? 100,
      }),
    ),
  )
}

export function createInkTestOutput(): NodeJS.WriteStream & PassThrough {
  const stream = new PassThrough() as NodeJS.WriteStream & PassThrough
  stream.columns = 120
  stream.rows = 40
  stream.isTTY = true
  stream.ref = () => stream
  stream.unref = () => stream
  return stream
}

export function createInkTestInput(): NodeJS.ReadStream & PassThrough {
  const stream = new PassThrough() as NodeJS.ReadStream & PassThrough
  stream.isTTY = true
  stream.setRawMode = () => stream
  stream.ref = () => stream
  stream.unref = () => stream
  return stream
}

export async function flushAsyncWork(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export function createInkKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  }
}

function stripAnsiHyperlinks(input: string): string {
  return input.replace(/\u001B\]8;;.*?\u0007/gu, '')
}
