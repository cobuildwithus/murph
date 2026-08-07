import { describe, expect, it, vi } from 'vitest'

import {
  executeConnectedAppsDynamicTool,
  MURPH_CONNECTED_APPS_EXECUTE_TOOL,
  readConnectedAppsDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/connected-apps.ts'
import type { AssistantConnectedAppsPort } from '../src/assistant/connected-apps-port.ts'

describe('connected-app email-send dynamic behavior', () => {
  it('advertises email sends as non-retryable writes', () => {
    expect(MURPH_CONNECTED_APPS_EXECUTE_TOOL.description.length)
      .toBeLessThanOrEqual(330)
    expect(MURPH_CONNECTED_APPS_EXECUTE_TOOL.description).toContain(
      'failed or ambiguous calendar create is non-retryable',
    )
    expect(MURPH_CONNECTED_APPS_EXECUTE_TOOL.description).toContain(
      'email sends are too',
    )
  })

  it('preserves explicit approval for a Gmail send', () => {
    const request = readConnectedAppsDynamicToolRequest({
      arguments: {
        account: 'work',
        agentApproved: true,
        arguments: {
          body: 'Please help with my account.',
          recipient_email: 'support@example.com',
          subject: 'Account help',
        },
        toolSlug: 'GMAIL_SEND_EMAIL',
      },
      tool: 'connected_apps_execute',
    })

    expect(request).toMatchObject({
      args: {
        account: 'work',
        agentApproved: true,
        toolSlug: 'GMAIL_SEND_EMAIL',
      },
      kind: 'connected-apps-execute',
    })
  })

  it('rejects email sends without current private user authority', async () => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => ({ result: { messageId: 'unexpected' } })),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: false,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: {
            body: 'Please help with my account.',
            recipient_email: 'support@example.com',
            subject: 'Account help',
          },
          toolSlug: 'GMAIL_SEND_EMAIL',
        },
        kind: 'connected-apps-execute',
      },
    })

    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]!.text).toContain(
      'requires current user input in a private conversation',
    )
    expect(connectedApps.request).not.toHaveBeenCalled()
  })

  it.each([
    {
      argumentsValue: {
        body: 'Please help with my account.',
        recipient_email: 'support@example.com',
        subject: 'Account help',
      },
      toolSlug: 'GMAIL_SEND_EMAIL',
    },
    {
      argumentsValue: {
        body: 'Please help with my account.',
        subject: 'Account help',
        to_email: 'support@example.com',
      },
      toolSlug: 'OUTLOOK_SEND_EMAIL',
    },
  ])('treats $toolSlug provider failures as ambiguous without retry', async ({
    argumentsValue,
    toolSlug,
  }) => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => {
        throw Object.assign(new Error('Hosted connected apps failed.'), {
          code: 'CONNECTED_APPS_PROVIDER_UNAVAILABLE',
          detail: 'The connected-app request could not be completed.',
          retryable: false,
          status: 400,
        })
      }),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: true,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: argumentsValue,
          toolSlug,
        },
        kind: 'connected-apps-execute',
      },
    })

    expect(connectedApps.request).toHaveBeenCalledTimes(1)
    expect(result.rpcResult.success).toBe(false)
    const text = result.rpcResult.contentItems[0]!.text
    expect(text).toContain('email sending failed or returned an ambiguous result')
    expect(text).toContain('Do not retry the email-send call')
    expect(text).toContain("Search the selected account's Sent mail")
    expect(text).toContain('narrow window at or after this attempt')
    expect(text).toContain('substantive body')
    expect(text).toContain('Older, duplicate, or partial matches')
    expect(text).not.toContain('Search the selected calendar')
    expect(text).not.toContain('one retry is reasonable')
  })

  it.each([
    {
      code: 'CONNECTED_APPS_AGENT_APPROVAL_REQUIRED',
      detail: 'Approve the email before sending it.',
      toolSlug: 'GMAIL_SEND_EMAIL',
    },
    {
      code: 'CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED',
      detail: 'That email action includes unsupported options.',
      toolSlug: 'OUTLOOK_SEND_EMAIL',
    },
    {
      code: 'CONNECTED_APPS_WRITE_ARGUMENT_REQUIRED',
      detail: 'That email action is missing required fields.',
      toolSlug: 'GMAIL_SEND_EMAIL',
    },
    {
      code: 'CONNECTED_APPS_ACCOUNT_NOT_FOUND',
      detail: 'That connected account was not found for this Murph member.',
      toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
    },
    {
      code: 'CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED',
      detail: 'Personal connected apps are unavailable in a group chat.',
      toolSlug: 'GMAIL_SEND_EMAIL',
    },
    {
      code: 'CONNECTED_APPS_REQUEST_INVALID',
      detail: 'The connected-app request is invalid.',
      toolSlug: 'OUTLOOK_SEND_EMAIL',
    },
  ])('surfaces deterministic $code failures without an ambiguity detour', async ({
    code,
    detail,
    toolSlug,
  }) => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => {
        throw Object.assign(new Error('Hosted connected apps rejected the request.'), {
          code,
          detail,
          retryable: false,
          status: 400,
        })
      }),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: true,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: {},
          toolSlug,
        },
        kind: 'connected-apps-execute',
      },
    })

    const text = result.rpcResult.contentItems[0]!.text
    expect(text).toContain(code)
    expect(text).toContain(detail)
    expect(text).toContain('will fail the same way')
    expect(text).not.toContain('ambiguous result')
    expect(text).not.toContain('Sent mail')
    expect(text).not.toContain('selected calendar')
  })

  it('treats unknown structured write failures as ambiguous even when retryable', async () => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => {
        throw Object.assign(new Error('Hosted connected apps timed out.'), {
          code: 'HOSTED_RUNTIME_CONTROL_PLANE_TIMEOUT',
          detail: 'The control-plane response was not observed.',
          retryable: true,
          status: 503,
        })
      }),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: true,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: {
            body: 'Please help with my account.',
            recipient_email: 'support@example.com',
            subject: 'Account help',
          },
          toolSlug: 'GMAIL_SEND_EMAIL',
        },
        kind: 'connected-apps-execute',
      },
    })

    const text = result.rpcResult.contentItems[0]!.text
    expect(text).toContain('email sending failed or returned an ambiguous result')
    expect(text).toContain('Do not retry the email-send call')
    expect(text).toContain("Search the selected account's Sent mail")
    expect(text).not.toContain('one retry is reasonable')
    expect(text).not.toContain('HOSTED_RUNTIME_CONTROL_PLANE_TIMEOUT')
  })

  it('allows one retry for an account lookup outage without a Sent-mail detour', async () => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => {
        throw Object.assign(new Error('Hosted connected apps failed.'), {
          code: 'CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE',
          detail: 'Connected account verification is temporarily unavailable.',
          retryable: true,
          status: 503,
        })
      }),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: true,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: {
            body: 'Please help with my account.',
            recipient_email: 'support@example.com',
            subject: 'Account help',
          },
          toolSlug: 'GMAIL_SEND_EMAIL',
        },
        kind: 'connected-apps-execute',
      },
    })

    const text = result.rpcResult.contentItems[0]!.text
    expect(text).toContain('CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE')
    expect(text).toContain('one retry is reasonable')
    expect(text).not.toContain('ambiguous result')
    expect(text).not.toContain('Sent mail')
  })

  it('keeps an oversized successful write result non-retryable', async () => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => ({
        result: { body: 'x'.repeat(130_000) },
      })),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: true,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: {
            body: 'Please help with my account.',
            recipient_email: 'support@example.com',
            subject: 'Account help',
          },
          toolSlug: 'GMAIL_SEND_EMAIL',
        },
        kind: 'connected-apps-execute',
      },
    })

    const text = result.rpcResult.contentItems[0]!.text
    expect(text).toContain('email sending failed or returned an ambiguous result')
    expect(text).toContain('Do not retry')
    expect(text).toContain('Sent mail')
    expect(text).not.toContain('narrow the query')
  })

  it('keeps an unstructured email-send transport failure non-retryable', async () => {
    const connectedApps: AssistantConnectedAppsPort = {
      request: vi.fn(async () => {
        throw new Error('connection closed after request dispatch')
      }),
    }

    const result = await executeConnectedAppsDynamicTool({
      connectedApps,
      emailSendAuthorized: true,
      request: {
        args: {
          account: 'work',
          agentApproved: true,
          arguments: {
            body: 'Please help with my account.',
            recipient_email: 'support@example.com',
            subject: 'Account help',
          },
          toolSlug: 'GMAIL_SEND_EMAIL',
        },
        kind: 'connected-apps-execute',
      },
    })

    const text = result.rpcResult.contentItems[0]!.text
    expect(text).toContain('email sending failed or returned an ambiguous result')
    expect(text).toContain('Do not retry')
    expect(text).not.toContain('connection closed')
  })
})
