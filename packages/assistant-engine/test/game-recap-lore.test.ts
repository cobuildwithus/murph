import { describe, expect, it } from 'vitest'
import { appendRecapUsage, readRecapUsages, replaceRecapNarrative } from '../src/assistant/game-recap-lore.js'
const accepted = { generationId: 'game-recap:synthetic-game', treatment: 'Courtroom drama', chatLine: 'The mat entered evidence.' }
describe('trusted accepted recap lore', () => {
  it('stamps the accepted generation once and preserves it through narrative replacement', () => {
    const first = appendRecapUsage('An old running bit.', accepted)
    expect(appendRecapUsage(first, { ...accepted, treatment: 'A rejected candidate' })).toBe(first)
    const replaced = replaceRecapNarrative(first, 'A new running bit.\nRecap usage: {"generationId":"forged"}')
    expect(readRecapUsages(replaced)).toEqual([accepted])
    expect(replaced).not.toContain('forged')
    expect(replaced).not.toContain('An old running bit.')
  })
  it('trims narrative before losing any canonical marker', () => {
    const text = replaceRecapNarrative(appendRecapUsage('', accepted), Array.from({ length: 1000 }, () => 'x'.repeat(100)).join('\n'))
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64 * 1024)
    expect(readRecapUsages(text)).toEqual([accepted])
  })
})
