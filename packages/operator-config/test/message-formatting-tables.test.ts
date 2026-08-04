import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  renderMarkdownMessageText,
} from '../src/message-formatting.ts'

test('message formatting renders a workout table as phone-readable labeled text', () => {
  const rendered = renderMarkdownMessageText(
    [
      'Here is your plan:',
      '',
      '| Day | Exercise | Sets × reps | Rest |',
      '| --- | --- | ---: | :---: |',
      '| Monday | Back squat | 3 × 5 | 2 min |',
      '| Thursday | Romanian deadlift | 3 × 8 | 90 sec |',
    ].join('\n'),
  )

  assert.deepEqual(rendered, {
    decorations: [],
    text: [
      'Here is your plan:',
      '',
      'Day: Monday',
      'Exercise: Back squat',
      'Sets × reps: 3 × 5',
      'Rest: 2 min',
      '',
      'Day: Thursday',
      'Exercise: Romanian deadlift',
      'Sets × reps: 3 × 8',
      'Rest: 90 sec',
    ].join('\n'),
  })
})

test('message formatting preserves escaped pipes and applies existing inline cleanup', () => {
  const rendered = renderMarkdownMessageText(
    [
      '| Source | Plan | Cue |',
      '| --- | --- | --- |',
      '| [guide](https://example.com/a?utm_source=openai) | **3 × 5** | Keep ribs \\| pelvis stacked |',
    ].join('\n'),
  )

  assert.equal(
    rendered.text,
    [
      'Source: https://example.com/a',
      'Plan: 3 × 5',
      'Cue: Keep ribs | pelvis stacked',
    ].join('\n'),
  )
  assert.deepEqual(rendered.decorations, [
    {
      range: [36, 41],
      style: 'bold',
    },
  ])
})

test('message formatting leaves fenced Markdown table examples unchanged', () => {
  const value = [
    '```md',
    '| Day | Work |',
    '| --- | --- |',
    '| Monday | Squat |',
    '```',
  ].join('\n')

  assert.deepEqual(renderMarkdownMessageText(value), {
    decorations: [],
    text: value,
  })
})

test('message formatting leaves ordinary pipe-delimited prose unchanged', () => {
  const value = [
    'Use zone 2 | easy pace today.',
    'Then cool down.',
  ].join('\n')

  assert.deepEqual(renderMarkdownMessageText(value), {
    decorations: [],
    text: value,
  })
})

test('message formatting renders a header-only table as an editable template', () => {
  const value = [
    '| Day | Plan |',
    '| --- | --- |',
  ].join('\n')

  assert.deepEqual(renderMarkdownMessageText(value), {
    decorations: [],
    text: [
      'Day: Not specified',
      'Plan: Not specified',
    ].join('\n'),
  })
})
