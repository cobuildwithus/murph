import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  MURPH_MEMBER_MAINTENANCE_TOOL,
  listMurphDynamicToolNames,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantMaintenanceSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'
import {
  executeMemberMaintenanceDynamicTool,
} from '../src/assistant-codex/dynamic-tools/member-maintenance.js'
import type {
  AssistantHostedAutomationTool,
} from '../src/assistant/execution-context.js'

describe('member reminder maintenance policy', () => {
  it('keeps the maintenance adapter default-off and narrowly shaped', () => {
    expect(resolveMurphDynamicTools({})).not.toContain(
      MURPH_MEMBER_MAINTENANCE_TOOL,
    )
    expect(listMurphDynamicToolNames()).toContain('murph.maintenance')

    expect([
      ...collectPropertyStringEnums(
        MURPH_MEMBER_MAINTENANCE_TOOL.inputSchema,
        'action',
      ),
    ].sort()).toEqual([
      'execute_connected_read',
      'list_connected_accounts',
      'patch_automation_instructions',
      'search_connected_tools',
    ])

    const propertyKeys = collectJsonSchemaPropertyKeys(
      MURPH_MEMBER_MAINTENANCE_TOOL.inputSchema,
    )
    for (const forbidden of [
      'agentApproved',
      'alias',
      'activeUntil',
      'route',
      'schedule',
      'status',
      'supportKind',
      'supportSeriesId',
      'tags',
      'title',
    ]) {
      expect(propertyKeys.has(forbidden)).toBe(false)
    }
  })

  it('binds narrow reads and instruction patches to an eligible automation', () => {
    expect(readMaintenanceRequest({
      action: 'list_connected_accounts',
      lookup: 'automation-reminder',
      source: 'calendar',
      toolkit: 'googlecalendar',
    })).toEqual({
      kind: 'member-maintenance-connected-apps',
      lookup: 'automation-reminder',
      request: {
        args: {
          action: 'list',
          toolkit: 'googlecalendar',
        },
        kind: 'connected-apps-manage',
      },
      source: 'calendar',
    })

    expect(readMaintenanceRequest({
      action: 'search_connected_tools',
      lookup: 'automation-reminder',
      query: 'list calendar events between two timestamps',
      source: 'calendar',
      toolkits: ['googlecalendar'],
    })).toMatchObject({
      kind: 'member-maintenance-connected-apps',
      lookup: 'automation-reminder',
      request: {
        args: {
          query: 'list calendar events between two timestamps',
          toolkits: ['googlecalendar'],
        },
        kind: 'connected-apps-search',
      },
      source: 'calendar',
    })

    expect(readMaintenanceRequest({
      account: 'calendar-account',
      action: 'execute_connected_read',
      arguments: {
        timeMax: '2026-08-06T00:00:00.000Z',
        timeMin: '2026-07-30T00:00:00.000Z',
      },
      lookup: 'automation-reminder',
      source: 'calendar',
      toolSlug: 'GOOGLECALENDAR_LIST_EVENTS',
    })).toMatchObject({
      kind: 'member-maintenance-connected-apps',
      lookup: 'automation-reminder',
      request: {
        args: {
          account: 'calendar-account',
          toolSlug: 'GOOGLECALENDAR_LIST_EVENTS',
        },
        kind: 'connected-apps-execute',
      },
      source: 'calendar',
    })

    expect(readMaintenanceRequest({
      account: 'outlook-account',
      action: 'execute_connected_read',
      arguments: {
        endDateTime: '2026-08-06T00:00:00.000Z',
        startDateTime: '2026-07-30T00:00:00.000Z',
      },
      lookup: 'automation-reminder',
      source: 'calendar',
      toolSlug: 'OUTLOOK_GET_CALENDAR_VIEW',
    })).toMatchObject({
      kind: 'member-maintenance-connected-apps',
      source: 'calendar',
    })

    expect(readMaintenanceRequest({
      account: 'outlook-account',
      action: 'execute_connected_read',
      arguments: {
        received_date_time_ge: '2026-07-23T00:00:00.000Z',
      },
      lookup: 'automation-reminder',
      source: 'travel-confirmations',
      toolSlug: 'OUTLOOK_LIST_MESSAGES',
    })).toMatchObject({
      kind: 'member-maintenance-connected-apps',
      source: 'travel-confirmations',
    })

    expect(readMaintenanceRequest({
      action: 'patch_automation_instructions',
      instructions: '  Keep exact surrounding whitespace.  ',
      lookup: 'automation-reminder',
    })).toEqual({
      kind: 'member-maintenance-automation',
      request: {
        action: 'patch_maintenance_instructions',
        instructions: '  Keep exact surrounding whitespace.  ',
        lookup: 'automation-reminder',
      },
    })
  })

  it('rejects cross-source reads, writes, and broader automation changes', () => {
    for (const request of [
      {
        action: 'list_connected_accounts',
        lookup: 'automation-reminder',
        source: 'calendar',
        toolkit: 'gmail',
      },
      {
        action: 'search_connected_tools',
        lookup: 'automation-reminder',
        query: 'list calendar events',
        source: 'calendar',
        toolkits: ['googlecalendar', 'outlook'],
      },
      {
        account: 'calendar-account',
        action: 'execute_connected_read',
        arguments: {},
        lookup: 'automation-reminder',
        source: 'calendar',
        toolSlug: 'GMAIL_FETCH_EMAILS',
      },
      {
        account: 'calendar-account',
        action: 'execute_connected_read',
        arguments: {},
        lookup: 'automation-reminder',
        source: 'calendar',
        toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
      },
      {
        account: 'calendar-account',
        action: 'execute_connected_read',
        arguments: {},
        lookup: 'automation-reminder',
        source: 'calendar',
        toolSlug: 'GOOGLECALENDAR_DELETE_EVENT',
      },
      {
        account: 'outlook-account',
        action: 'execute_connected_read',
        arguments: {},
        lookup: 'automation-reminder',
        source: 'calendar',
        toolSlug: 'OUTLOOK_LIST_MESSAGES',
      },
      {
        account: 'outlook-account',
        action: 'execute_connected_read',
        arguments: {},
        lookup: 'automation-reminder',
        source: 'travel-confirmations',
        toolSlug: 'OUTLOOK_LIST_EVENTS',
      },
      {
        action: 'patch_automation_instructions',
        instructions: 'Availability conflict policy: skip-when-busy',
        lookup: 'automation-reminder',
        schedule: { kind: 'dailyLocal', localTime: '16:00' },
      },
    ]) {
      expect(readMaintenanceRequest(request)).toMatchObject({
        kind: 'invalid-member-maintenance-arguments',
      })
    }
  })

  it('fails execution closed without exact authority and rechecks the source owner', async () => {
    const request = readMaintenanceRequest({
      action: 'list_connected_accounts',
      lookup: 'automation-reminder',
      source: 'calendar',
      toolkit: 'googlecalendar',
    })
    if (request?.kind !== 'member-maintenance-connected-apps') {
      throw new Error('Expected parsed member maintenance request.')
    }
    const automationRequest = vi.fn<AssistantHostedAutomationTool['request']>(
      async (authorization) => {
        if (authorization.action !== 'authorize_maintenance_source') {
          throw new Error('Unexpected maintenance automation operation.')
        }
        return {
          action: authorization.action,
          automationId: 'automation-reminder',
          authorized: true,
          source: authorization.source,
        }
      },
    )
    const connectedRequest = vi.fn(async () => ({
      result: { accounts: [] },
    }))

    await expect(executeMemberMaintenanceDynamicTool({
      automationTool: { request: automationRequest },
      authorized: false,
      connectedApps: { request: connectedRequest },
      request,
    })).resolves.toMatchObject({
      rpcResult: { success: false },
    })
    expect(automationRequest).not.toHaveBeenCalled()
    expect(connectedRequest).not.toHaveBeenCalled()

    await expect(executeMemberMaintenanceDynamicTool({
      automationTool: { request: automationRequest },
      authorized: true,
      connectedApps: { request: connectedRequest },
      request,
    })).resolves.toMatchObject({
      rpcResult: { success: true },
    })
    expect(automationRequest).toHaveBeenCalledWith({
      action: 'authorize_maintenance_source',
      lookup: 'automation-reminder',
      source: 'calendar',
    }, {
      signal: null,
    })
    expect(connectedRequest).toHaveBeenCalledOnce()
  })

  it('keeps member maintenance memory-first and group maintenance isolated', () => {
    const memberPrompt =
      buildAssistantMaintenanceSystemPromptWithCacheMetadata({
        currentLocalDate: '2026-07-30',
        currentTimeZone: 'America/New_York',
        profile: 'member-memory',
      }).prompt
    const groupPrompt =
      buildAssistantMaintenanceSystemPromptWithCacheMetadata({
        currentLocalDate: '2026-07-30',
        currentTimeZone: 'America/New_York',
        profile: 'group-room-model',
      }).prompt

    expect(memberPrompt).toContain(
      'Complete the memory-consolidation phase before beginning reminder maintenance',
    )
    expect(memberPrompt).toContain('`vault-cli automation list`')
    expect(memberPrompt).toContain('`murph.maintenance`')
    expect(memberPrompt).toContain('Never save it into memory')
    expect(groupPrompt).not.toContain('`murph.maintenance`')
    expect(groupPrompt).not.toContain('`vault-cli automation list`')
  })

  it('teaches ordinary turns and the owning skill to repair mistimed support', async () => {
    const layers = buildAssistantSystemPromptLayers(createPromptInput())
    expect(layers.staticCacheableCorePrompt).toContain(
      'treat that first as feedback on the support loop',
    )
    expect(layers.staticCacheableCorePrompt).toContain(
      'resolve this occurrence without calling it a miss',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'Availability conflict policy: skip-when-busy',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'Availability source policy: calendar-and-travel-confirmations',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      '<!-- murph:availability-conflicts:start -->',
    )

    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'behavior-followthrough',
        'SKILL.md',
      ),
      'utf8',
    )
    expect(skill).toContain('### Repair a mistimed interruption')
    expect(skill).toContain(
      'Briefly own the mistiming before answering an adjacent literal question.',
    )
    expect(skill).toContain('A one-off conflict changes only this occurrence.')
    expect(skill).toContain(
      'Availability source policy: calendar-and-travel-confirmations',
    )
  })
})

