import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS,
  type HostedRuntimeGroupToolLinqThreadContext,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeUsageReferralSourceContext,
} from "@murphai/hosted-execution/runtime-control";
import {
  type AssistantCurrentDeliveryRoute,
  normalizeAssistantRouteString,
} from "@murphai/operator-config/assistant/current-delivery-route";

import type { HostedAssistantEmailDeliveryContext } from "./email-delivery-context.ts";
import type { HostedAssistantLinqDeliveryContext } from "./linq-delivery-context.ts";
import type { HostedRuntimePlatform } from "./platform.ts";

export type HostedUsageReferralLinqService = "imessage" | "rcs" | "sms";

/**
 * The chat-scoped murph.group actions need the raw Linq chat id and the
 * thread-route egress authority, which live only in wake-derived delivery
 * contexts (the web DB stores hashed lookup keys). Inject them here so the
 * model never supplies its own thread target.
 *
 * Aggregate current-turn sender handles used by shared reads are injected the
 * same way. Participant-specific effects arrive with exact accepted-message
 * evidence already resolved by assistant-engine, so this wrapper does not
 * infer one owner from the whole turn.
 */
export function createHostedGroupToolWithCurrentTurnContext(input: {
  currentDeliveryRoute?: AssistantCurrentDeliveryRoute | null;
  emailDeliveryContexts?: readonly HostedAssistantEmailDeliveryContext[] | null;
  groupEmailIngress?: boolean;
  groupToolPort: NonNullable<HostedRuntimePlatform["groupToolPort"]>;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  linqService?: HostedUsageReferralLinqService | null;
  telegramSenderHandles?: readonly string[];
}): NonNullable<HostedRuntimePlatform["groupToolPort"]> {
  const emailIngressPresent = input.groupEmailIngress === true
    || (input.emailDeliveryContexts?.length ?? 0) > 0;
  return {
    directAttachmentRouteStatus() {
      const linqRoute = resolveHostedDirectToolLinqRouteContext(
        input.linqDeliveryContexts,
      );
      if (linqRoute?.service === "imessage") {
        return { status: "ok" };
      }
      return {
        status: "unavailable",
        unavailableReason: linqRoute?.service === "sms"
          ? "sms_attachments_unsupported"
          : "direct_attachment_route_unavailable",
      };
    },
    async request(request, context) {
      const forwardRequest = (forwardedRequest: HostedRuntimeGroupToolRequest) =>
        context
          ? input.groupToolPort.request(forwardedRequest, context)
          : input.groupToolPort.request(forwardedRequest);
      if (
        emailIngressPresent
        && request.action !== "read_current"
        && request.action !== "read_usage"
        && request.action !== "read_shared"
      ) {
        return buildHostedGroupEmailRestrictedActionUnavailable(request);
      }
      if (request.action === "read_shared") {
        const sharedReadRequest = {
          action: request.action,
          projectionScopes: request.projectionScopes,
        };
        // Hosted email reply aliases authenticate a route, not the human From
        // header, so email ingress never carries sender evidence.
        const senderHandles = emailIngressPresent
          ? {}
          : resolveHostedGroupToolSenderHandles({
              linqDeliveryContexts: input.linqDeliveryContexts,
              telegramSenderHandles: input.telegramSenderHandles ?? [],
            });
        return await forwardRequest({
          ...sharedReadRequest,
          ...senderHandles,
        });
      }
      if (
        request.action === "read_usage_referral"
        || request.action === "arm_usage_referral"
        || request.action === "cancel_usage_referral"
      ) {
        const participant = request.action === "read_usage_referral"
          ? request.participant
          : null;
        const senderHandles = emailIngressPresent
          ? {}
          : participant?.source === "linq"
          ? { linqSenderHandles: [participant.senderHandle] }
          : participant?.source === "telegram"
          ? { telegramSenderHandles: [participant.senderHandle] }
          : resolveHostedGroupToolSenderHandles({
              linqDeliveryContexts: input.linqDeliveryContexts,
              telegramSenderHandles: input.telegramSenderHandles ?? [],
            });
        const sourceContext = resolveHostedUsageReferralSourceContext(
          input.currentDeliveryRoute,
          input.linqService,
        );
        const referralRequest = request.action === "read_usage_referral"
          ? { action: request.action }
          : request.action === "arm_usage_referral"
            ? {
              action: request.action,
              policyCodes: request.policyCodes,
            }
            : {
              action: request.action,
              policyCode: request.policyCode,
            };
        return await forwardRequest({
          ...referralRequest,
          ...senderHandles,
          ...(request.action !== "cancel_usage_referral"
            ? sourceContext
            : {}),
        });
      }
      if (
        request.action === "read_chat_participants"
      ) {
        const linqRoute = resolveHostedGroupToolLinqRouteContext(
          input.linqDeliveryContexts,
        );
        return await forwardRequest(
          linqRoute
            ? { ...request, linqThread: linqRoute.thread }
            : request,
        );
      }
      if (request.action === "post_join_offer") {
        const linqRoute = resolveHostedGroupToolLinqRouteContext(
          input.linqDeliveryContexts,
        );
        if (linqRoute?.service === "imessage") {
          return await forwardRequest({
            ...request,
            linqThread: linqRoute.thread,
          });
        }
        if (
          linqRoute?.service === "sms"
          || isHostedGroupToolTelegramGroupRoute(input.currentDeliveryRoute)
        ) {
          return await forwardRequest(
            buildHostedGroupJoinLinkFallbackRequest(request),
          );
        }
        return await forwardRequest(request);
      }
      if (
        request.action === "share_contact_card"
        && request.contactCardImageUrl !== undefined
      ) {
        const linqRoute = resolveHostedDirectToolLinqRouteContext(
          input.linqDeliveryContexts,
        );
        if (linqRoute?.service === "imessage") {
          return await forwardRequest({
            ...request,
            directLinqChatId: linqRoute.chatId,
          });
        }
        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : {
            action: "share_contact_card",
            result: {
              status: "unavailable",
              unavailableReason: "direct_attachment_route_unavailable",
            },
          };
      }
      if (
        request.action !== "update_display_name"
        && request.action !== "post_disclosure_request"
        && request.action !== "preflight_set_chat_avatar"
        && request.action !== "set_chat_avatar"
        && request.action !== "share_contact_card"
      ) {
        return await forwardRequest(request);
      }
      const linqRoute = resolveHostedGroupToolLinqRouteContext(
        input.linqDeliveryContexts,
      );
      if (linqRoute?.service === "imessage") {
        return await forwardRequest({
          ...request,
          linqThread: linqRoute.thread,
        });
      }
      return linqRoute?.service === "sms"
        ? buildHostedGroupSmsUnsupportedResponse(request)
        : await forwardRequest(request);
    },
  };
}

