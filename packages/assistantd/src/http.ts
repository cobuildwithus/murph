import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { URL } from 'node:url'
import {
  assertListenerPort,
  assertLoopbackListenerHost,
  getLoopbackControlRequestRejectionReason,
} from '@murphai/runtime-state'
import { hasMatchingLoopbackControlBearerToken } from '@murphai/runtime-state/node'
import {
  type AssistantGatewayRequest,
  AssistantHttpRequestError,
  assertAssistantBoundVault,
  buildAssistantHttpErrorPayload,
  parseAssistantAutomationRunRequestBody,
  parseAssistantCronJobRoute,
  parseAssistantCronProcessRequestBody,
  parseAssistantCronRunsQuery,
  parseAssistantCronTargetRoute,
  parseAssistantCronTargetSetRequestBody,
  parseAssistantMessageRequestBody,
  parseAssistantOutboxDrainRequestBody,
  parseAssistantOutboxRoute,
  parseAssistantSessionOptionsRequestBody,
  parseAssistantSessionRoute,
  parseAssistantStatusQuery,
  parseAssistantVaultQuery,
  parseGatewayFetchAttachmentsRequestBody,
  parseGatewayGetConversationRequestBody,
  parseGatewayListConversationsRequestBody,
  parseGatewayListOpenPermissionsRequestBody,
  parseGatewayPollEventsRequestBody,
  parseGatewayReadMessagesRequestBody,
  parseGatewayRespondToPermissionRequestBody,
  parseGatewaySendMessageRequestBody,
  parseGatewayWaitForEventsRequestBody,
  parseOpenConversationRequestBody,
  resolveAssistantHttpErrorStatus,
} from './http-protocol.js'
import type { AssistantLocalService } from './service.js'

const MAX_ASSISTANT_HTTP_BODY_BYTES = 256 * 1024

export interface CreateAssistantHttpServerInput {
  controlToken: string
  host: string
  port: number
  service: AssistantLocalService
}

export interface AssistantHttpServerHandle {
  address: {
    baseUrl: string
    host: string
    port: number
  }
  close(): Promise<void>
  server: Server
}

export type AssistantHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>

