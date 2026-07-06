import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import {
  classifyVaultCliInvocation,
  type KnownLazyRootCommand,
} from '../src/vault-cli-routing.ts'

const mockedModules = [
  '@murphai/assistant-cli/commands/assistant',
  '../src/commands/automation.js',
  '../src/commands/batch.js',
  '../src/commands/health-blood-test-save.js',
  '../src/commands/health-immunization-save.js',
  '../src/commands/commons.js',
  '../src/commands/device.js',
  '../src/commands/clinical-imports.js',
  '../src/commands/encounter.js',
  '../src/commands/experiment.js',
  '../src/commands/exercise.js',
  '../src/commands/health-goal-save.js',
  '../src/commands/group.js',
  '../src/commands/meal.js',
  '../src/commands/medication.js',
  '../src/commands/measurement.js',
  '../src/commands/memory.js',
  '../src/commands/protocol.js',
  '../src/commands/read.js',
  '../src/commands/research.js',
  '../src/commands/search.js',
  '../src/commands/supplement.js',
  '../src/commands/vault.js',
  '../src/commands/wearables.js',
  '../src/device-services.js',
  '../src/vault-cli-inbox-services.js',
  '@murphai/vault-usecases/vault-services',
] as const

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  for (const moduleId of mockedModules) {
    vi.doUnmock(moduleId)
  }
})

function createTestVaultServices() {
  return {
    core: {},
    importers: {},
    query: {},
  }
}

