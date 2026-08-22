import type {
  HostedPhoneCallResultDeliveryStatus,
  PrismaClient,
} from "@prisma/client";
import type {
  HostedPhoneCallResultDeliveryOutcomeRequest,
} from "@murphai/hosted-execution/phone-calls";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  assertHostedAssistantNotificationRouteAuthority,
} from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import {
  signalHostedPhoneCallResultNotificationRecovery,
} from "./reconciliation-workflow-start";

const HOSTED_PHONE_CALL_RESULT_DELIVERY_TERMINAL_STATUSES = new Set<
  HostedPhoneCallResultDeliveryStatus
>([
  "ambiguous",
  "delivered",
]);

export interface HostedPhoneCallResultDeliveryOutcomeResult {
  recorded: boolean;
  status: HostedPhoneCallResultDeliveryStatus;
}

export async function recordHostedPhoneCallResultDeliveryOutcome(input: {
  memberId: string;
  prisma?: PrismaClient;
  request: HostedPhoneCallResultDeliveryOutcomeRequest;
  rearmRecovery?: typeof signalHostedPhoneCallResultNotificationRecovery;
  signal?: AbortSignal;
}): Promise<HostedPhoneCallResultDeliveryOutcomeResult> {
  const prisma = input.prisma ?? getPrisma();
  const rearmRecovery = input.rearmRecovery
    ?? signalHostedPhoneCallResultNotificationRecovery;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await prisma.hostedPhoneCall.findFirst({
      select: {
        resultDeliveryGeneration: true,
        resultDeliveryStatus: true,
      },
      where: {
        id: input.request.phoneCallId,
        memberId: input.memberId,
        resultNotificationChannel: "telegram",
      },
    });
    if (!current || current.resultDeliveryStatus === null) {
      throw hostedOnboardingError({
        code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_NOT_FOUND",
        httpStatus: 404,
        message: "Hosted phone call result delivery was not found.",
      });
    }
    if (current.resultDeliveryGeneration === null) {
      throwHostedPhoneCallResultDeliveryTransitionInvalid();
    }

    if (input.request.generation < current.resultDeliveryGeneration) {
      if (input.request.status === "sending") {
        throwHostedPhoneCallResultDeliveryTransitionInvalid();
      }
      return {
        recorded: false,
        status: current.resultDeliveryStatus,
      };
    }
    if (input.request.generation > current.resultDeliveryGeneration) {
      throw hostedOnboardingError({
        code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_GENERATION_INVALID",
        httpStatus: 409,
        message: "Hosted phone call result delivery generation is invalid.",
      });
    }
    if (input.request.status === "sending") {
      if (input.request.routeAuthority.containerMemberId !== input.memberId) {
        throwHostedPhoneCallResultDeliveryRouteUnauthorized();
      }
      await assertHostedAssistantNotificationRouteAuthority({
        authority: input.request.routeAuthority,
        prisma,
        signal: input.signal,
      });
    }

    const transition = resolveHostedPhoneCallResultDeliveryTransition({
      currentStatus: current.resultDeliveryStatus,
      request: input.request,
    });
    if (!transition) {
      if (shouldRearmHostedPhoneCallResultDeliveryReplay({
        currentStatus: current.resultDeliveryStatus,
        request: input.request,
      })) {
        await rearmRecovery({
          memberId: input.memberId,
          prisma,
        });
      }
      return {
        recorded: false,
        status: current.resultDeliveryStatus,
      };
    }

    const updated = await prisma.hostedPhoneCall.updateMany({
      data: {
        resultDeliveryStatus: transition.status,
        resultDeliveryTerminalAt: transition.terminal ? new Date() : null,
      },
      where: {
        id: input.request.phoneCallId,
        memberId: input.memberId,
        resultDeliveryGeneration: input.request.generation,
        resultDeliveryStatus: current.resultDeliveryStatus,
        resultNotificationChannel: "telegram",
      },
    });
    if (updated.count === 0) {
      continue;
    }

    if (transition.rearm) {
      await rearmRecovery({
        memberId: input.memberId,
        prisma,
      });
    }
    return {
      recorded: true,
      status: transition.status,
    };
  }

  throw hostedOnboardingError({
    code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_CONFLICT",
    httpStatus: 409,
    message: "Hosted phone call result delivery changed concurrently.",
    retryable: true,
  });
}

function shouldRearmHostedPhoneCallResultDeliveryReplay(input: {
  currentStatus: HostedPhoneCallResultDeliveryStatus;
  request: HostedPhoneCallResultDeliveryOutcomeRequest;
}): boolean {
  if (HOSTED_PHONE_CALL_RESULT_DELIVERY_TERMINAL_STATUSES.has(
    input.currentStatus,
  )) {
    return input.request.status !== "sending";
  }
  if (
    input.currentStatus === "pending"
    && input.request.status === "failed_ambiguous"
  ) {
    return true;
  }
  return input.currentStatus === "pending"
    && input.request.status === "failed";
}

function resolveHostedPhoneCallResultDeliveryTransition(input: {
  currentStatus: HostedPhoneCallResultDeliveryStatus;
  request: HostedPhoneCallResultDeliveryOutcomeRequest;
}): {
  rearm: boolean;
  status: HostedPhoneCallResultDeliveryStatus;
  terminal: boolean;
} | null {
  if (HOSTED_PHONE_CALL_RESULT_DELIVERY_TERMINAL_STATUSES.has(
    input.currentStatus,
  )) {
    if (input.request.status === "sending") {
      throwHostedPhoneCallResultDeliveryTransitionInvalid();
    }
    return null;
  }

  if (input.request.status === "sending") {
    if (input.currentStatus === "sending") {
      return null;
    }
    if (input.currentStatus !== "queued") {
      throwHostedPhoneCallResultDeliveryTransitionInvalid();
    }
    return {
      rearm: false,
      status: "sending",
      terminal: false,
    };
  }

  if (input.request.status === "failed_ambiguous") {
    if (input.currentStatus === "pending") {
      return null;
    }
    if (input.currentStatus === "queued") {
      return {
        rearm: true,
        status: "pending",
        terminal: false,
      };
    }
  }

  if (input.request.status === "failed") {
    if (input.currentStatus === "pending") {
      return null;
    }
    return {
      rearm: true,
      status: "pending",
      terminal: false,
    };
  }

  if (input.currentStatus !== "sending") {
    throwHostedPhoneCallResultDeliveryTransitionInvalid();
  }

  return {
    rearm: true,
    status: input.request.status === "sent"
      ? "delivered"
      : "ambiguous",
    terminal: true,
  };
}

function throwHostedPhoneCallResultDeliveryRouteUnauthorized(): never {
  throw hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "Hosted notification route is no longer authorized.",
  });
}

function throwHostedPhoneCallResultDeliveryTransitionInvalid(): never {
  throw hostedOnboardingError({
    code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_TRANSITION_INVALID",
    httpStatus: 409,
    message: "Hosted phone call result delivery transition is invalid.",
  });
}