export async function startAssistantHttpServer(
  input: CreateAssistantHttpServerInput,
): Promise<AssistantHttpServerHandle> {
  assertLoopbackListenerHost(
    input.host,
    'Assistant daemon listener host must be a loopback hostname or address.',
  )
  assertListenerPort(
    input.port,
    'Assistant daemon listener port must be an integer between 0 and 65535.',
    { allowZero: true },
  )

  const server = createServer(createAssistantHttpRequestHandler(input))
  const address = await listenAssistantServer(server, input.host, input.port)

  return {
    address: {
      baseUrl: buildAssistantServerBaseUrl(address),
      host: address.address,
      port: address.port,
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
    server,
  }
}

export function createAssistantHttpRequestHandler(
  input: CreateAssistantHttpServerInput,
): AssistantHttpRequestHandler {
  return async (request, response) => {
    await handleAssistantRequest(request, response, input)
  }
}

async function handleAssistantRequest(
  request: IncomingMessage,
  response: ServerResponse,
  input: CreateAssistantHttpServerInput,
): Promise<void> {
  try {
    assertAssistantControlRequest({
      headers: request.headers,
      remoteAddress: request.socket.remoteAddress,
      controlToken: input.controlToken,
    })

    const method = request.method?.toUpperCase() ?? 'GET'
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, await input.service.health())
      return
    }
    if (method === 'POST' && url.pathname === '/open-conversation') {
      const body = parseOpenConversationRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.openConversation(body))
      return
    }
    if (method === 'POST' && url.pathname === '/message') {
      const body = parseAssistantMessageRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.sendMessage(body))
      return
    }
    if (method === 'POST' && url.pathname === '/session-options') {
      const body = parseAssistantSessionOptionsRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.updateSessionOptions(body))
      return
    }
    if (method === 'GET' && url.pathname === '/status') {
      sendJson(response, 200, await input.service.getStatus(parseAssistantStatusQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/sessions') {
      sendJson(response, 200, await input.service.listSessions(parseAssistantVaultQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname.startsWith('/sessions/')) {
      sendJson(response, 200, await input.service.getSession(parseAssistantSessionRoute(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/outbox') {
      sendJson(response, 200, await input.service.listOutbox(parseAssistantVaultQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname.startsWith('/outbox/')) {
      sendJson(response, 200, await input.service.getOutboxIntent(parseAssistantOutboxRoute(url)))
      return
    }
    if (method === 'POST' && url.pathname === '/outbox/drain') {
      const body = parseAssistantOutboxDrainRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.drainOutbox(body))
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/conversations/list') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayListConversationsRequestBody,
        (gatewayInput) => input.service.gateway.listConversations(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/conversations/get') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayGetConversationRequestBody,
        (gatewayInput) => input.service.gateway.getConversation(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/messages/read') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayReadMessagesRequestBody,
        (gatewayInput) => input.service.gateway.readMessages(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/attachments/fetch') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayFetchAttachmentsRequestBody,
        (gatewayInput) => input.service.gateway.fetchAttachments(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/messages/send') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewaySendMessageRequestBody,
        (gatewayInput) => input.service.gateway.sendMessage(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/events/poll') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayPollEventsRequestBody,
        (gatewayInput) => input.service.gateway.pollEvents(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/events/wait') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayWaitForEventsRequestBody,
        (gatewayInput) => input.service.gateway.waitForEvents(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/permissions/list-open') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayListOpenPermissionsRequestBody,
        (gatewayInput) => input.service.gateway.listOpenPermissions(gatewayInput),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/gateway/permissions/respond') {
      await forwardBoundGatewayRequest(
        request,
        response,
        input,
        parseGatewayRespondToPermissionRequestBody,
        (gatewayInput) => input.service.gateway.respondToPermission(gatewayInput),
      )
      return
    }
    if (method === 'GET' && url.pathname === '/cron/status') {
      sendJson(response, 200, await input.service.getCronStatus(parseAssistantVaultQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/cron/jobs') {
      sendJson(response, 200, await input.service.listCronJobs(parseAssistantVaultQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname.startsWith('/cron/jobs/') && url.pathname.endsWith('/target')) {
      sendJson(response, 200, await input.service.getCronTarget(parseAssistantCronTargetRoute(url)))
      return
    }
    if (method === 'GET' && url.pathname.startsWith('/cron/jobs/')) {
      sendJson(response, 200, await input.service.getCronJob(parseAssistantCronJobRoute(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/cron/runs') {
      sendJson(response, 200, await input.service.listCronRuns(parseAssistantCronRunsQuery(url)))
      return
    }
    if (method === 'POST' && url.pathname === '/automation/run-once') {
      const body = parseAssistantAutomationRunRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.runAutomationOnce(body))
      return
    }
    if (method === 'POST' && url.pathname === '/cron/process-due') {
      const body = parseAssistantCronProcessRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.processDueCron(body))
      return
    }
    if (method === 'POST' && url.pathname.startsWith('/cron/jobs/') && url.pathname.endsWith('/target')) {
      const body = parseAssistantCronTargetSetRequestBody(
        url,
        await readJsonBody(request),
      )
      sendJson(response, 200, await input.service.setCronTarget(body))
      return
    }

    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const statusCode = resolveAssistantHttpErrorStatus(error)
    sendJson(response, statusCode, buildAssistantHttpErrorPayload(error, statusCode))
  }
}

async function forwardBoundGatewayRequest<TInput extends object>(
  request: IncomingMessage,
  response: ServerResponse,
  input: CreateAssistantHttpServerInput,
  parseBody: (payload: unknown) => AssistantGatewayRequest<TInput>,
  callGateway: (gatewayInput: TInput) => Promise<unknown> | unknown,
): Promise<void> {
  const body = parseBody(await readJsonBody(request))
  assertAssistantBoundVault(body.vault, input.service.vault)
  sendJson(response, 200, await callGateway(body.gatewayInput))
}

export function assertAssistantControlRequest(input: {
  headers: IncomingHttpHeaders
  remoteAddress: string | null | undefined
  controlToken: string
}): void {
  const rejectionReason = getLoopbackControlRequestRejectionReason({
    headers: input.headers,
    remoteAddress: input.remoteAddress,
  })

  if (rejectionReason === 'loopback-remote-address-required') {
    throw new AssistantHttpRequestError('Forbidden.', 403)
  }

  if (rejectionReason === 'forwarded-headers-rejected') {
    throw new AssistantHttpRequestError(
      'Forbidden.',
      403,
      'ASSISTANT_CONTROL_PROXY_HEADERS_REJECTED',
    )
  }

  if (rejectionReason === 'loopback-host-required') {
    throw new AssistantHttpRequestError(
      'Forbidden.',
      403,
      'ASSISTANT_CONTROL_LOOPBACK_HOST_REQUIRED',
    )
  }

  if (
    !hasMatchingLoopbackControlBearerToken(input.headers.authorization, input.controlToken)
  ) {
    throw new AssistantHttpRequestError('Unauthorized.', 401)
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > MAX_ASSISTANT_HTTP_BODY_BYTES) {
      throw new AssistantHttpRequestError('Assistant daemon request body was too large.', 413)
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw.length === 0 ? {} : JSON.parse(raw)
}

function buildAssistantServerBaseUrl(address: AddressInfo): string {
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return `http://${host}:${address.port}`
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

async function listenAssistantServer(
  server: Server,
  host: string,
  port: number,
): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('assistantd did not expose a TCP listener address.')
  }
  return address
}
