import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const FUNCTION_DOCUMENTS_URL = 'https://my.functionhealth.com/documents'
const TELADOC_EXPORT_URL =
  'https://library.teladochealth.com/hc/en-us/articles/360044659034-How-to-Export-Your-Personal-Data-from-the-Secure-Livongo-Website'
const STRONG_EXPORT_URL =
  'https://help.strongapp.io/article/235-export-workout-data'
const HEVY_EXPORT_URL =
  'https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy'

function connectedAppsPath(...segments: readonly string[]): string {
  return path.join(resolveAssistantSkillsRoot(), 'connected-apps', ...segments)
}

describe('assistant manual provider export guidance', () => {
  it('routes unsupported health and fitness sources through verified export handoffs', async () => {
    const [skill, reference] = await Promise.all([
      readFile(connectedAppsPath('SKILL.md'), 'utf8'),
      readFile(
        connectedAppsPath('references', 'provider-data-exports.md'),
        'utf8',
      ),
    ])

    expect(skill).toContain('references/provider-data-exports.md')
    expect(skill).toContain(
      'manual export or one-time import rather than a live sync',
    )
    expect(skill).toContain(
      'does not make that service a connected-app provider',
    )
    expect(reference).toContain(
      'manual export or one-time import, not a live sync',
    )
    expect(reference).toContain(
      'The trusted live provider list in the current prompt is authoritative',
    )
    expect(reference).toContain(
      'Ask for the original downloaded file as-is',
    )
  })

  it('keeps each provider route grounded in its official export instructions', async () => {
    const reference = await readFile(
      connectedAppsPath('references', 'provider-data-exports.md'),
      'utf8',
    )

    expect(reference).toContain(FUNCTION_DOCUMENTS_URL)
    expect(reference).toContain(TELADOC_EXPORT_URL)
    expect(reference).toContain(STRONG_EXPORT_URL)
    expect(reference).toContain(HEVY_EXPORT_URL)
    expect(reference).toContain('`Reports and Data`')
    expect(reference).toContain('does not state the file format')
    expect(reference).toContain('`Export Strong Data`')
    expect(reference).toContain('`Export Workouts`')
    expect(reference).toContain('`Export Measurements`')
    expect(reference).toContain(
      'Treat `Teladoc`, `Teladoc Health`, and `Livongo` as aliases',
    )
  })

  it('keeps the Function Health onboarding shortcut aligned with the shared catalog', async () => {
    const [onboarding, reference] = await Promise.all([
      readFile(
        path.join(
          resolveAssistantSkillsRoot(),
          'murph-onboarding',
          'references',
          'aspiration-foundation-delegation.md',
        ),
        'utf8',
      ),
      readFile(
        connectedAppsPath('references', 'provider-data-exports.md'),
        'utf8',
      ),
    ])

    expect(onboarding).toContain(FUNCTION_DOCUMENTS_URL)
    expect(reference).toContain(FUNCTION_DOCUMENTS_URL)
    expect(onboarding).toContain('Lab Results of Record')
    expect(reference).toContain('Lab Results of Record')
  })
})
