import { describe, expect, it } from 'vitest'

import {
  assistantChannelSupportsReplyBubbles,
  splitAssistantReplyBubbles,
  stripAssistantReplyBubbleDelimiters,
} from '../src/assistant/reply-bubbles.ts'

describe('assistant reply bubbles', () => {
  it('detects bubble-capable texting channels only', () => {
    expect(assistantChannelSupportsReplyBubbles('linq')).toBe(true)
    expect(assistantChannelSupportsReplyBubbles(' Telegram ')).toBe(true)
    expect(assistantChannelSupportsReplyBubbles('WHATSAPP')).toBe(true)
    expect(assistantChannelSupportsReplyBubbles('email')).toBe(false)
    expect(assistantChannelSupportsReplyBubbles('local')).toBe(false)
    expect(assistantChannelSupportsReplyBubbles(null)).toBe(false)
  })

  it('passes through text with no delimiter', () => {
    expect(splitAssistantReplyBubbles('One plain reply.')).toEqual([
      'One plain reply.',
    ])
    expect(stripAssistantReplyBubbleDelimiters('One plain reply.')).toBe(
      'One plain reply.',
    )
  })

  it('splits on delimiter lines and trims bubbles', () => {
    expect(
      splitAssistantReplyBubbles('  First move.  \n---\n\nSecond move.\n'),
    ).toEqual(['First move.', 'Second move.'])
  })

  it('drops empty bubbles from leading, trailing, and consecutive delimiters', () => {
    expect(
      splitAssistantReplyBubbles('---\nFirst.\n---\n\n---\nSecond.\n---'),
    ).toEqual(['First.', 'Second.'])
  })

  it('folds overflow into the fourth bubble', () => {
    expect(
      splitAssistantReplyBubbles(
        ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'].join('\n---\n'),
      ),
    ).toEqual([
      'One.',
      'Two.',
      'Three.',
      ['Four.', 'Five.', 'Six.'].join('\n\n'),
    ])
  })

  it('leaves delimiter text inside longer lines untouched', () => {
    const text = 'A range like 5---8 is not a bubble break.\nSo keep it.'
    expect(splitAssistantReplyBubbles(text)).toEqual([text])
    expect(stripAssistantReplyBubbleDelimiters(text)).toBe(text)
  })

  it('strips delimiters by joining split bubbles with paragraph breaks', () => {
    const text = 'First.\n---\nSecond.\n---\nThird.'
    expect(stripAssistantReplyBubbleDelimiters(text)).toBe(
      splitAssistantReplyBubbles(text).join('\n\n'),
    )
    expect(stripAssistantReplyBubbleDelimiters(text)).toBe(
      'First.\n\nSecond.\n\nThird.',
    )
  })

  it('preserves delimiter-only text as one unsplit reply', () => {
    const text = ' \n---\n \n---\n'
    expect(splitAssistantReplyBubbles(text)).toEqual([text])
    expect(stripAssistantReplyBubbleDelimiters(text)).toBe(text)
  })
})
