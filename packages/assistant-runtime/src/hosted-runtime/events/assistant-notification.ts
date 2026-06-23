import { createHash } from "node:crypto";

import type { AutomationRoute } from "@murphai/contracts";
import {
  buildHostedAssistantContextFingerprintDetails,
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphManagedAutomationDefinition,
  sendAssistantNotification,
  upsertAssistantCronAutomation,
  type AssistantExecutionContext,
  type AssistantNotificationResult,
  type AssistantTurnEnvironment,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionLogLevel,
  HostedExecutionLogPhase,
  HostedExecutionMemberActivatedWake,
  HostedExecutionRedactedLogEntry,
  HostedExecutionStructuredLogDetails,
  HostedExecutionSystemWake,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
} from "@murphai/hosted-execution";
import { emitHostedAssistantContextTraceLog } from "../context-diagnostics.ts";
import { HOSTED_ASSISTANT_WAKE_REASON } from "../wake-candidates.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";
import { emitHostedAssistantProviderTraceLog } from "./provider-trace-log.ts";

type AssistantNotificationInput = Parameters<typeof sendAssistantNotification>[0];

const ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION =
  resolveMurphManagedAutomationDefinition(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION);

export async function executeHostedMemberActivatedWake(input: {
  wake: HostedExecutionMemberActivatedWake;
  executionContext: AssistantExecutionContext;
  sourceMailboxItemId?: string | null;
  turnEnvironment?: AssistantTurnEnvironment | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  const signupWelcome = input.wake.signupWelcome;
  if (!signupWelcome) {
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "member-activated",
    });
  }

  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [
    emitHostedMemberActivationSignupWelcomeLifecycleLog({
      message: "Hosted member activation signup welcome started.",
      phase: "wake.running",
      wake: input.wake,
    }),
  ];
  let seededOnboardingFollowupWakeAt: string | null = null;

  try {
    const notificationResult = await sendAssistantNotification(
      buildMemberActivationSignupWelcomeNotificationInput(
        input.wake,
        input.executionContext,
        input.vaultRoot,
        input.sourceMailboxItemId ?? null,
        input.turnEnvironment ?? null,
        (entry) => {
          redactedLogEntries.push(entry);
        },
      ),
    );
    seededOnboardingFollowupWakeAt = await maybeSeedOnboardingFollowupAutomation({
      logDetails: buildHostedMemberActivationSignupWelcomeLogDetails(input.wake),
      notificationResult,
      redactedLogEntries,
      route: signupWelcome.route,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    redactedLogEntries.push(
      emitHostedMemberActivationSignupWelcomeLifecycleLog({
        error,
        level: "error",
        message: "Hosted member activation signup welcome failed.",
        phase: "failed",
        wake: input.wake,
      }),
    );
    throw error;
  }

  redactedLogEntries.push(
    emitHostedMemberActivationSignupWelcomeLifecycleLog({
      message: "Hosted member activation signup welcome finished.",
      phase: "wake.running",
      wake: input.wake,
    }),
  );

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "member-activated",
    nextWakeAt: seededOnboardingFollowupWakeAt,
    nextWakeReason: seededOnboardingFollowupWakeAt ? HOSTED_ASSISTANT_WAKE_REASON : null,
    redactedLogEntries,
  });
}

