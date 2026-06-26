import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  renderMarkdownMessageText,
  sanitizeUserFacingMessageLinks,
  splitDecoratedMessageText,
} from '../src/message-formatting.ts'

test('message formatting renders simple emphasis spans with UTF-16 ranges', () => {
  const smile = '\u{1F600}'
  const rendered = renderMarkdownMessageText(
    `This is **bo${smile}ld** and _short aside_. ~~gone~~ Keep durable/home/*/rollout-*.jsonl intact.`,
  )

  assert.deepEqual(rendered, {
    decorations: [
      {
        range: [8, 14],
        style: 'bold',
      },
      {
        range: [19, 30],
        style: 'italic',
      },
      {
        range: [32, 36],
        style: 'strikethrough',
      },
    ],
    text: `This is bo${smile}ld and short aside. gone Keep durable/home/*/rollout-*.jsonl intact.`,
  })
})

test('message formatting renders star italics and underline spans', () => {
  assert.deepEqual(
    renderMarkdownMessageText(
      'This should render as *italics* and ++underlined++.',
    ),
    {
      decorations: [
        {
          range: [22, 29],
          style: 'italic',
        },
        {
          range: [34, 44],
          style: 'underline',
        },
      ],
      text: 'This should render as italics and underlined.',
    },
  )
})

test('message formatting accepts punctuation inside explicit decoration spans', () => {
  assert.deepEqual(
    renderMarkdownMessageText(
      'Choose **mobile/home/work**, *yes/no*, ++on/off++, or ~~old/new~~.',
    ),
    {
      decorations: [
        {
          range: [7, 23],
          style: 'bold',
        },
        {
          range: [25, 31],
          style: 'italic',
        },
        {
          range: [33, 39],
          style: 'underline',
        },
        {
          range: [44, 51],
          style: 'strikethrough',
        },
      ],
      text: 'Choose mobile/home/work, yes/no, on/off, or old/new.',
    },
  )
})

test('message formatting leaves star and plus lookalikes untouched', () => {
  const value = 'Keep C++, a++b++, counter++, standalone ++, and * bullet markers intact.'

  assert.deepEqual(renderMarkdownMessageText(value), {
    decorations: [],
    text: value,
  })
})

test('message formatting leaves ambiguous markdown-like text untouched', () => {
  assert.deepEqual(
    renderMarkdownMessageText(
      'Keep snake_case, durable/home/*/rollout-*.jsonl, src/**/*.ts, docs/**/README.md, https://example.test/download?filename=_report_.pdf, token _ABC_, _single_, 变量_名称_值, **multi\nline**, ** multiline\nbold **, and ** padded ** markers.',
    ),
    {
      decorations: [],
      text: 'Keep snake_case, durable/home/*/rollout-*.jsonl, src/**/*.ts, docs/**/README.md, https://example.test/download?filename=_report_.pdf, token _ABC_, _single_, 变量_名称_值, **multi\nline**, ** multiline\nbold **, and ** padded ** markers.',
    },
  )
})

test('message formatting converts markdown links to clean raw URLs', () => {
  assert.equal(
    sanitizeUserFacingMessageLinks(
      'Found it: [amazon.com](https://www.amazon.com/Blueprint-Bryan-Johnson-Longevity-Protein/dp/B0DNGJRLQF?utm_source=openai&utm_medium=chatgpt).',
    ),
    'Found it: https://www.amazon.com/Blueprint-Bryan-Johnson-Longevity-Protein/dp/B0DNGJRLQF.',
  )
})

test('message formatting cleans tracking parameters from raw URLs', () => {
  assert.equal(
    sanitizeUserFacingMessageLinks(
      'Open https://example.com/path?keep=1&utm_source=openai&fbclid=abc#section when ready.',
    ),
    'Open https://example.com/path?keep=1#section when ready.',
  )
})

test('message formatting cleans tracking parameters from raw URLs with parenthesized paths', () => {
  assert.equal(
    sanitizeUserFacingMessageLinks(
      'Open https://example.com/path(foo)?utm_source=openai&keep=1#section when ready.',
    ),
    'Open https://example.com/path(foo)?keep=1#section when ready.',
  )
})

test('message formatting unwraps parenthesized markdown source links', () => {
  assert.equal(
    sanitizeUserFacingMessageLinks(
      'I found the product. ([amazon.com](https://www.amazon.com/item?utm_campaign=openai))',
    ),
    'I found the product. https://www.amazon.com/item',
  )
})

test('message formatting converts markdown links with parenthesized paths to clean raw URLs', () => {
  assert.equal(
    sanitizeUserFacingMessageLinks(
      'Found it: [source](https://example.com/path(foo)?utm_source=openai&keep=1#section).',
    ),
    'Found it: https://example.com/path(foo)?keep=1#section.',
  )
})

test('message formatting unwraps parenthesized raw URLs', () => {
  assert.equal(
    sanitizeUserFacingMessageLinks(
      'Source (https://example.com/report?utm_campaign=openai&keep=yes).',
    ),
    'Source https://example.com/report?keep=yes.',
  )
})

test('message formatting preserves native text decorations after link cleanup', () => {
  assert.deepEqual(
    renderMarkdownMessageText(
      '**Protein**: [label](https://example.com/a?utm_campaign=x)',
    ),
    {
      decorations: [
        {
          range: [0, 7],
          style: 'bold',
        },
      ],
      text: 'Protein: https://example.com/a',
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