function isHostedGroupToolTelegramGroupRoute(
  route: AssistantCurrentDeliveryRoute | null | undefined,
): boolean {
  return normalizeAssistantRouteString(route?.channel)?.toLowerCase()
      === "telegram"
    && route?.threadIsDirect === false;
}

function buildHostedGroupJoinLinkFallbackRequest(
  request: Extract<HostedRuntimeGroupToolRequest, { action: "post_join_offer" }>,
): Extract<HostedRuntimeGroupToolRequest, { action: "create_join_link" }> {
  const joinOffer = request.joinOffer;
  if (!joinOffer) {
    return { action: "create_join_link" };
  }
  const projectionScopes = joinOffer.projectionScopes;
  const projectionKinds = joinOffer.projectionKinds;
  const joinLink = {
    ...(joinOffer.displayName
      ? { displayName: joinOffer.displayName }
      : {}),
    ...(projectionScopes !== undefined && projectionScopes !== null
      ? {
        requestedVaultShareProjectionScopes: [
          ...projectionScopes,
        ],
      }
      : projectionKinds !== undefined && projectionKinds !== null
        ? {
          requestedVaultShareProjectionKinds: [
            ...projectionKinds,
          ],
        }
        : {}),
  };
  return Object.keys(joinLink).length > 0
    ? { action: "create_join_link", joinLink }
    : { action: "create_join_link" };
}

type HostedRuntimeGroupSmsUnsupportedRequest = Extract<
  HostedRuntimeGroupToolRequest,
  {
    action:
      | "post_disclosure_request"
      | "preflight_set_chat_avatar"
      | "set_chat_avatar"
      | "share_contact_card"
      | "update_display_name";
  }
>;

function buildHostedGroupSmsUnsupportedResponse(
  request: HostedRuntimeGroupSmsUnsupportedRequest,
): HostedRuntimeGroupToolResponse {
  switch (request.action) {
    case "update_display_name":
      return {
        action: request.action,
        result: {
          group: null,
          status: "unavailable",
          unavailableReason: "sms_chat_customization_unsupported",
        },
      };
    case "preflight_set_chat_avatar":
    case "set_chat_avatar":
      return {
        action: request.action,
        result: {
          status: "unavailable",
          unavailableReason: "sms_chat_customization_unsupported",
        },
      };
    case "share_contact_card":
      return {
        action: request.action,
        result: {
          status: "unavailable",
          unavailableReason: "sms_attachments_unsupported",
        },
      };
    case "post_disclosure_request":
      return {
        action: request.action,
        result: {
          status: "unavailable",
          unavailableReason: "sms_reactions_unsupported",
        },
      };
  }
}

