import type {
  AssistantHostedAutomationTool,
  AssistantHostedAutomationToolRequest,
  AssistantHostedAutomationToolResponse,
} from '../../src/assistant/execution-context.ts'

type AutomationInspectResponse = Extract<
  AssistantHostedAutomationToolResponse,
  { action: 'inspect' }
>
type AutomationPatchRequest = Extract<
  AssistantHostedAutomationToolRequest,
  { action: 'patch' }
>

export type VersionedAutomationFixtureRecord = Omit<
  AutomationInspectResponse,
  'action' | 'routeBinding'
>

export function createVersionedAutomationPatchFixture(input: {
  current: VersionedAutomationFixtureRecord
  patch(
    request: AutomationPatchRequest,
    current: VersionedAutomationFixtureRecord,
  ): VersionedAutomationFixtureRecord
}) {
  let current = input.current
  let inspectedVersion: Pick<
    VersionedAutomationFixtureRecord,
    'automationId' | 'updatedAt'
  > | null = null
  const requests: AssistantHostedAutomationToolRequest[] = []

  const request: AssistantHostedAutomationTool['request'] = async (request) => {
    requests.push(request)

    if (request.action === 'inspect') {
      assertTargetsCurrentRecord(request.lookup, current)
      inspectedVersion = {
        automationId: current.automationId,
        updatedAt: current.updatedAt,
      }
      return {
        action: 'inspect',
        ...current,
        routeBinding: 'preserved',
      }
    }

    if (request.action !== 'patch') {
      throw new Error('Expected an inspect or patch request.')
    }

    assertTargetsCurrentRecord(request.lookup, current)
    const inspected = inspectedVersion
    inspectedVersion = null
    if (!inspected) {
      throw new Error('Inspect the automation before patching it.')
    }
    if (request.expectedUpdatedAt !== inspected.updatedAt) {
      throw new Error('Patch must use the inspected updatedAt version.')
    }
    if (
      current.automationId !== inspected.automationId
      || current.updatedAt !== inspected.updatedAt
    ) {
      throw new Error('Automation changed after inspection.')
    }

    const next = input.patch(request, current)
    assertSameRecordIdentity(current, next)
    current = next
    return {
      action: 'patch',
      ...current,
      created: false,
      routeBinding: 'preserved',
    }
  }

  return {
    replaceCurrent(record: VersionedAutomationFixtureRecord) {
      assertSameRecordIdentity(current, record)
      current = record
    },
    request,
    requests,
  }
}

function assertTargetsCurrentRecord(
  lookup: string,
  current: VersionedAutomationFixtureRecord,
): void {
  if (lookup !== current.automationId && lookup !== current.lookupId) {
    throw new Error('Automation lookup does not identify the fixture record.')
  }
}

function assertSameRecordIdentity(
  current: VersionedAutomationFixtureRecord,
  next: VersionedAutomationFixtureRecord,
): void {
  if (
    next.automationId !== current.automationId
    || next.lookupId !== current.lookupId
  ) {
    throw new Error('Automation fixture patches cannot replace record identity.')
  }
}
