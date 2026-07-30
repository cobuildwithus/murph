import { z } from 'zod'

import {
  hostedConnectedAppsAccountSelectorSchema,
  hostedConnectedAppsToolSlugSchema,
} from '@murphai/hosted-execution/connected-apps'

import type {
  AssistantHostedAutomationTool,
} from '../../assistant/execution-context.js'
import type {
  AssistantConnectedAppsPort,
} from '../../assistant/connected-apps-port.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  executeConnectedAppsDynamicTool,
  type ConnectedAppsDynamicToolRequest,
} from './connected-apps.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const maintenanceAutomationLookupSchema = z.string().trim().min(1).max(191)
const maintenanceAutomationInstructionsSchema = z.string().min(1).max(50_000)
const maintenanceSourceSchema = z.enum([
  'calendar',
  'travel-confirmations',
])
const maintenanceToolkitSchema = z.enum([
  'gmail',
  'googlecalendar',
  'outlook',
])
const MAINTENANCE_CALENDAR_READ_TOOL_SLUGS = new Set([
  'GOOGLECALENDAR_EVENTS_LIST',
  'GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS',
  'GOOGLECALENDAR_LIST_EVENTS',
  'OUTLOOK_GET_CALENDAR_VIEW',
  'OUTLOOK_LIST_EVENTS',
  'OUTLOOK_LIST_USER_CALENDARS_EVENTS',
  'OUTLOOK_LIST_USER_CALENDAR_VIEW',
  'OUTLOOK_OUTLOOK_LIST_EVENTS',
])
const MAINTENANCE_TRAVEL_CONFIRMATION_READ_TOOL_SLUGS = new Set([
  'GMAIL_FETCH_EMAILS',
  'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
  'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
  'OUTLOOK_GET_MESSAGE',
  'OUTLOOK_LIST_MESSAGES',
  'OUTLOOK_OUTLOOK_LIST_MESSAGES',
])
const maintenanceConnectedArgumentsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list_connected_accounts'),
    lookup: maintenanceAutomationLookupSchema,
    source: maintenanceSourceSchema,
    toolkit: maintenanceToolkitSchema,
  }).strict(),
  z.object({
    action: z.literal('search_connected_tools'),
    lookup: maintenanceAutomationLookupSchema,
    query: z.string().trim().min(1).max(2_000),
    source: maintenanceSourceSchema,
    toolkits: z.array(maintenanceToolkitSchema).length(1),
  }).strict(),
  z.object({
    account: hostedConnectedAppsAccountSelectorSchema,
    action: z.literal('execute_connected_read'),
    arguments: z.record(z.string(), z.unknown()).default({}),
    lookup: maintenanceAutomationLookupSchema,
    source: maintenanceSourceSchema,
    toolSlug: hostedConnectedAppsToolSlugSchema,
  }).strict(),
])
const memberMaintenanceArgumentsSchema = z.union([
  maintenanceConnectedArgumentsSchema,
  z.object({
    action: z.literal('patch_automation_instructions'),
    instructions: maintenanceAutomationInstructionsSchema,
    lookup: maintenanceAutomationLookupSchema,
  }).strict(),
]).superRefine((value, context) => {
  if (value.action === 'patch_automation_instructions') {
    return
  }
  if (value.action === 'list_connected_accounts') {
    if (!isMaintenanceSourceToolkit(value.source, value.toolkit)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Toolkit does not match the authorized maintenance source.',
        path: ['toolkit'],
      })
    }
    return
  }
  if (value.action === 'search_connected_tools') {
    for (const [index, toolkit] of value.toolkits.entries()) {
      if (!isMaintenanceSourceToolkit(value.source, toolkit)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Toolkit does not match the authorized maintenance source.',
          path: ['toolkits', index],
        })
      }
    }
    return
  }
  if (!isMaintenanceSourceToolSlug(value.source, value.toolSlug)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tool slug does not match the authorized maintenance source.',
      path: ['toolSlug'],
    })
  }
})

export const MURPH_MEMBER_MAINTENANCE_TOOL = {
  namespace: 'murph',
  name: 'maintenance',
  description:
    'Exact-managed-automation-only tool for silent overnight member maintenance. It can list one calendar or travel-confirmation account type, search that source for read-only tools, execute one exact read, or replace only an eligible automation’s instructions. Every connected read is bound to the eligible automation that authorizes its source. It cannot connect, rename, or disconnect accounts; create automations; execute writes; or change schedules, status, routes, titles, tags, support ownership, or lifecycle fields.',
  inputSchema: z.toJSONSchema(memberMaintenanceArgumentsSchema, { io: 'input' }),
} as const

type MaintenanceConnectedRequest = Exclude<
  ConnectedAppsDynamicToolRequest,
  { kind: 'invalid-connected-apps-arguments' }
>

