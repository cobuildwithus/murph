import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

const FUNCTION_DOCUMENTS_URL = 'https://my.functionhealth.com/documents'
const LIVONGO_SIGN_IN_URL = 'https://my.livongo.com'
const TELADOC_EXPORT_URL =
  'https://library.teladochealth.com/hc/en-us/articles/360044659034-How-to-Export-Your-Personal-Data-from-the-Secure-Livongo-Website'
const TELADOC_MIGRATION_URL =
  'https://www.teladochealth.com/start/new-experience-faq'
const STRONG_EXPORT_URL =
  'https://help.strongapp.io/article/235-export-workout-data'
const HEVY_EXPORT_URL =
  'https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy'

function connectedAppsPath(...segments: readonly string[]): string {
  return path.join(resolveAssistantSkillsRoot(), 'connected-apps', ...segments)
}

function buildDirectPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'imessage',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-08-09',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

describe('assistant manual provider export guidance', () => {
  it('keeps unsupported-provider export guidance reachable through the existing owner', async () => {
    const [skill, reference] = await Promise.all([
      readFile(connectedAppsPath('SKILL.md'), 'utf8'),
      readFile(
        connectedAppsPath('references', 'provider-data-exports.md'),
        'utf8',
      ),
    ])
    const connectedAppsSkill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'connected-apps',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')
    const normalizedReference = reference.replace(/\s+/gu, ' ')

    expect(connectedAppsSkill).toBeTruthy()
    expect(connectedAppsSkill?.triggerHint).toContain(
      'verified manual export or one-time import fallback',
    )
    expect(connectedAppsSkill?.triggerHint).toContain(
      'without a proven direct Murph connection',
    )
    expect(buildDirectPrompt()).toContain(
      'Read `$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md`.',
    )
    expect(skill).toContain('references/provider-data-exports.md')
    expect(normalizedSkill).toContain(
      'manual export or one-time import rather than a live sync',
    )
    expect(normalizedSkill).toContain(
      'does not make that service a connected-app provider',
    )
    expect(normalizedSkill).toContain(
      'verified fallback routes for Function Health, Livongo/Teladoc Condition Management, Strong, and Hevy',
    )
    expect(normalizedSkill).toContain(
      "Give the provider's verified action link",
    )
    expect(normalizedSkill).toContain(
      'an account or export page when one is documented, otherwise the official instructions',
    )
    expect(normalizedSkill).not.toContain(
      "Give the provider's official export link",
    )
    expect(normalizedSkill).not.toContain('Teladoc Health/Livongo')
    expect(normalizedReference).toContain(
      'manual export or one-time import, not a live sync',
    )
    expect(normalizedReference).toContain(
      'The trusted live provider list in the current prompt is authoritative',
    )
    expect(normalizedReference).toContain(
      'Ask for the original downloaded file as-is',
    )
    expect(normalizedReference).toContain(
      'In a group conversation, do not ask someone to upload private account data to the room',
    )
  })

  it('keeps each provider route narrow, truthful, and importable', async () => {
    const reference = await readFile(
      connectedAppsPath('references', 'provider-data-exports.md'),
      'utf8',
    )

    const normalizedReference = reference.replace(/\s+/gu, ' ')

    expect(reference).toContain(FUNCTION_DOCUMENTS_URL)
    expect(reference).toContain(LIVONGO_SIGN_IN_URL)
    expect(reference).toContain(TELADOC_EXPORT_URL)
    expect(reference).toContain(TELADOC_MIGRATION_URL)
    expect(reference).toContain(STRONG_EXPORT_URL)
    expect(reference).toContain(HEVY_EXPORT_URL)

    expect(reference).toContain('## Livongo / Teladoc Condition Management')
    expect(normalizedReference).toContain(
      'Use this recipe only for Livongo or Teladoc `Condition Management` data',
    )
    expect(normalizedReference).toContain(
      'A generic Teladoc request for virtual-visit notes',
    )
    expect(reference).toContain('`Reports and Data`')
    expect(normalizedReference).toContain(
      'For the normal legacy handoff, use the Livongo sign-in page as the user-facing action link',
    )
    expect(normalizedReference).toContain(
      "download contains all of the member's data but does not state the file format",
    )
    expect(normalizedReference).toContain(
      'choose `Condition Management`, then choose `Go to programs`',
    )
    expect(normalizedReference).not.toContain(
      'under `Programs` → `Condition Management`',
    )
    expect(normalizedReference).toContain(
      'does not document an equivalent export control',
    )
    expect(normalizedReference).toContain(
      'give the migration FAQ below as the fallback action link',
    )
    expect(normalizedReference).toContain('membersupport@livongo.com')
    expect(normalizedReference).toContain('800-945-4355')
    expect(normalizedReference).toContain(
      'Send exactly one action link',
    )
    expect(normalizedReference).toContain(
      'one-time snapshot, not continuous Teladoc sync',
    )

    expect(reference).toContain('`Export Strong Data`')
    expect(reference).toContain(
      'vault-cli workout import inspect <file> --vault "$VAULT" --source strong --format json',
    )
    expect(reference).toContain(
      'vault-cli workout import csv <file> --vault "$VAULT" --source strong --format json',
    )
    expect(normalizedReference).toContain(
      'Never infer units from locale, exercise names, or value size',
    )
    expect(normalizedReference).toContain(
      '`--distance-unit m|km|mi`',
    )
    expect(normalizedReference).toContain(
      '`lookupIds` and `ledgerFiles` are intentionally capped',
    )
    expect(normalizedReference).toContain(
      'the weight answer applies to every unitless load field',
    )
    expect(normalizedReference).toContain(
      'For both Strong and Hevy workout exports, inspect the original CSV before any write',
    )
    expect(normalizedReference).toContain(
      'the corrected unit option and `--correct-units`',
    )
    expect(normalizedReference).toContain(
      'If inspection returns `detectedSource: null` for headers shared by Strong and Hevy',
    )
    expect(normalizedReference).toContain(
      'Never guess Strong from shared workout headers',
    )
    expect(normalizedReference).toContain(
      'preserves the original workout timezone and other non-unit fields',
    )
    expect(normalizedReference).toContain(
      'correct the provider first and the units second',
    )
    expect(normalizedReference).toContain(
      'stop instead of overwriting member changes',
    )

    expect(reference).toContain('`Export Workouts`')
    expect(reference).toContain('`Export Measurements`')
    expect(reference).toContain(
      'vault-cli workout import inspect <file> --vault "$VAULT" --source hevy --format json',
    )
    expect(normalizedReference).toContain(
      'A Hevy measurements export is not a workout CSV',
    )
    expect(normalizedReference).toContain(
      'Follow the shared workout CSV import contract above',
    )

    expect(reference).toContain('Lab Results of Record')
    expect(normalizedReference).toContain(
      'The `computer-use` skill explicitly forbids automating Function login',
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