function resolveHostedUsageReferralSourceContext(
  route: AssistantCurrentDeliveryRoute | null | undefined,
  linqService: HostedUsageReferralLinqService | null | undefined,
): HostedRuntimeUsageReferralSourceContext {
  const channel = normalizeAssistantRouteString(route?.channel)?.toLowerCase();
  const threadId = normalizeAssistantRouteString(route?.threadId);
  if (
    (channel !== "linq" && channel !== "telegram")
    || !threadId
    || !/^hid_[a-f0-9]{32}$/u.test(threadId)
    || typeof route?.threadIsDirect !== "boolean"
  ) {
    return {};
  }
  return {
    sourceConversation: {
      channel,
      ...(channel === "linq" && linqService ? { linqService } : {}),
      threadId,
      threadIsDirect: route.threadIsDirect,
    },
  };
}

type HostedGroupEmailRestrictedRequest = Exclude<
  HostedRuntimeGroupToolRequest,
  {
    action: "read_current" | "read_shared" | "read_usage";
  }
>;

function buildHostedGroupJournalActionUnavailable(
  request: Extract<
    HostedGroupEmailRestrictedRequest,
    {
      action:
        | "prepare_email"
        | "record_current_sender_journal_fact"
        | "set_current_sender_journal_capture"
        | "set_journal_capture";
    }
  >,
  unavailableReason: "authenticated_sender_required",
): HostedRuntimeGroupToolResponse {
  return {
    action: request.action,
    result: { status: "unavailable", unavailableReason },
  };
}

function buildHostedGroupEmailRestrictedActionUnavailable(
  request: HostedGroupEmailRestrictedRequest,
): HostedRuntimeGroupToolResponse {
  const unavailableReason = "authenticated_sender_required";
  switch (request.action) {
    case "ask":
    case "handoff":
    case "record_current_sender_daily_metric":
    case "ask_member":
      return {
        action: request.action,
        result: { status: "unavailable", unavailableReason },
      };
    case "ask_current_sender":
      return {
        action: "ask_current_sender",
        result: { status: "unavailable", unavailableReason },
      };
    case "list_memberships":
      return {
        action: request.action,
        result: { memberships: null, status: "unavailable", unavailableReason },
      };
    case "create_join_link":
    case "post_join_offer":
    case "update_display_name":
      return {
        action: request.action,
        result: { group: null, status: "unavailable", unavailableReason },
      };
    case "read_chat_name":
      return {
        action: request.action,
        result: { displayName: null, status: "unavailable", unavailableReason },
      };
    case "read_chat_participants":
      return {
        action: request.action,
        result: { participants: null, status: "unavailable", unavailableReason },
      };
    case "read_participant_display_names":
      return {
        action: request.action,
        result: { status: "unavailable", unavailableReason },
      };
    case "create_signup_referral_link":
    case "preflight_set_chat_avatar":
    case "set_chat_avatar":
    case "share_contact_card":
    case "leave_membership":
    case "post_disclosure_request":
    case "revoke_disclosure_grant":
    case "prepare_next_group":
    case "read_next_group":
    case "cancel_next_group":
    case "revoke_own_email_share":
      return {
        action: request.action,
        result: { status: "unavailable", unavailableReason },
      };
    case "arm_usage_referral":
    case "cancel_usage_referral":
    case "read_usage_referral":
      return {
        action: request.action,
        result: {
          referral: null,
          status: "unavailable",
          unavailableReason,
        },
      };
    default:
      return buildHostedGroupJournalActionUnavailable(
        request,
        unavailableReason,
      );
  }
}

/**
 * Picks the one channel whose handles may be matched this turn. A group runtime
 * is bound to a single provider thread, so evidence from two channels is a
 * contradiction and fails closed rather than letting Web guess which index to
 * match against.
 */
function resolveHostedGroupToolSenderHandles(input: {
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  telegramSenderHandles: readonly string[];
}): { linqSenderHandles?: string[]; telegramSenderHandles?: string[] } {
  const linqHandles = resolveHostedGroupToolLinqSenderHandles(
    input.linqDeliveryContexts,
  );
  const telegramHandles = [...new Set(input.telegramSenderHandles)]
    .filter((handle) =>
      [...handle].length <= HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS
    )
    .slice(0, HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX);
  if (linqHandles.length > 0 && telegramHandles.length > 0) {
    return {};
  }
  if (linqHandles.length > 0) {
    return { linqSenderHandles: linqHandles };
  }
  return telegramHandles.length > 0
    ? { telegramSenderHandles: telegramHandles }
    : {};
}