export async function executeHostedAssistantNotificationWake(input: {
  wake: HostedExecutionAssistantNotificationRequestedWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnly?: boolean;
  sourceMailboxItemId?: string | null;
  turnEnvironment?: AssistantTurnEnvironment | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [
    emitHostedAssistantNotificationLifecycleLog({
      message: "Hosted assistant notification started.",
      phase: "wake.running",
      wake: input.wake,
    }),
  ];
  let seededOnboardingFollowupWakeAt: string | null = null;

  try {
    const notificationResult = await sendAssistantNotification(
      buildAssistantNotificationInput(
        input.wake,
        input.executionContext,
        input.forceQueueOnly === true,
        input.vaultRoot,
        input.sourceMailboxItemId ?? null,
        input.turnEnvironment ?? null,
        (entry) => {
          redactedLogEntries.push(entry);
        },
      ),
    );
    if (isHostedSignupWelcomeNotification(input.wake)) {
      seededOnboardingFollowupWakeAt = await maybeSeedOnboardingFollowupAutomation({
        logDetails: buildHostedAssistantNotificationLogDetails(input.wake),
        notificationResult,
        redactedLogEntries,
        route: input.wake.notification.route,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    }
  } catch (error) {
    if (!shouldSkipFailedHostedAssistantNotification(input.wake)) {
      redactedLogEntries.push(
        emitHostedAssistantNotificationLifecycleLog({
          error,
          level: "error",
          message: "Hosted assistant notification failed.",
          phase: "failed",
          wake: input.wake,
        }),
      );
      throw error;
    }

    redactedLogEntries.push(emitHostedAssistantNotificationSkipLog(input.wake, error));
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "assistant-notification",
      redactedLogEntries,
    });
  }

  redactedLogEntries.push(
    emitHostedAssistantNotificationLifecycleLog({
      message: "Hosted assistant notification finished.",
      phase: "wake.running",
      wake: input.wake,
    }),
  );

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "assistant-notification",
    nextWakeAt: seededOnboardingFollowupWakeAt,
    nextWakeReason: seededOnboardingFollowupWakeAt ? HOSTED_ASSISTANT_WAKE_REASON : null,
    redactedLogEntries,
  });
}

async function maybeSeedOnboardingFollowupAutomation(input: {
  logDetails: HostedExecutionStructuredLogDetails;
  notificationResult: AssistantNotificationResult | undefined;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
  route: HostedExecutionAssistantNotificationRoute;
  vaultRoot: string;
  wake: HostedExecutionSystemWake;
}): Promise<string | null> {
  if (!didAssistantNotificationAcceptDelivery(input.notificationResult)) {
    return null;
  }

  try {
    // Route deliverability (e.g. Linq participant routes without a Linq
    // delivery source) is enforced by upsertAssistantCronAutomation's target
    // validation; an undeliverable route lands in the catch below.
    const job = await upsertAssistantCronAutomation({
      firstOccurrencePolicy: "after-current-local-day",
      instructions: ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION.instructions,
      route: buildOnboardingFollowupAutomationRoute(input.route),
      schedule: ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION.schedule,
      slug: ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION.slug,
      summary: ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION.summary,
      tags: ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION.tags,
      title: ONBOARDING_FOLLOWUP_AUTOMATION_DEFINITION.title,
      vault: input.vaultRoot,
    });
    return job?.enabled ? job.state.nextRunAt : null;
  } catch (error) {
    input.redactedLogEntries.push(
      emitHostedOnboardingFollowupSeedFailureLog({
        details: input.logDetails,
        error,
        wake: input.wake,
      }),
    );
    return null;
  }
}

function didAssistantNotificationAcceptDelivery(
  result: AssistantNotificationResult | undefined,
): boolean {
  const outcomeKind = result?.deliveryOutcome?.kind;
  return outcomeKind === "sent" || outcomeKind === "queued";
}

function buildOnboardingFollowupAutomationRoute(
  route: HostedExecutionAssistantNotificationRoute,
): AutomationRoute {
  const delivery = route.delivery;
  if (route.channel === "linq") {
    return {
      channel: route.channel,
      deliverySource: delivery.source ?? null,
      deliveryTarget: delivery.kind === "participant" ? null : delivery.target,
      identityId: route.identityId,
      participantId: delivery.kind === "participant" ? delivery.target : null,
      threadId: null,
    };
  }

  return {
    channel: route.channel,
    deliverySource: delivery.source ?? null,
    deliveryTarget: delivery.kind === "explicit" ? delivery.target : null,
    identityId: route.identityId,
    participantId: delivery.kind === "participant" ? delivery.target : null,
    threadId:
      route.threadId ?? (delivery.kind === "thread" ? delivery.target : null),
  };
}

