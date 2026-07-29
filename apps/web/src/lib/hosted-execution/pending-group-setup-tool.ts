import "server-only";

import {
  HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION,
  HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION,
  HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION,
  type HostedRuntimeAssistantPersonalizationToolAuthority,
  type HostedRuntimeAssistantPersonalizationToolRequest,
  type HostedRuntimeAssistantPersonalizationToolResponse,
} from "@murphai/hosted-execution/assistant-personalization";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";

import {
  armHostedPendingGroupSetupTx,
  cancelHostedPendingGroupSetupTx,
  readHostedPendingGroupSetup,
  type HostedPendingGroupSetupSnapshot,
} from "@/src/lib/hosted-groups/pending-group-setup";
import {
  readHostedMemberRoutingState,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  readHostedMailboxConversationWakeByAssistantInputId,
  type HostedMailboxStoreClient,
} from "@/src/lib/hosted-mailbox/store";
import { getPrisma } from "@/src/lib/prisma";

export type HostedRuntimePendingGroupSetupToolRequest = Extract<
  HostedRuntimeAssistantPersonalizationToolRequest,
  {
    action:
      | typeof HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION
      | typeof HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION
      | typeof HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION;
  }
>;

type HostedRuntimePendingGroupSetupToolResponse = Extract<
  HostedRuntimeAssistantPersonalizationToolResponse,
  { action: HostedRuntimePendingGroupSetupToolRequest["action"] }
>;

export function isHostedRuntimePendingGroupSetupToolAction(
  action: string,
): action is HostedRuntimePendingGroupSetupToolRequest["action"] {
  return action === HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION
    || action === HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION
    || action === HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION;
}

export async function handleHostedRuntimePendingGroupSetupTool(input: {
  authority?: HostedRuntimeAssistantPersonalizationToolAuthority;
  memberId: string;
  request: HostedRuntimePendingGroupSetupToolRequest;
}): Promise<HostedRuntimePendingGroupSetupToolResponse> {
  const authority = input.authority;
  if (!authority) {
    throw new TypeError(
      "Pending group setup requires assistant input authority.",
    );
  }

  const prisma = getPrisma();
  return await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, {
      prisma: tx,
    });
    const container = await tx.hostedThreadContainer.findUnique({
      select: { memberId: true },
      where: { memberId: input.memberId },
    });
    if (container) {
      return buildUnavailablePendingGroupSetupResponse(
        input.request.action,
        "direct_member_required",
      );
    }

    await requireHostedDirectPendingGroupSetupInputAuthority({
      assistantInputId: authority.assistantInputId,
      memberId: input.memberId,
      prisma: tx,
    });

    if (input.request.action === HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION) {
      const canceled = await cancelHostedPendingGroupSetupTx({
        ownerMemberId: input.memberId,
        tx,
      });
      return {
        action: input.request.action,
        result: { status: canceled ? "canceled" : "none" },
      };
    }

    if (input.request.action === HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION) {
      const setup = await readHostedPendingGroupSetup({
        ownerMemberId: input.memberId,
        prisma: tx,
      });
      return setup
        ? {
            action: input.request.action,
            result: {
              setup: projectHostedPendingGroupSetupForRuntime(setup),
              status: "ok",
            },
          }
        : {
            action: input.request.action,
            result: { setup: null, status: "none" },
          };
    }

    const routing = await readHostedMemberRoutingState({
      memberId: input.memberId,
      prisma: tx,
    });
    const recipientPhoneLookupKey = routing?.linqRecipientPhoneLookupKey ?? null;
    if (!recipientPhoneLookupKey) {
      return buildUnavailablePendingGroupSetupResponse(
        input.request.action,
        "imessage_line_unavailable",
      );
    }

    const setup = await armHostedPendingGroupSetupTx({
      ownerMemberId: input.memberId,
      recipientPhoneLookupKey,
      setup: input.request.setup,
      tx,
    });
    return {
      action: input.request.action,
      result: {
        setup: projectHostedPendingGroupSetupForRuntime(setup),
        status: "armed",
      },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function requireHostedDirectPendingGroupSetupInputAuthority(input: {
  assistantInputId: string;
  memberId: string;
  prisma: HostedMailboxStoreClient;
}): Promise<void> {
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.assistantInputId,
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!wake || !isHostedDirectPendingGroupSetupWake(wake)) {
    throw new TypeError("Pending group setup input authority is invalid.");
  }
}

function isHostedDirectPendingGroupSetupWake(
  wake: HostedExecutionConversationMessageWake,
): boolean {
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.linqMessage.threadIsDirect === true;
  }
  if (isHostedEmailConversationMessageWake(wake)) {
    return wake.message.threadIsDirect === true
      && wake.message.assistantStyleSettingsAuthorized === true;
  }
  return isHostedTelegramConversationMessageWake(wake);
}

function projectHostedPendingGroupSetupForRuntime(
  setup: HostedPendingGroupSetupSnapshot,
) {
  return {
    armedAt: setup.armedAt.toISOString(),
    expiresAt: setup.expiresAt.toISOString(),
    ...setup.setup,
  };
}

function buildUnavailablePendingGroupSetupResponse(
  action: HostedRuntimePendingGroupSetupToolRequest["action"],
  unavailableReason: "direct_member_required" | "imessage_line_unavailable",
): HostedRuntimePendingGroupSetupToolResponse {
  if (action === HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION) {
    return {
      action,
      result: { status: "unavailable", unavailableReason },
    };
  }
  return {
    action,
    result: { setup: null, status: "unavailable", unavailableReason },
  };
}