export type MemberMaintenanceDynamicToolRequest =
  | {
      kind: 'member-maintenance-connected-apps'
      lookup: string
      request: MaintenanceConnectedRequest
      source: 'calendar' | 'travel-confirmations'
    }
  | {
      kind: 'member-maintenance-automation'
      request: {
        action: 'patch_maintenance_instructions'
        instructions: string
        lookup: string
      }
    }
  | {
      kind: 'invalid-member-maintenance-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readMemberMaintenanceDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): MemberMaintenanceDynamicToolRequest | null {
  if (input.tool !== MURPH_MEMBER_MAINTENANCE_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: memberMaintenanceArgumentsSchema,
    schemaRootKeys: [
      'account',
      'action',
      'arguments',
      'instructions',
      'lookup',
      'query',
      'source',
      'toolkit',
      'toolkits',
      'toolSlug',
    ],
    toolName: 'murph.maintenance',
    value: input.arguments,
  })
  if (!parsed.ok) {
    return {
      kind: 'invalid-member-maintenance-arguments',
      validationDigest: parsed.validationDigest,
    }
  }

  switch (parsed.args.action) {
    case 'list_connected_accounts':
      return {
        kind: 'member-maintenance-connected-apps',
        lookup: parsed.args.lookup,
        request: {
          args: {
            action: 'list',
            toolkit: parsed.args.toolkit,
          },
          kind: 'connected-apps-manage',
        },
        source: parsed.args.source,
      }
    case 'search_connected_tools':
      return {
        kind: 'member-maintenance-connected-apps',
        lookup: parsed.args.lookup,
        request: {
          args: {
            query: parsed.args.query,
            toolkits: parsed.args.toolkits,
          },
          kind: 'connected-apps-search',
        },
        source: parsed.args.source,
      }
    case 'execute_connected_read':
      return {
        kind: 'member-maintenance-connected-apps',
        lookup: parsed.args.lookup,
        request: {
          args: {
            account: parsed.args.account,
            arguments: parsed.args.arguments,
            toolSlug: parsed.args.toolSlug,
          },
          kind: 'connected-apps-execute',
        },
        source: parsed.args.source,
      }
    case 'patch_automation_instructions':
      return {
        kind: 'member-maintenance-automation',
        request: {
          action: 'patch_maintenance_instructions',
          instructions: parsed.args.instructions,
          lookup: parsed.args.lookup,
        },
      }
  }
}

export async function executeMemberMaintenanceDynamicTool(input: {
  abortSignal?: AbortSignal | null
  automationTool: AssistantHostedAutomationTool | null
  authorized: boolean
  connectedApps: AssistantConnectedAppsPort | null
  request: Exclude<
    MemberMaintenanceDynamicToolRequest,
    { kind: 'invalid-member-maintenance-arguments' }
  >
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.authorized) {
    return maintenanceTextResult(
      false,
      'member maintenance is unavailable outside its exact managed automation',
    )
  }
  if (!input.automationTool) {
    return maintenanceTextResult(
      false,
      'member maintenance automation access is unavailable for this turn',
    )
  }

  try {
    if (input.request.kind === 'member-maintenance-automation') {
      const response = await input.automationTool.request(
        input.request.request,
        { signal: input.abortSignal ?? null },
      )
      if (response.action !== 'patch_maintenance_instructions') {
        return maintenanceTextResult(
          false,
          'member maintenance returned an unexpected result',
        )
      }
      return maintenanceTextResult(true, JSON.stringify({
        action: response.action,
        automationId: response.automationId,
        changed: response.changed,
        lookupId: response.lookupId,
        status: response.status,
      }))
    }

    if (!input.connectedApps) {
      return maintenanceTextResult(
        false,
        'connected apps are unavailable without hosted connected-app transport',
      )
    }
    const authorization = await input.automationTool.request({
      action: 'authorize_maintenance_source',
      lookup: input.request.lookup,
      source: input.request.source,
    }, {
      signal: input.abortSignal ?? null,
    })
    if (
      authorization.action !== 'authorize_maintenance_source'
      || authorization.authorized !== true
      || authorization.source !== input.request.source
    ) {
      return maintenanceTextResult(
        false,
        'the automation did not authorize that maintenance source',
      )
    }
    return await executeConnectedAppsDynamicTool({
      abortSignal: input.abortSignal ?? null,
      connectedApps: input.connectedApps,
      request: input.request.request,
    })
  } catch {
    return maintenanceTextResult(false, 'member maintenance operation is unavailable')
  }
}

function isMaintenanceSourceToolkit(
  source: 'calendar' | 'travel-confirmations',
  toolkit: 'gmail' | 'googlecalendar' | 'outlook',
): boolean {
  return source === 'calendar'
    ? toolkit === 'googlecalendar' || toolkit === 'outlook'
    : toolkit === 'gmail' || toolkit === 'outlook'
}

function isMaintenanceSourceToolSlug(
  source: 'calendar' | 'travel-confirmations',
  toolSlug: string,
): boolean {
  const normalized = toolSlug.toUpperCase()
  return source === 'calendar'
    ? MAINTENANCE_CALENDAR_READ_TOOL_SLUGS.has(normalized)
    : MAINTENANCE_TRAVEL_CONFIRMATION_READ_TOOL_SLUGS.has(normalized)
}

function maintenanceTextResult(success: boolean, text: string) {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' as const }],
      success,
    },
  }
}