function emitHostedOnboardingFollowupSeedFailureLog(input: {
  details: HostedExecutionStructuredLogDetails;
  error: unknown;
  wake: HostedExecutionSystemWake;
}): HostedExecutionRedactedLogEntry {
  const details = {
    ...input.details,
    eventCode: "assistant.onboarding_followup_seed_failed",
  };
  const redacted = {
    ...details,
    ...(extractHostedAssistantNotificationRedactedDetails(input.error) ?? {}),
    errorCode: deriveHostedExecutionErrorCode(input.error),
  };

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details,
    error: input.error,
    level: "warn",
    message: "Hosted onboarding follow-up automation seed failed.",
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime",
    eventId: input.wake.eventId,
    level: "warn",
    message: "Hosted onboarding follow-up automation seed failed.",
    phase: "wake.running",
    redacted,
  };
}

function shouldSkipFailedHostedAssistantNotification(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): boolean {
  return (
    !isHostedSignupWelcomeNotification(wake)
    && (
      wake.notification.firstContact != null
      || wake.notification.responsePolicy?.kind === "allow_send_or_skip"
    )
  );
}

function emitHostedAssistantNotificationSkipLog(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  error: unknown,
): HostedExecutionRedactedLogEntry {
  return emitHostedAssistantNotificationLifecycleLog({
    error,
    level: "warn",
    message: "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
    phase: "wake.running",
    wake,
  });
}

function buildHostedAssistantNotificationLogDetails(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): HostedExecutionStructuredLogDetails {
  return buildHostedAssistantNotificationRouteLogDetails({
    deliveryDedupeTokenPresent: wake.notification.deliveryDedupeToken != null,
    deliveryDispatchMode: wake.notification.deliveryDispatchMode ?? "default",
    firstContact: wake.notification.firstContact != null,
    responsePolicyKind: wake.notification.responsePolicy?.kind ?? "none",
    route: wake.notification.route,
  });
}

function buildHostedMemberActivationSignupWelcomeLogDetails(
  wake: HostedExecutionMemberActivatedWake,
): HostedExecutionStructuredLogDetails {
  const signupWelcome = requireMemberActivationSignupWelcome(wake);
  const route = signupWelcome.route;

  return buildHostedAssistantNotificationRouteLogDetails({
    deliveryDedupeTokenPresent: true,
    deliveryDispatchMode: "queue-only",
    firstContact: true,
    responsePolicyKind: "require_send_exact_text",
    route,
  });
}

function buildHostedAssistantNotificationRouteLogDetails(input: {
  deliveryDedupeTokenPresent: boolean;
  deliveryDispatchMode: string;
  firstContact: boolean;
  responsePolicyKind: string;
  route: HostedExecutionAssistantNotificationRoute;
}): HostedExecutionStructuredLogDetails {
  const route = input.route;

  return {
    deliveryDedupeTokenPresent: input.deliveryDedupeTokenPresent,
    deliveryDispatchMode: input.deliveryDispatchMode,
    firstContact: input.firstContact,
    notificationRouteChannel: route.channel,
    notificationRouteDeliveryKind: route.delivery.kind,
    notificationRouteIdentityPresent: route.identityId != null,
    notificationRouteThreadIdPresent: route.threadId != null,
    notificationRouteThreadIsDirect: route.threadIsDirect,
    responsePolicyKind: input.responsePolicyKind,
    ...buildHostedAssistantContextFingerprintDetails({
      actorId: route.actorId,
      channel: route.channel,
      identityId: route.identityId,
      threadId: route.threadId,
      threadIsDirect: route.threadIsDirect,
    }),
  };
}