function readMaintenanceRequest(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'maintenance',
      turnId: 'turn-active-root-1',
    },
  })
}

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantHostedAutomationAvailable: true,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedLabsAvailable: false,
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-07-30',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}

function collectJsonSchemaPropertyKeys(
  value: unknown,
  keys = new Set<string>(),
): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonSchemaPropertyKeys(item, keys)
    }
    return keys
  }
  if (!value || typeof value !== 'object') {
    return keys
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'properties' && child && typeof child === 'object') {
      for (const propertyKey of Object.keys(child)) {
        keys.add(propertyKey)
      }
    }
    collectJsonSchemaPropertyKeys(child, keys)
  }
  return keys
}

function collectPropertyStringEnums(
  value: unknown,
  propertyName: string,
  values = new Set<string>(),
): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPropertyStringEnums(item, propertyName, values)
    }
    return values
  }
  if (!value || typeof value !== 'object') {
    return values
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'properties' && child && typeof child === 'object') {
      const property = (child as Record<string, unknown>)[propertyName]
      if (property && typeof property === 'object') {
        const enumValues = (property as Record<string, unknown>).enum
        if (Array.isArray(enumValues)) {
          for (const enumValue of enumValues) {
            if (typeof enumValue === 'string') {
              values.add(enumValue)
            }
          }
        }
        const constant = (property as Record<string, unknown>).const
        if (typeof constant === 'string') {
          values.add(constant)
        }
      }
    }
    collectPropertyStringEnums(child, propertyName, values)
  }
  return values
}
