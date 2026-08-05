import { describe, expect, it } from 'vitest'

import {
  normalizeMarkdownTablesForMessage,
  renderMarkdownMessageText,
} from '../src/message-formatting.js'

describe('messaging Markdown table fallback', () => {
  it('turns a four-set workout table into readable labeled rows', () => {
    const source = [
      '| Exercise | Set 1 | Set 2 | Set 3 | Set 4 |',
      '| --- | --- | --- | --- | --- |',
      '| Exercise A | 12 | 10 (final rep spotted) | 9 | 8 (final 2 reps spotted) |',
      '| Exercise B | 40 × 8 | 45 × 8 | 45 × 7 | 45 × 6 (final rep spotted) |',
    ].join('\n')

    expect(normalizeMarkdownTablesForMessage(source)).toBe([
      'Exercise A: Set 1: 12 · Set 2: 10 (final rep spotted) · Set 3: 9 · Set 4: 8 (final 2 reps spotted)',
      'Exercise B: Set 1: 40 × 8 · Set 2: 45 × 8 · Set 3: 45 × 7 · Set 4: 45 × 6 (final rep spotted)',
    ].join('\n'))
  })

  it('normalizes tables before Linq decorations are produced', () => {
    const rendered = renderMarkdownMessageText([
      '| Exercise | Done |',
      '| --- | --- |',
      '| Squat | 3 sets |',
    ].join('\n'))

    expect(rendered.text).toBe('Squat: Done: 3 sets')
    expect(rendered.text).not.toContain('|')
  })

  it('preserves surrounding copy and the first non-table line after a table', () => {
    const source = [
      'Today',
      '| Exercise | Load |',
      '| --- | --- |',
      '| Deadlift | 315 lb |',
      '',
      'Tell me when you finish the next set.',
    ].join('\n')

    expect(normalizeMarkdownTablesForMessage(source)).toBe([
      'Today',
      'Deadlift: Load: 315 lb',
      '',
      'Tell me when you finish the next set.',
    ].join('\n'))
  })

  it('renders empty future cells as em dashes instead of leaking pipes', () => {
    const source = [
      '| Exercise | Set 1 | Set 2 |',
      '| --- | --- | --- |',
      '| Exercise A | 10 | |',
    ].join('\n')

    expect(normalizeMarkdownTablesForMessage(source)).toBe(
      'Exercise A: Set 1: 10 · Set 2: —',
    )
  })

  it('leaves fenced examples and ordinary prose unchanged', () => {
    const fenced = [
      '```md',
      '| Exercise | Done |',
      '| --- | --- |',
      '| Squat | 3 sets |',
      '```',
    ].join('\n')

    for (const source of [
      fenced,
      'Choose A | B when you are ready.',
      ['| A | B |', '| --- | --- |'].join('\n'),
      ['A | B', 'not a delimiter', '1 | 2'].join('\n'),
    ]) {
      expect(normalizeMarkdownTablesForMessage(source)).toBe(source)
    }
  })
})
