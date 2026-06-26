import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  type FrontmatterObject,
  generateContractId,
  ID_PREFIXES,
} from '@murphai/contracts'
import {
  initializeVault,
  stringifyFrontmatterDocument,
  VAULT_LAYOUT,
} from '@murphai/core'
import { describe, expect, it } from 'vitest'

import {
  listAssistantContextSnapshotDirtyDomainsForPath,
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  refreshAssistantContextSnapshot,
  resolveAssistantContextSnapshotPath,
} from '../src/assistant/context-snapshot.js'

describe('assistant context snapshot', () => {
  it('classifies only prompt-snapshot source domains as dirty', () => {
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'audit/2026/2026-06.jsonl',
      ),
    ).toEqual([])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        '.runtime/operations/assistant/journals/runtime-events.jsonl',
      ),
    ).toEqual([])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'bank/experiments/sauna.md',
      ),
    ).toEqual(['experiments'])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'bank/goals/sleep.md',
      ),
    ).toEqual(['health_context'])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'ledger/events/2026-06.jsonl',
      ),
    ).toEqual(['blood_tests'])
    expect(
      listAssistantContextSnapshotDirtyDomainsForPath(
        'ledger/metric-samples/2026-06.jsonl',
      ),
    ).toEqual([])
  })

  it('does not refresh missing snapshots without a dirty marker', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })

      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-06-01T00:05:00.000Z',
        vaultRoot,
      })).resolves.toEqual({
        pendingDirtyDomains: [],
        refreshed: false,
        skipped: true,
      })
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toBeNull()
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('refreshes a compact prompt snapshot and keeps dirty completed snapshots readable', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })
      await writeTestSnapshotSources(vaultRoot)

      await markAssistantContextSnapshotDirty({
        domains: ['experiments', 'blood_tests', 'health_context'],
        vaultRoot,
      })
      const refreshed = await refreshAssistantContextSnapshot({
        now: () => '2026-06-01T00:05:00.000Z',
        vaultRoot,
      })

      expect(refreshed).toMatchObject({
        pendingDirtyDomains: [],
        refreshed: true,
        skipped: false,
      })
      const prompt = await readAssistantContextSnapshotPrompt({
        vaultRoot,
      })
      expect(prompt).toContain('Assistant context snapshot for navigation only:')
      expect(prompt).not.toContain('Wearable coverage is present')
      expect(prompt).toContain('Blood test records are present.')
      expect(prompt).toContain('Saved health context includes 1 goal.')
      expect(prompt).toContain('Active goals:')
      expect(prompt).toContain('11 p.m. sleep schedule ramp')
      expect(prompt).toContain('window 2026-06-24 to 2026-06-29')
      expect(prompt).toContain('Bank coverage includes 1 regimen record.')
      expect(prompt).toContain('Active habit regimens:')
      expect(prompt).toContain('Sleep schedule ramp')
      expect(prompt).toContain('Baseline 2:30 AM')
      expect(prompt).toContain(
        'read the relevant `vault-cli condition show` / `vault-cli allergy show` / `vault-cli regimen show` / `vault-cli goal show` record',
      )
      expect(prompt).toContain('Active experiment context for navigation only:')
      expect(prompt).toContain('Sleep consistency')
      await markAssistantContextSnapshotDirty({
        domains: ['experiments'],
        vaultRoot,
      })

      await expect(readAssistantContextSnapshotPrompt({
        vaultRoot,
      })).resolves.toContain('Sleep consistency')
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: ['experiments'],
        })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('preserves pending dirty domains when a background refresh yields', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })
      await markAssistantContextSnapshotDirty({
        domains: ['experiments'],
        vaultRoot,
      })

      await expect(refreshAssistantContextSnapshotBestEffort({
        shouldYield: () => true,
        vaultRoot,
      })).resolves.toEqual({
        pendingDirtyDomains: ['experiments'],
        refreshed: false,
        skipped: false,
      })
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: ['experiments'],
        })
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

  it('injects active safety-critical health context into the prompt snapshot', async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-context-snapshot-'))
    const conditionId = generateContractId(ID_PREFIXES.condition)
    const medicationRegimenId = generateContractId(ID_PREFIXES.regimen)
    const supplementRegimenId = generateContractId(ID_PREFIXES.regimen)
    const inactiveMedicationRegimenId = generateContractId(ID_PREFIXES.regimen)
    const allergyId = generateContractId(ID_PREFIXES.allergy)
    const inactiveAllergyId = generateContractId(ID_PREFIXES.allergy)

    try {
      await writeVaultDocument({
        attributes: {
          schemaVersion: CONTRACT_SCHEMA_VERSION.conditionFrontmatter,
          docType: FRONTMATTER_DOC_TYPES.condition,
          conditionId,
          slug: 'thoracic-radiculopathy-radiculitis',
          title: 'Thoracic radiculopathy / radiculitis',
          clinicalStatus: 'active',
          verificationStatus: 'confirmed',
          assertedOn: '2026-06-20',
          severity: 'moderate',
          bodySites: ['thoracic spine', 'T7-T8 neural foramen'],
          relatedRegimenIds: [supplementRegimenId, inactiveMedicationRegimenId],
          note: 'Relevant context: T8 plasmacytoma with epidural and left T7-T8 neural-foramen extension.',
        },
        relativePath: `${VAULT_LAYOUT.conditionsDirectory}/thoracic-radiculopathy-radiculitis.md`,
        vaultRoot,
      })
      await writeVaultDocument({
        attributes: {
          schemaVersion: CONTRACT_SCHEMA_VERSION.allergyFrontmatter,
          docType: FRONTMATTER_DOC_TYPES.allergy,
          allergyId,
          slug: 'penicillin-allergy',
          title: 'Penicillin allergy',
          substance: 'Penicillin',
          status: 'active',
          criticality: 'high',
          reaction: 'hives',
          recordedOn: '2026-06-01',
          relatedConditionIds: [conditionId],
        },
        relativePath: `${VAULT_LAYOUT.allergiesDirectory}/penicillin-allergy.md`,
        vaultRoot,
      })
      await writeVaultDocument({
        attributes: {
          schemaVersion: CONTRACT_SCHEMA_VERSION.allergyFrontmatter,
          docType: FRONTMATTER_DOC_TYPES.allergy,
          allergyId: inactiveAllergyId,
          slug: 'inactive-allergy',
          title: 'Inactive allergy',
          substance: 'Inactive substance',
          status: 'inactive',
        },
        relativePath: `${VAULT_LAYOUT.allergiesDirectory}/inactive-allergy.md`,
        vaultRoot,
      })
      await writeVaultDocument({
        attributes: {
          schemaVersion: CONTRACT_SCHEMA_VERSION.regimenFrontmatter,
          docType: FRONTMATTER_DOC_TYPES.regimen,
          regimenId: medicationRegimenId,
          slug: 'pregabalin',
          title: 'Pregabalin',
          kind: 'medication',
          status: 'active',
          startedOn: '2026-06-01',
          substance: 'pregabalin',
          dose: 75,
          unit: 'mg',
          schedule: 'nightly',
          relatedConditionIds: [conditionId],
        },
        relativePath: `${VAULT_LAYOUT.regimensDirectory}/pregabalin.md`,
        vaultRoot,
      })
      await writeVaultDocument({
        attributes: {
          schemaVersion: CONTRACT_SCHEMA_VERSION.regimenFrontmatter,
          docType: FRONTMATTER_DOC_TYPES.regimen,
          regimenId: supplementRegimenId,
          slug: 'magnesium-glycinate',
          title: 'Magnesium glycinate',
          kind: 'supplement',
          status: 'active',
          startedOn: '2026-05-15',
          schedule: 'with dinner',
          ingredients: [
            {
              compound: 'magnesium glycinate',
              amount: 200,
              unit: 'mg',
            },
          ],
        },
        relativePath: `${VAULT_LAYOUT.regimensDirectory}/magnesium-glycinate.md`,
        vaultRoot,
      })
      await writeVaultDocument({
        attributes: {
          schemaVersion: CONTRACT_SCHEMA_VERSION.regimenFrontmatter,
          docType: FRONTMATTER_DOC_TYPES.regimen,
          regimenId: inactiveMedicationRegimenId,
          slug: 'stopped-medication',
          title: 'Stopped medication',
          kind: 'medication',
          status: 'stopped',
          startedOn: '2025-01-01',
          stoppedOn: '2025-02-01',
        },
        relativePath: `${VAULT_LAYOUT.regimensDirectory}/stopped-medication.md`,
        vaultRoot,
      })

      await markAssistantContextSnapshotDirty({
        domains: ['health_context'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({
        now: () => '2026-06-26T12:00:00.000Z',
        vaultRoot,
      })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      const promptText = prompt ?? ''

      expect(promptText).toContain('Active conditions:')
      expect(promptText).toContain('Thoracic radiculopathy / radiculitis')
      expect(promptText).toContain('T8 plasmacytoma')
      expect(promptText).toContain('Active allergies:')
      expect(promptText).toContain('Penicillin allergy')
      expect(promptText).toContain('criticality high')
      expect(promptText).toContain('Active medication regimens:')
      expect(promptText).toContain('Pregabalin')
      expect(promptText).toContain('dose 75 mg')
      expect(promptText).toContain('Active supplement regimens:')
      expect(promptText).toContain('Magnesium glycinate')
      expect(promptText).toContain('ingredients magnesium glycinate 200 mg')
      expect(promptText).toContain('related conditions Thoracic radiculopathy / radiculitis')
      expect(promptText).toContain('vault-cli allergy show')
      expect(promptText).toContain('vault-cli regimen show')
      expect(promptText).not.toContain('Inactive allergy')
      expect(promptText).not.toContain('Stopped medication')
    } finally {
      await rm(vaultRoot, { force: true, recursive: true })
    }
  })

  it('self-heals corrupt snapshots while oversized prompt reads return null', async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), 'assistant-context-snapshot-'))
    const vaultRoot = path.join(parentRoot, 'vault')
    const snapshotPath = resolveAssistantContextSnapshotPath(vaultRoot)

    try {
      await initializeVault({
        createdAt: '2026-06-01T00:00:00.000Z',
        vaultRoot,
      })
      await mkdir(path.dirname(snapshotPath), { recursive: true })
      await writeFile(snapshotPath, '{not-json', 'utf8')

      await expect(refreshAssistantContextSnapshot({
        now: () => '2026-06-01T00:05:00.000Z',
        vaultRoot,
      })).resolves.toMatchObject({
        refreshed: true,
        skipped: false,
      })
      await expect(readAssistantContextSnapshotState(vaultRoot))
        .resolves.toMatchObject({
          pendingDirtyDomains: [],
        })

      await writeFile(
        snapshotPath,
        JSON.stringify({
          schema: 'murph.assistant-context-snapshot',
          schemaVersion: 1,
          value: {
            dirtySequence: 0,
            lastCompleted: {
              generatedAt: '2026-06-01T00:06:00.000Z',
              includedDomains: ['experiments'],
              promptBlock: 'large sensitive snapshot '.repeat(4_000),
              sectionPresence: {
                activeExperiments: true,
                bloodTests: false,
                healthContext: false,
              },
              sourceDirtySequence: 0,
            },
            lastRefreshAttempt: null,
            pendingDirtyDomains: [],
          },
        }),
        'utf8',
      )
      await expect(readAssistantContextSnapshotPrompt({
        vaultRoot,
      })).resolves.toBeNull()
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })
})