function emitHostedAssistantNotificationLifecycleLog(input: {
  error?: unknown;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionRedactedLogEntry {
  return emitHostedNotificationLifecycleLog({
    ...input,
    details: buildHostedAssistantNotificationLogDetails(input.wake),
  });
}

function emitHostedMemberActivationSignupWelcomeLifecycleLog(input: {
  error?: unknown;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedExecutionMemberActivatedWake;
}): HostedExecutionRedactedLogEntry {
  return emitHostedNotificationLifecycleLog({
    ...input,
    details: buildHostedMemberActivationSignupWelcomeLogDetails(input.wake),
  });
}

function emitHostedNotificationLifecycleLog(input: {
  details: HostedExecutionStructuredLogDetails;
  error?: unknown;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedRuntimeEvent;
}): HostedExecutionRedactedLogEntry {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: input.details,
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.level === undefined ? {} : { level: input.level }),
    message: input.message,
    phase: input.phase,
    wake: input.wake,
  });

  return {
    component: "runtime",
    eventId: input.wake.eventId,
    level: input.level ?? (input.error === undefined ? "info" : "error"),
    message: input.message,
    phase: input.phase,
    redacted: {
      ...input.details,
      ...(extractHostedAssistantNotificationRedactedDetails(input.error) ?? {}),
      ...(input.error === undefined ? {} : { errorCode: deriveHostedExecutionErrorCode(input.error) }),
    },
  };
}

function buildMemberActivationSignupWelcomeNotificationInput(
  wake: HostedExecutionMemberActivatedWake,
  executionContext: AssistantExecutionContext,
  vault: string,
  sourceMailboxItemId: string | null,
  turnEnvironment: AssistantTurnEnvironment | null,
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void,
): AssistantNotificationInput {
  const signupWelcome = requireMemberActivationSignupWelcome(wake);
  const signupWelcomeToken = `signup-welcome:${wake.userId}`;
  return buildAssistantNotificationInputFromRoute({
    assistantTurnOrdinal: "member-activated:signup-welcome:1",
    deliveryDedupeToken: signupWelcomeToken,
    deliveryDispatchMode: "queue-only",
    deliveryIdempotencyKey: signupWelcomeToken,
    executionContext,
    firstContactPolicy: {
      markSeenOnDeliveryAccepted: true,
    },
    instructions: buildHostedMemberSignupWelcomeInstructions(signupWelcome.text),
    logDetails: buildHostedMemberActivationSignupWelcomeLogDetails(wake),
    recordLogEntry,
    responsePolicy: {
      kind: "require_send_exact_text",
      text: signupWelcome.text,
    },
    route: signupWelcome.route,
    sourceMailboxItemId,
    turnEnvironment,
    turnTrigger: "manual-deliver",
    vault,
    wake,
  });
}

function requireMemberActivationSignupWelcome(
  wake: HostedExecutionMemberActivatedWake,
): NonNullable<HostedExecutionMemberActivatedWake["signupWelcome"]> {
  if (!wake.signupWelcome) {
    throw new TypeError("Hosted member activation wake has no signup welcome payload.");
  }

  return wake.signupWelcome;
}

function buildHostedMemberSignupWelcomeInstructions(text: string): string {
  return [
    "Prepare the first in-chat onboarding reply.",
    "Use this user-facing reply only:",
    text,
  ].join("\n\n");
}

function buildAssistantNotificationInput(
  wake: HostedExecutionAssistantNotificationRequestedWake,
  executionContext: AssistantExecutionContext,
  forceQueueOnly: boolean,
  vault: string,
  sourceMailboxItemId: string | null,
  turnEnvironment: AssistantTurnEnvironment | null,
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void,
): AssistantNotificationInput {
  return buildAssistantNotificationInputFromRoute({
    assistantTurnOrdinal: "assistant-notification:1",
    deliveryDedupeToken: wake.notification.deliveryDedupeToken ?? null,
    deliveryDispatchMode: forceQueueOnly
      ? "queue-only"
      : wake.notification.deliveryDispatchMode ?? undefined,
    deliveryIdempotencyKey: wake.notification.deliveryIdempotencyKey ?? null,
    executionContext,
    firstContactPolicy: wake.notification.firstContact
      ? {
          markSeenOnDeliveryAccepted:
            wake.notification.firstContact.markSeenOnDeliveryAccepted,
        }
      : null,
    instructions: wake.notification.instructions,
    logDetails: buildHostedAssistantNotificationLogDetails(wake),
    recordLogEntry,
    responsePolicy: wake.notification.responsePolicy ?? null,
    route: wake.notification.route,
    sourceMailboxItemId,
    turnEnvironment,
    turnTrigger: "automation-cron",
    vault,
    wake,
  });
}

