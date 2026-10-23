import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSISTANT_SKILLS, buildAssistantSkillFileRef, resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildBluetoothHelpInstructions } from './support/bluetooth-help.js'

describe('Bluetooth wearable help contract', () => {
  it('registers a bundled skill for local connection help', async () => {
    const entries = ASSISTANT_SKILLS.filter((skill) => skill.slug === 'bluetooth-device-help')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.triggerHint).toMatch(/WHOOP.*Ask Murph/u)
    expect(buildAssistantSkillFileRef('bluetooth-device-help')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/bluetooth-device-help/SKILL.md',
    )
    const skill = await readFile(path.join(resolveAssistantSkillsRoot(), 'bluetooth-device-help/SKILL.md'), 'utf8')
    expect(skill).toMatch(/^---\nname: bluetooth-device-help\ndescription: .+\n---/u)
  })

  it.each(['direct', 'group'] as const)('routes local Bluetooth before setup without suppressing cloud sync (%s)', (scope) => {
    const prompt = buildBluetoothHelpInstructions(scope)
    const bluetooth = prompt.indexOf('- Bluetooth wearable help, WHOOP not connecting to Murph')
    expect(bluetooth).toBeGreaterThan(-1)
    expect(bluetooth).toBeLessThan(prompt.indexOf('- Setup:'))
    expect(prompt).toContain('bluetooth-device-help before setup or data-sync guidance')
    expect(prompt).toContain('local Bluetooth has no device logs or remote diagnostic tool')
    if (scope === 'direct') {
      expect(prompt).toContain('Apple Health relay (saved health data, not live Bluetooth heart rate):')
      expect(prompt).toContain('Hosted wearable connection links are available for WHOOP')
    }
  })
})
