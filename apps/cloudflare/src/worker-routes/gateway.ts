import {
  gatewayChannelSupportsReplyToMessage,
  gatewayFetchAttachmentsInputSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayPollEventsInputSchema,
  gatewayReadMessagesInputSchema,
  gatewayRespondToPermissionInputSchema,
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  gatewayWaitForEventsInputSchema,
  readGatewayConversationSessionToken,
  readGatewayMessageKind,
  readGatewayMessageRouteToken,
  waitForGatewayEventsByPolling,
  type GatewaySendMessageInput,
} from "@murphai/gateway-core";
import { buildHostedExecutionGatewayMessageSendDispatch } from "@murphai/hosted-execution";

import { json, notFound } from "../json.ts";
import {
  decodeRouteParam,
  readCachedOptionalJsonObject,
  requireUserRunnerStubMethod,
  resolveUserRunnerStub,
  type UserRunnerDurableObjectStubLike,
  type WorkerRouteContext,
} from "./shared.ts";

export async function handleGatewayRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  resource: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  const stub = await resolveUserRunnerStub(context.env, userId);
  const payload = await readCachedOptionalJsonObject(context);

  switch (resource) {
    case "conversations/list":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayListConversations")(
          gatewayListConversationsInputSchema.parse(payload),
        ),
      );
    case "conversations/get":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayGetConversation")(
          gatewayGetConversationInputSchema.parse(payload),
        ),
      );
    case "messages/read":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayReadMessages")(
          gatewayReadMessagesInputSchema.parse(payload),
        ),
      );
    case "attachments/fetch":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayFetchAttachments")(
          gatewayFetchAttachmentsInputSchema.parse(payload),
        ),
      );
    case "events/poll":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayPollEvents")(
          gatewayPollEventsInputSchema.parse(payload),
        ),
      );
    case "events/wait":
      return json(
        await waitForGatewayEventsByPolling(
          requireUserRunnerStubMethod(stub, "gatewayPollEvents"),
          gatewayWaitForEventsInputSchema.parse(payload),
        ),
      );
    case "messages/send":
      return handleGatewaySendRoute(stub, userId, gatewaySendMessageInputSchema.parse(payload));
    case "permissions/list-open":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayListOpenPermissions")(
          gatewayListOpenPermissionsInputSchema.parse(payload),
        ),
      );
    case "permissions/respond":
      return json(
        await requireUserRunnerStubMethod(stub, "gatewayRespondToPermission")(
          gatewayRespondToPermissionInputSchema.parse(payload),
        ),
      );
    default:
      return notFound();
  }
}

async function handleGatewaySendRoute(
  stub: UserRunnerDurableObjectStubLike,
  userId: string,
  input: GatewaySendMessageInput,
): Promise<Response> {
  const conversation = await requireUserRunnerStubMethod(stub, "gatewayGetConversation")({
    sessionKey: input.sessionKey,
  });
  if (!conversation) {
    return json({ error: "Gateway session was not found." }, 404);
  }
  if (!conversation.canSend) {
    return json({ error: "Gateway session does not have a routable reply target." }, 409);
  }

  const replyToValidation = validateHostedGatewayReplyTo({
    channel: conversation.route.channel,
    replyToMessageId: input.replyToMessageId ?? null,
    sessionKey: input.sessionKey,
  });
  if (replyToValidation) {
    return replyToValidation;
  }

  const dispatch = buildHostedExecutionGatewayMessageSendDispatch({
    clientRequestId: input.clientRequestId,
    eventId: `gateway-send:${crypto.randomUUID()}`,
    occurredAt: new Date().toISOString(),
    replyToMessageId: input.replyToMessageId,
    sessionKey: input.sessionKey,
    text: input.text,
    userId,
  });
  const result = await stub.dispatchWithOutcome(dispatch);

  if (result.event.state === "backpressured") {
    return json({ error: "Hosted runner is backpressured." }, 429);
  }
  if (result.event.state === "poisoned") {
    return json({ error: result.event.lastError ?? "Hosted runner failed." }, 500);
  }

  return json(
    gatewaySendMessageResultSchema.parse({
      delivery: null,
      messageId: null,
      queued: true,
      sessionKey: input.sessionKey,
    }),
  );
}

function validateHostedGatewayReplyTo(input: {
  channel: string | null;
  replyToMessageId: string | null;
  sessionKey: string;
}): Response | null {
  if (!input.replyToMessageId) {
    return null;
  }
  if (!gatewayChannelSupportsReplyToMessage(input.channel)) {
    return json({ error: "Gateway reply-to is not supported for this channel." }, 409);
  }
  try {
    const sessionToken = readGatewayConversationSessionToken(input.sessionKey);
    const messageKind = readGatewayMessageKind(input.replyToMessageId);
    const messageRouteToken = readGatewayMessageRouteToken(input.replyToMessageId);
    if (sessionToken !== messageRouteToken) {
      return json({ error: "Gateway reply-to did not belong to the requested session." }, 400);
    }
    if (messageKind !== "capture-message" && messageKind !== "outbox-message") {
      return json({ error: "Gateway reply-to must reference a channel message." }, 400);
    }
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Gateway reply-to is invalid.",
    }, 400);
  }
  return null;
}