async function assertScopedVaultServiceCommand(input: {
  moduleId: string
  registerName: string
  root: KnownLazyRootCommand
}) {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const services = createTestVaultServices()
  const registerCommands = vi.fn()
  const createIntegratedVaultServices = vi.fn(() => services)
  vi.doMock(input.moduleId, () => ({
    [input.registerName]: registerCommands,
  }))
  vi.doMock('@murphai/vault-usecases/vault-services', () => ({
    createIntegratedVaultServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: input.root,
  })

  assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
  assert.deepEqual(registerCommands.mock.calls, [[cli, services]])
}

async function assertScopedCommandWithoutServices(input: {
  moduleId: string
  registerName: string
  root: KnownLazyRootCommand
}) {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const registerCommands = vi.fn()
  vi.doMock(input.moduleId, () => ({
    [input.registerName]: registerCommands,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: input.root,
  })

  assert.deepEqual(registerCommands.mock.calls, [[cli]])
}

test('scoped command routing mounts assistant commands with inbox and vault services', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const services = createTestVaultServices()
  const inboxServices = {
    readInbox: vi.fn(),
  }
  const registerAssistantCommands = vi.fn()
  const createIntegratedVaultServices = vi.fn(() => services)
  const createDefaultInboxServices = vi.fn(() => inboxServices)
  const deviceServices = { listAccounts: vi.fn() }
  const servicesWithDevices = {
    ...services,
    devices: deviceServices,
  }
  const createIntegratedDeviceSyncServices = vi.fn(() => deviceServices)
  const ensureCliVaultServices = vi.fn(() => servicesWithDevices)
  vi.doMock('@murphai/assistant-cli/commands/assistant', () => ({
    registerAssistantCommands,
  }))
  vi.doMock('@murphai/vault-usecases/vault-services', () => ({
    createIntegratedVaultServices,
  }))
  vi.doMock('../src/vault-cli-inbox-services.js', () => ({
    createDefaultInboxServices,
  }))
  vi.doMock('../src/device-services.js', () => ({
    createIntegratedDeviceSyncServices,
    ensureCliVaultServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'assistant',
  })

  assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
  assert.equal(createDefaultInboxServices.mock.calls.length, 1)
  assert.equal(createIntegratedDeviceSyncServices.mock.calls.length, 1)
  assert.deepEqual(ensureCliVaultServices.mock.calls, [[
    services,
    {
      devices: deviceServices,
    },
  ]])
  assert.deepEqual(registerAssistantCommands.mock.calls, [[
    cli,
    inboxServices,
    servicesWithDevices,
  ]])
})

for (const root of ['chat', 'doctor', 'run', 'status', 'stop'] as const) {
  test(`scoped command routing maps ${root} assistant shorthand to assistant commands`, async () => {
    const cli = Cli.create('vault-cli', { description: 'test cli' })
    const services = createTestVaultServices()
    const inboxServices = {
      readInbox: vi.fn(),
    }
    const registerAssistantCommands = vi.fn()
    const createIntegratedVaultServices = vi.fn(() => services)
    const createDefaultInboxServices = vi.fn(() => inboxServices)
    const deviceServices = { listAccounts: vi.fn() }
    const servicesWithDevices = {
      ...services,
      devices: deviceServices,
    }
    const createIntegratedDeviceSyncServices = vi.fn(() => deviceServices)
    const ensureCliVaultServices = vi.fn(() => servicesWithDevices)
    vi.doMock('@murphai/assistant-cli/commands/assistant', () => ({
      registerAssistantCommands,
    }))
    vi.doMock('@murphai/vault-usecases/vault-services', () => ({
      createIntegratedVaultServices,
    }))
    vi.doMock('../src/vault-cli-inbox-services.js', () => ({
      createDefaultInboxServices,
    }))
    vi.doMock('../src/device-services.js', () => ({
      createIntegratedDeviceSyncServices,
      ensureCliVaultServices,
    }))

    const { registerScopedVaultCliCommand } = await import(
      '../src/vault-cli-command-routing.ts'
    )
    await registerScopedVaultCliCommand({
      cli,
      root,
    })

    assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
    assert.equal(createDefaultInboxServices.mock.calls.length, 1)
    assert.equal(createIntegratedDeviceSyncServices.mock.calls.length, 1)
    assert.deepEqual(ensureCliVaultServices.mock.calls, [[
      services,
      {
        devices: deviceServices,
      },
    ]])
    assert.deepEqual(registerAssistantCommands.mock.calls, [[
      cli,
      inboxServices,
      servicesWithDevices,
    ]])
  })
}

for (const input of [
  {
    moduleId: '../src/commands/clinical-imports.js',
    registerName: 'registerAssertionCommands',
    root: 'assertion',
  },
  {
    moduleId: '../src/commands/automation.js',
    registerName: 'registerAutomationCommands',
    root: 'automation',
  },
  {
    moduleId: '../src/commands/batch.js',
    registerName: 'registerBatchCommands',
    root: 'batch',
  },
  {
    moduleId: '../src/commands/group.js',
    registerName: 'registerGroupCommands',
    root: 'group',
  },
  {
    moduleId: '../src/commands/clinical-imports.js',
    registerName: 'registerClinicalNoteCommands',
    root: 'clinical-note',
  },
  {
    moduleId: '../src/commands/clinical-imports.js',
    registerName: 'registerDiagnosticTestCommands',
    root: 'diagnostic-test',
  },
  {
    moduleId: '../src/commands/measurement.js',
    registerName: 'registerMeasurementCommands',
    root: 'measurement',
  },
  {
    moduleId: '../src/commands/encounter.js',
    registerName: 'registerEncounterCommands',
    root: 'encounter',
  },
  {
    moduleId: '../src/commands/memory.js',
    registerName: 'registerMemoryCommands',
    root: 'memory',
  },
  {
    moduleId: '../src/commands/research.js',
    registerName: 'registerResearchCommands',
    root: 'research',
  },
  {
    moduleId: '../src/commands/exercise.js',
    registerName: 'registerExerciseCommands',
    root: 'exercise',
  },
  {
    moduleId: '../src/commands/clinical-imports.js',
    registerName: 'registerSocialHistoryCommands',
    root: 'social-history',
  },
  {
    moduleId: '../src/commands/clinical-imports.js',
    registerName: 'registerVitalsCommands',
    root: 'vitals',
  },
] as const) {
  test(`scoped command routing maps ${input.root} without vault services`, async () => {
    await assertScopedCommandWithoutServices(input)
  })
}

test('scoped command routing mounts the real commons command family', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const registerCommonsCommands = vi.fn()
  vi.doMock('../src/commands/commons.js', () => ({
    registerCommonsCommands,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'commons',
  })

  assert.deepEqual(registerCommonsCommands.mock.calls, [[cli]])
})

test('scoped command routing mounts device commands with device services only', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const deviceServices = {
    listProviders: vi.fn(),
  }
  const registerDeviceCommands = vi.fn()
  const createIntegratedDeviceSyncServices = vi.fn(() => deviceServices)
  vi.doMock('../src/commands/device.js', () => ({
    registerDeviceCommands,
  }))
  vi.doMock('../src/device-services.js', () => ({
    createIntegratedDeviceSyncServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'device',
  })

  assert.equal(createIntegratedDeviceSyncServices.mock.calls.length, 1)
  assert.deepEqual(registerDeviceCommands.mock.calls, [[cli, deviceServices]])
})

test('scoped command routing mounts experiment commands with vault services', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const services = createTestVaultServices()
  const registerExperimentCommands = vi.fn()
  const createIntegratedVaultServices = vi.fn(() => services)
  vi.doMock('../src/commands/experiment.js', () => ({
    registerExperimentCommands,
  }))
  vi.doMock('@murphai/vault-usecases/vault-services', () => ({
    createIntegratedVaultServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'experiment',
  })

  assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
  assert.deepEqual(registerExperimentCommands.mock.calls, [[cli, services]])
})

for (const input of [
  {
    moduleId: '../src/commands/health-blood-test-save.js',
    registerName: 'registerBloodTestCommands',
    root: 'blood-test',
  },
  {
    moduleId: '../src/commands/health-immunization-save.js',
    registerName: 'registerImmunizationCommands',
    root: 'immunization',
  },
  {
    moduleId: '../src/commands/health-goal-save.js',
    registerName: 'registerGoalCommands',
    root: 'goal',
  },
  {
    moduleId: '../src/commands/meal.js',
    registerName: 'registerMealCommands',
    root: 'meal',
  },
  {
    moduleId: '../src/commands/medication.js',
    registerName: 'registerMedicationCommands',
    root: 'medication',
  },
  {
    moduleId: '../src/commands/supplement.js',
    registerName: 'registerSupplementCommands',
    root: 'supplement',
  },
  {
    moduleId: '../src/commands/wearables.js',
    registerName: 'registerWearablesCommands',
    root: 'wearables',
  },
] as const) {
  test(`scoped command routing maps ${input.root} to its command family`, async () => {
    await assertScopedVaultServiceCommand(input)
  })
}

for (const root of ['list', 'show'] as const) {
  test(`scoped command routing maps ${root} to the generic read command family`, async () => {
    await assertScopedVaultServiceCommand({
      moduleId: '../src/commands/read.js',
      registerName: 'registerReadCommands',
      root,
    })
  })
}

for (const root of ['query', 'search', 'timeline'] as const) {
  test(`scoped command routing maps ${root} to the search command family`, async () => {
    await assertScopedCommandWithoutServices({
      moduleId: '../src/commands/search.js',
      registerName: 'registerSearchCommands',
      root,
    })
  })
}

for (const root of ['protocol', 'regimen'] as const) {
  test(`scoped command routing maps ${root} to the protocol command family`, async () => {
    await assertScopedVaultServiceCommand({
      moduleId: '../src/commands/protocol.js',
      registerName: 'registerProtocolCommands',
      root,
    })
  })
}

for (const root of ['init', 'validate', 'vault'] as const) {
  test(`scoped command routing maps ${root} to the vault command family`, async () => {
    const cli = Cli.create('vault-cli', { description: 'test cli' })
    const services = createTestVaultServices()
    const registerVaultCommands = vi.fn()
    const createIntegratedVaultServices = vi.fn(() => services)
    vi.doMock('../src/commands/vault.js', () => ({
      registerVaultCommands,
    }))
    vi.doMock('@murphai/vault-usecases/vault-services', () => ({
      createIntegratedVaultServices,
    }))

    const { registerScopedVaultCliCommand } = await import(
      '../src/vault-cli-command-routing.ts'
    )
    await registerScopedVaultCliCommand({
      cli,
      root,
    })

    assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
    assert.deepEqual(registerVaultCommands.mock.calls, [[cli, services]])
  })
}

const intentionallyFullOnlyRootCommandReasons = {
  age: 'Murph Age imports model/readiness surfaces and is not a common onboarding path.',
  allergy: 'Generic health CRUD root not currently a measured hot path.',
  audit: 'Audit commands are operator/maintenance oriented and can keep full discovery.',
  capture: 'Capture commands are broad media/attachment ingestion commands.',
  condition: 'Generic health CRUD root not currently a measured hot path.',
  document: 'Document import/show/list is not part of the optimized onboarding path.',
  event: 'Generic event command family has many typed subcommands and is not a hot path.',
  export: 'Export is an occasional full-vault operator path.',
  family: 'Generic health CRUD root not currently a measured hot path.',
  food: 'Food commands are not currently part of the frequent lazy-read path.',
  genetics: 'Generic health CRUD root not currently a measured hot path.',
  intake: 'Intake helper commands are not currently a frequent agent path.',
  intervention: 'Intervention helper commands are not currently a frequent agent path.',
  journal: 'Journal commands are not currently part of the optimized onboarding path.',
  knowledge: 'Knowledge writes are assistant-authored derived-page flows, not ordinary reads.',
  model: 'Model commands are runtime/model-card operator diagnostics.',
  provider: 'Provider registry commands are not currently a frequent agent path.',
  recipe: 'Recipe commands are not currently part of the optimized onboarding path.',
  route: 'Route commands depend on optional Mapbox routing behavior.',
  samples: 'Samples commands cover explicit raw/debug sample paths.',
  'scheduled-log': 'Scheduled-log commands are older operational helpers.',
  workout: 'Workout commands include richer capture/import surfaces.',
} as const satisfies Record<string, string>

test('lazy route table accounts for every full manifest root command', async () => {
  vi.resetModules()
  for (const moduleId of mockedModules) {
    vi.doUnmock(moduleId)
  }

  const { collectVaultCliDescriptorRootCommandNames } = await import(
    '../src/vault-cli-command-manifest.ts'
  )
  const manifestRootCommands = collectVaultCliDescriptorRootCommandNames()
  const intentionallyFullOnlyRootCommands = new Set(
    Object.keys(intentionallyFullOnlyRootCommandReasons),
  )
  const staleFullOnlyEntries = [...intentionallyFullOnlyRootCommands].filter(
    (root) => !manifestRootCommands.includes(root),
  )
  assert.deepEqual(staleFullOnlyEntries, [])

  const unaccountedRootCommands: string[] = []
  for (const root of manifestRootCommands) {
    const plan = classifyVaultCliInvocation([root])
    if (plan.kind === 'scoped') {
      continue
    }

    if (intentionallyFullOnlyRootCommands.has(root)) {
      continue
    }

    unaccountedRootCommands.push(
      plan.kind === 'full' ? `${root}:${plan.reason}` : root,
    )
  }

  assert.deepEqual(unaccountedRootCommands, [])

  for (const root of ['assistant', 'chat', 'run', 'status', 'doctor', 'stop'] as const) {
    assert.deepEqual(classifyVaultCliInvocation([root]), {
      kind: 'scoped',
      root,
    })
  }
}, 120_000)