async function writeVaultDocument(input: {
  attributes: FrontmatterObject
  body?: string
  relativePath: string
  vaultRoot: string
}): Promise<void> {
  const filePath = path.join(input.vaultRoot, input.relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    stringifyFrontmatterDocument({
      attributes: input.attributes,
      body: input.body ?? '',
    }),
    'utf8',
  )
}

async function writeTestSnapshotSources(vaultRoot: string): Promise<void> {
  await mkdir(path.join(vaultRoot, 'bank/experiments'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'bank/experiments/sleep-consistency.md'),
    [
      '---',
      'schemaVersion: murph.frontmatter.experiment.v1',
      'docType: experiment',
      'experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM',
      'slug: sleep-consistency',
      'status: active',
      'title: Sleep consistency',
      'startedOn: 2026-05-20',
      'runPlan:',
      '  baselineStart: 2026-05-20',
      '  baselineEnd: 2026-05-26',
      '  interventionStart: 2026-05-27',
      '  interventionEnd: 2026-06-10',
      '  modality: sleep',
      '---',
      '# Sleep consistency',
      '',
    ].join('\n'),
    'utf8',
  )

  await mkdir(path.join(vaultRoot, 'bank/goals'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'bank/goals/sleep.md'),
    [
      '---',
      'schemaVersion: murph.frontmatter.goal.v1',
      'docType: goal',
      'goalId: goal_01JNY0B2W4VG5C2A0G9S8M7R6Q',
      'slug: eleven-pm-sleep-ramp',
      'title: 11 p.m. sleep schedule ramp',
      'status: active',
      'horizon: short_term',
      'priority: 4',
      'window:',
      '  startAt: 2026-06-24',
      '  targetAt: 2026-06-29',
      'domains:',
      '  - sleep',
      '---',
      '# 11 p.m. sleep schedule ramp',
      '',
    ].join('\n'),
    'utf8',
  )

  await mkdir(path.join(vaultRoot, 'bank/regimens'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'bank/regimens/sleep-schedule-ramp.md'),
    [
      '---',
      'schemaVersion: murph.frontmatter.regimen.v1',
      'docType: regimen',
      'regimenId: reg_01JNY0B2W4VG5C2A0G9S8M7R6Q',
      'slug: sleep-schedule-ramp',
      'title: Sleep schedule ramp',
      'kind: habit',
      'status: active',
      'startedOn: 2026-06-24',
      'schedule: nightly wind-down plus morning light anchor',
      'note: Baseline 2:30 AM; target lights-out 11 PM by June 29; ramp ladder saved; tiny version phone on charger, dim lights, brush teeth, sit quietly 2 minutes.',
      'relatedGoalIds:',
      '  - goal_01JNY0B2W4VG5C2A0G9S8M7R6Q',
      '---',
      '# Sleep schedule ramp',
      '',
    ].join('\n'),
    'utf8',
  )

  await mkdir(path.join(vaultRoot, 'ledger/events'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'ledger/events/2026-06.jsonl'),
    [
      JSON.stringify({
        kind: 'test',
        specimenType: 'blood',
        testCategory: 'blood',
      }),
      JSON.stringify({
        dataOrigin: {
          sourceProviderSlug: 'garmin',
        },
        kind: 'observation',
      }),
      '',
    ].join('\n'),
    'utf8',
  )
}