function buildAssistantNotificationInputFromRoute(input: {
  assistantTurnOrdinal: string;
  deliveryDedupeToken: AssistantNotificationInput["deliveryDedupeToken"];
  deliveryDispatchMode: AssistantNotificationInput["deliveryDispatchMode"];
  deliveryIdempotencyKey: AssistantNotificationInput["deliveryIdempotencyKey"];
  executionContext: AssistantExecutionContext;
  firstContactPolicy: AssistantNotificationInput["firstContactPolicy"];
  instructions: string;
  logDetails: HostedExecutionStructuredLogDetails;
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void;
  responsePolicy: AssistantNotificationInput["responsePolicy"];
  route: HostedExecutionAssistantNotificationRoute;
  sourceMailboxItemId: string | null;
  turnEnvironment: AssistantTurnEnvironment | null;
  turnTrigger: AssistantNotificationInput["turnTrigger"];
  vault: string;
  wake: HostedRuntimeEvent;
}): AssistantNotificationInput {
  const route = input.route;
  const delivery = route.delivery;

  return {
    actorId: route.actorId,
    bindingDeliveryTarget:
      delivery.kind === "explicit" ? null : delivery.target,
    channel: route.channel,
    deliveryDedupeToken: input.deliveryDedupeToken,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: input.assistantTurnOrdinal,
      conversationId: hashHostedAssistantNotificationDeliveryKeyParts([
        route.channel,
        route.identityId,
        route.actorId,
        route.threadId,
        route.threadIsDirect,
      ]),
      inboundMailboxItemIds: [
        input.sourceMailboxItemId ?? input.wake.eventId,
      ],
      recipientKey: hashHostedAssistantNotificationDeliveryKeyParts([
        route.channel,
        delivery.kind,
        delivery.target,
        route.identityId,
        route.actorId,
        route.threadId,
      ]),
    },
    deliveryKind: delivery.kind === "explicit" ? null : delivery.kind,
    deliverySource: delivery.source ?? null,
    deliveryTarget: delivery.kind === "explicit" ? delivery.target : null,
    executionContext: input.executionContext,
    firstContactPolicy: input.firstContactPolicy,
    identityId: route.identityId,
    instructions: input.instructions,
    onTraceEvent(event) {
      const contextEntry = emitHostedAssistantContextTraceLog({
        event,
        wake: input.wake,
      });
      if (contextEntry) {
        input.recordLogEntry(contextEntry);
      }
      const entry = emitHostedAssistantProviderTraceLog({
        details: input.logDetails,
        event,
        wake: input.wake,
      });
      if (entry) {
        input.recordLogEntry(entry);
      }
    },
    responsePolicy: input.responsePolicy,
    threadId: route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnEnvironment: input.turnEnvironment,
    turnTrigger: input.turnTrigger,
    vault: input.vault,
  };
}

function isHostedSignupWelcomeNotification(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): boolean {
  const signupWelcomeToken = `signup-welcome:${wake.userId}`;
  return (
    wake.notification.responsePolicy?.kind === "require_send_exact_text"
    && wake.notification.firstContact?.markSeenOnDeliveryAccepted === true
    && wake.notification.deliveryDedupeToken === signupWelcomeToken
    && wake.notification.deliveryIdempotencyKey === signupWelcomeToken
  );
}

function hashHostedAssistantNotificationDeliveryKeyParts(
  parts: readonly (boolean | null | string | undefined)[],
): string {
  return `sha256:${createHash("sha256")
    .update("murph.hosted-notification-delivery-key.v1")
    .update("\0")
    .update(JSON.stringify(parts.map((part) => part ?? null)))
    .digest("hex")}`;
}
