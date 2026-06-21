import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  renderMarkdownMessageText,
  splitDecoratedMessageText,
} from '../src/message-formatting.ts'

test('message formatting renders simple emphasis spans with UTF-16 ranges', () => {
  const smile = '\u{1F600}'
  const rendered = renderMarkdownMessageText(
    `This is **bo${smile}ld** and _it_. ~~gone~~ Keep durable/home/*/rollout-*.jsonl intact.`,
  )

  assert.deepEqual(rendered, {
    decorations: [
      {
        range: [8, 14],
        style: 'bold',
      },
      {
        range: [19, 21],
        style: 'italic',
      },
      {
        range: [23, 27],
        style: 'strikethrough',
      },
    ],
    text: `This is bo${smile}ld and it. gone Keep durable/home/*/rollout-*.jsonl intact.`,
  })
})

test('message formatting leaves ambiguous markdown-like text untouched', () => {
  assert.deepEqual(
    renderMarkdownMessageText(
      'Keep snake_case, durable/home/*/rollout-*.jsonl, src/**/*.ts, docs/**/README.md, **multi\nline**, ** multiline\nbold **, and ** padded ** markers.',
    ),
    {
      decorations: [],
      text: 'Keep snake_case, durable/home/*/rollout-*.jsonl, src/**/*.ts, docs/**/README.md, **multi\nline**, ** multiline\nbold **, and ** padded ** markers.',
    },
  )
})

test('message formatting splits text and clamps UTF-16 decoration ranges', () => {
  const smile = '\u{1F600}'

  assert.deepEqual(
    splitDecoratedMessageText(
      {
        decorations: [
          {
            range: [1, 6],
            style: 'bold',
          },
        ],
        text: `A${smile}BCDE`,
      },
      3,
    ),
    [
      {
        decorations: [
          {
            range: [1, 4],
            style: 'bold',
          },
        ],
        text: `A${smile}B`,
      },
      {
        decorations: [
          {
            range: [0, 2],
            style: 'bold',
          },
        ],
        text: 'CDE',
      },
    ],
  )
})