function resolveHostedGroupToolLinqSenderHandles(
  contexts: readonly HostedAssistantLinqDeliveryContext[],
): string[] {
  // Use only route-authorized Linq group inputs. Hosted email reply aliases
  // authenticate a route, not the human From header, and never enter here.
  const linqRoute = resolveHostedGroupToolLinqRouteContext(contexts);
  if (!linqRoute) {
    return [];
  }
  const eligible = new Set<string>();
  for (const context of contexts) {
    const authority = context.routeAuthority;
    const service = normalizeHostedGroupToolLinqService(context.service);
    if (
      !authority
      || authority.channel !== linqRoute.thread.authority.channel
      || authority.containerMemberId !== linqRoute.thread.authority.containerMemberId
      || authority.threadId !== linqRoute.thread.authority.threadId
      || service !== linqRoute.service
      || context.threadIsDirect !== false
    ) {
      continue;
    }
    const senderHandle = context.directRecipientPhoneNumber?.trim();
    if (
      !senderHandle
      || [...senderHandle].length
        > HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS
    ) {
      continue;
    }
    eligible.add(senderHandle);
  }
  return [...eligible].slice(0, HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX);
}

type HostedGroupToolLinqService = "imessage" | "sms";

type HostedGroupToolLinqRouteContext = {
  service: HostedGroupToolLinqService;
  thread: HostedRuntimeGroupToolLinqThreadContext;
};

/**
 * Direct home conversations are owned by `hostedMemberRouting`, not by the
 * group thread-route store, and one chat may never live in both. So a direct
 * route carries only the trusted host's exact chat id and service; Web
 * revalidates it against the direct owner at the send boundary. Fabricating a
 * thread-route authority here would assert an owner that cannot exist.
 */
type HostedDirectToolLinqRouteContext = {
  chatId: string;
  service: HostedGroupToolLinqService;
};

function resolveHostedDirectToolLinqRouteContext(
  contexts: readonly HostedAssistantLinqDeliveryContext[],
): HostedDirectToolLinqRouteContext | null {
  const eligible = new Map<string, HostedDirectToolLinqRouteContext>();
  let hasInvalidCandidate = false;
  for (const context of contexts) {
    if (context.threadIsDirect !== true) {
      if (context.threadIsDirect !== false) {
        hasInvalidCandidate = true;
      }
      continue;
    }
    const service = normalizeHostedGroupToolLinqService(context.service);
    const chatId = normalizeAssistantRouteString(context.target);
    if (!service || !chatId) {
      hasInvalidCandidate = true;
      continue;
    }
    const routeKey = JSON.stringify([chatId, service]);
    if (!eligible.has(routeKey)) {
      eligible.set(routeKey, { chatId, service });
    }
  }
  if (hasInvalidCandidate || eligible.size !== 1) {
    return null;
  }
  return [...eligible.values()][0] ?? null;
}

function resolveHostedGroupToolLinqRouteContext(
  contexts: readonly HostedAssistantLinqDeliveryContext[],
): HostedGroupToolLinqRouteContext | null {
  const eligible = new Map<string, HostedGroupToolLinqRouteContext>();
  let hasInvalidAuthoritativeCandidate = false;
  for (const context of contexts) {
    const authority = context.routeAuthority;
    if (!authority || context.threadIsDirect === true) {
      continue;
    }
    if (context.threadIsDirect !== false) {
      hasInvalidAuthoritativeCandidate = true;
      continue;
    }
    const service = normalizeHostedGroupToolLinqService(context.service);
    if (
      !service
      || authority.channel !== "linq"
      || authority.containerMemberId.trim().length === 0
      || authority.threadId.trim().length === 0
    ) {
      hasInvalidAuthoritativeCandidate = true;
      continue;
    }
    const routeKey = JSON.stringify([
      authority.channel,
      authority.containerMemberId,
      authority.threadId,
      service,
    ]);
    if (!eligible.has(routeKey)) {
      eligible.set(routeKey, {
        service,
        thread: {
          authority: {
            ...(authority.accountLookupKey === undefined
              ? {}
              : { accountLookupKey: authority.accountLookupKey }),
            channel: authority.channel,
            containerMemberId: authority.containerMemberId,
            threadId: authority.threadId,
          },
          chatId: authority.threadId,
        },
      });
    }
  }

  // An incomplete candidate, service mismatch, or second authorized route
  // makes the provider target ambiguous. Fail closed rather than choosing
  // iMessage or SMS by iteration order during a provider re-key or mixed batch.
  if (hasInvalidAuthoritativeCandidate || eligible.size !== 1) {
    return null;
  }
  return [...eligible.values()][0] ?? null;
}

function normalizeHostedGroupToolLinqService(
  service: string | null | undefined,
): HostedGroupToolLinqService | null {
  const normalized = service?.trim().toLowerCase();
  return normalized === "imessage" || normalized === "sms"
    ? normalized
    : null;
}
