import { createHash } from "node:crypto";

import type { AutomationRoute } from "@murphai/contracts";
import {
  buildHostedAssistantContextFingerprintDetails,
  initializeAssistantGroupRoomModel,
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphOnboardingFollowupSchedule,
  sendAssistantNotification,
  upsertAssistantCronAutomation,
  type AssistantExecutionContext,
  type AssistantNotificationResult,
  type AssistantTurnEnvironment,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLogLevel,
  HostedExecutionLogPhase,
  HostedExecutionMemberActivatedWake,
  HostedExecutionRedactedLogEntry,
  HostedExecutionStructuredLogDetails,
  HostedExecutionSystemWake,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
} from "@murphai/hosted-execution";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import { emitHostedAssistantContextTraceLog } from "../context-diagnostics.ts";
import type { HostedRuntimeEffectsPort } from "../platform.ts";
import { HOSTED_ASSISTANT_WAKE_REASON } from "../wake-candidates.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";
import { emitHostedAssistantProviderTraceLog } from "./provider-trace-log.ts";

type AssistantNotificationInput = Parameters<typeof sendAssistantNotification>[0];

const HOSTED_ASSISTANT_NOTIFICATION_EVENT_PREFIX =
  "assistant.notification.requested:";
const HOSTED_USAGE_REFERRAL_NOTIFICATION_KEY_PREFIX =
  "usage-referral-reward:";

type HostedAssistantNotificationSystemMailboxPreparation =
  | {
      kind: "execute";
      wake: HostedExecutionAssistantNotificationRequestedWake;
    }
  | {
      kind: "terminal_no_send";
      outcome: HostedMailboxOutcome;
      reason: "external_route_authority_stale";
    };

export type HostedLegacyUsageReferralAuthorityClassification =
  | "eligible"
  | "identity_mismatch"
  | "member_mismatch"
  | "not_usage_referral"
  | "policy_mismatch"
  | "route_mismatch";

/**
 * Recovers only the one authority-less usage-referral notification shape that
 * shipped before direct Linq route proof was carried into the mailbox wake.
 * The local system mailbox already owns the imported payload, so recovery must
 * happen here rather than by mutating the Web row behind its import watermark.
 */
export async function prepareHostedAssistantNotificationSystemMailboxWake(
  input: {
    assertExternalThreadRouteAuthority:
      HostedRuntimeEffectsPort["assertExternalThreadRouteAuthority"];
    executionContext: AssistantExecutionContext;
    mailboxDedupeKey: string;
    signal: AbortSignal | null;
    wake: HostedExecutionAssistantNotificationRequestedWake;
  },
): Promise<HostedAssistantNotificationSystemMailboxPreparation> {
  const authority = readLegacyHostedUsageReferralDirectLinqAuthority(input);
  if (!authority) {
    return {
      kind: "execute",
      wake: input.wake,
    };
  }

  const assertAuthority = input.assertExternalThreadRouteAuthority;
  if (!assertAuthority) {
    throw new VaultCliError(
      "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
      "Hosted legacy usage-referral delivery requires live route authority before model work.",
      { retryable: true },
    );
  }

  try {
    await assertAuthority(authority, { signal: input.signal });
  } catch (error) {
    if (!isHostedThreadRouteEgressUnauthorizedError(error)) {
      throw error;
    }

    return {
      kind: "terminal_no_send",
      outcome: createNoopMailboxEffect({
        conversationMetrics: null,
        deliveryIntentIds: [],
        mailboxLane: "assistant-notification",
        redactedLogEntries: [
          emitHostedAssistantNotificationLifecycleLog({
            extraDetails: {
              eventCode:
                "assistant.notification.legacy_usage_referral_terminal_no_send",
              terminalDisposition: "external_route_authority_stale",
            },
            level: "warn",
            message:
              "Hosted legacy usage-referral notification ended without delivery because its frozen route is no longer authorized.",
            phase: "wake.running",
            wake: input.wake,
          }),
        ],
      }),
      reason: "external_route_authority_stale",
    };
  }

  return {
    kind: "execute",
    wake: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: input.wake.eventId,
      memberId: input.wake.userId,
      notification: {
        ...input.wake.notification,
        externalThreadRouteAuthority: authority,
      },
      occurredAt: input.wake.occurredAt,
    }),
  };
}

export async function executeHostedMemberActivatedWake(input: {
  wake: HostedExecutionMemberActivatedWake;
  executionContext: AssistantExecutionContext;
  sourceMailboxItemId?: string | null;
  turnEnvironment?: AssistantTurnEnvironment | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  const redactedLogEntries: HostedExecutionRedactedLogEntry[] = [];
  const initialGroupRoomModelMarkdown =
    input.wake.initialGroupRoomModelMarkdown;
  if (initialGroupRoomModelMarkdown) {
    try {
      const result = await initializeAssistantGroupRoomModel({
        body: initialGroupRoomModelMarkdown,
        vaultRoot: input.vaultRoot,
      });
      redactedLogEntries.push(
        emitHostedGroupRoomModelSeedLifecycleLog({
          message: "Hosted group room model activation seed applied.",
          outcome: result.kind,
          wake: input.wake,
        }),
      );
    } catch (error) {
      redactedLogEntries.push(
        emitHostedGroupRoomModelSeedLifecycleLog({
          error,
          level: "warn",
          message: "Hosted group room model activation seed will retry.",
          outcome: "unavailable",
          wake: input.wake,
        }),
      );
      throw error;
    }
  }

  const signupWelcome = input.wake.signupWelcome;
  if (!signupWelcome) {
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "member-activated",
      redactedLogEntries,
    });
  }

  redactedLogEntries.push(
    emitHostedMemberActivationSignupWelcomeLifecycleLog({
      message: "Hosted member activation signup welcome started.",
      phase: "wake.running",
      wake: input.wake,
    }),
  );
  let seededOnboardingFollowupWakeAt: string | null = null;
  let notificationDecisionKind: string | null = null;

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
    notificationDecisionKind = notificationResult?.decision.kind ?? null;
    seededOnboardingFollowupWakeAt = await maybeSeedOnboardingFollowupAutomation({
      logDetails: buildHostedMemberActivationSignupWelcomeLogDetails(input.wake),
      notificationResult,
      redactedLogEntries,
      route: signupWelcome.route,
      stableKey: input.wake.userId,
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
      extraDetails: { notificationDecisionKind },
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
  let notificationDecisionKind: string | null = null;
  let deliveryIntentIds: string[] = [];

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
    notificationDecisionKind = notificationResult?.decision.kind ?? null;
    const deliveryOutcome = notificationResult?.deliveryOutcome ?? null;
    const deliveryIntentId =
      deliveryOutcome && "intentId" in deliveryOutcome
        ? deliveryOutcome.intentId
        : null;
    deliveryIntentIds = deliveryIntentId ? [deliveryIntentId] : [];
    if (isHostedSignupWelcomeNotification(input.wake)) {
      seededOnboardingFollowupWakeAt = await maybeSeedOnboardingFollowupAutomation({
        logDetails: buildHostedAssistantNotificationLogDetails(input.wake),
        notificationResult,
        redactedLogEntries,
        route: input.wake.notification.route,
        stableKey: input.wake.userId,
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
      extraDetails: { notificationDecisionKind },
      message: "Hosted assistant notification finished.",
      phase: "wake.running",
      wake: input.wake,
    }),
  );

  return createNoopMailboxEffect({
    conversationMetrics: null,
    deliveryIntentIds,
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
  stableKey: string;
  vaultRoot: string;
  wake: HostedExecutionSystemWake;
}): Promise<string | null> {
  if (
    !didAssistantNotificationAcceptDelivery(input.notificationResult)
    && !wasAssistantNotificationSupersededByPriorFirstContact(input.notificationResult)
  ) {
    return null;
  }

  try {
    // Route deliverability (e.g. Linq participant routes without a Linq
    // delivery source) is enforced by upsertAssistantCronAutomation's target
    // validation; an undeliverable route lands in the catch below.
    const job = await upsertAssistantCronAutomation({
      firstOccurrenceActiveDayCount:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.opportunityDays,
      firstOccurrenceActiveUntilLocalTime:
        MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.activeUntilLocalTime,
      firstOccurrencePolicy: "after-current-local-day",
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      route: buildOnboardingFollowupAutomationRoute(input.route),
      schedule: resolveMurphOnboardingFollowupSchedule(input.stableKey),
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vault: input.vaultRoot,
    });
    try {
      input.redactedLogEntries.push(
        emitHostedOnboardingFollowupSeededLog({
          details: input.logDetails,
          job,
          wake: input.wake,
        }),
      );
    } catch {
      // This diagnostic must never turn a successful canonical upsert into a
      // failed onboarding-follow-up seed.
    }
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

function emitHostedOnboardingFollowupSeededLog(input: {
  details: HostedExecutionStructuredLogDetails;
  job: Awaited<ReturnType<typeof upsertAssistantCronAutomation>>;
  wake: HostedExecutionSystemWake;
}): HostedExecutionRedactedLogEntry {
  const details = {
    ...input.details,
    eventCode: "assistant.onboarding_followup_seeded",
    onboardingFollowupEnabled: input.job?.enabled === true,
    onboardingFollowupNextRunAt: input.job?.state.nextRunAt ?? null,
    onboardingFollowupOpportunityDays:
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.opportunityDays,
    onboardingFollowupScheduleKind: input.job?.schedule?.kind ?? null,
  };

  emitHostedExecutionStructuredLog({
    component: "runtime",
    details,
    level: "info",
    message: "Hosted onboarding follow-up automation seeded.",
    phase: "wake.running",
    wake: input.wake,
  });

  return {
    component: "runtime",
    eventId: input.wake.eventId,
    level: "info",
    message: "Hosted onboarding follow-up automation seeded.",
    phase: "wake.running",
    redacted: details,
  };
}

function didAssistantNotificationAcceptDelivery(
  result: AssistantNotificationResult | undefined,
): boolean {
  const outcomeKind = result?.deliveryOutcome?.kind;
  return outcomeKind === "sent" || outcomeKind === "queued";
}

// A signup-welcome turn only skips when first contact was already accepted on
// this route (the user is mid-conversation). Onboarding is underway in that
// case, so the follow-up automation must still be seeded; it self-archives
// once onboarding completes and the upsert is idempotent by slug.
function wasAssistantNotificationSupersededByPriorFirstContact(
  result: AssistantNotificationResult | undefined,
): boolean {
  return result?.decision.kind === "skip";
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
      threadIsDirect: route.threadIsDirect,
    };
  }

  return {
    channel: route.channel,
    deliverySource: delivery.source ?? null,
    deliveryTarget: delivery.kind === "participant" ? null : delivery.target,
    identityId: route.identityId,
    participantId: delivery.kind === "participant" ? delivery.target : null,
    threadId: route.threadId,
    threadIsDirect: route.threadIsDirect,
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
      (
        wake.notification.notificationPromptProfile === "creative-response"
        || wake.notification.notificationPromptProfile ===
          "creative-response-text"
      )
      || wake.notification.firstContact != null
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
  extraDetails?: HostedExecutionStructuredLogDetails;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionRedactedLogEntry {
  return emitHostedNotificationLifecycleLog({
    ...input,
    details: {
      ...buildHostedAssistantNotificationLogDetails(input.wake),
      ...(input.extraDetails ?? {}),
    },
  });
}

function emitHostedMemberActivationSignupWelcomeLifecycleLog(input: {
  error?: unknown;
  extraDetails?: HostedExecutionStructuredLogDetails;
  level?: HostedExecutionLogLevel;
  message: string;
  phase: HostedExecutionLogPhase;
  wake: HostedExecutionMemberActivatedWake;
}): HostedExecutionRedactedLogEntry {
  return emitHostedNotificationLifecycleLog({
    ...input,
    details: {
      ...buildHostedMemberActivationSignupWelcomeLogDetails(input.wake),
      ...(input.extraDetails ?? {}),
    },
  });
}

function emitHostedGroupRoomModelSeedLifecycleLog(input: {
  error?: unknown;
  level?: HostedExecutionLogLevel;
  message: string;
  outcome: "already_initialized" | "initialized" | "unavailable";
  wake: HostedExecutionMemberActivatedWake;
}): HostedExecutionRedactedLogEntry {
  return emitHostedNotificationLifecycleLog({
    details: {
      eventCode: "assistant.group_room_model_activation_seed",
      outcome: input.outcome,
    },
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.level === undefined ? {} : { level: input.level }),
    message: input.message,
    phase: "wake.running",
    wake: input.wake,
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
  const privateAssistantAskCompletion =
    wake.notification.privateAssistantAskCompletion ?? null;
  if (privateAssistantAskCompletion) {
    requireHostedPrivateAssistantAskCompletionNotification(wake);
  }
  return buildAssistantNotificationInputFromRoute({
    assistantTurnOrdinal: "assistant-notification:1",
    deliveryDedupeToken: wake.notification.deliveryDedupeToken ?? null,
    deliveryDispatchMode: forceQueueOnly
      ? "queue-only"
      : wake.notification.deliveryDispatchMode ?? undefined,
    deliveryIdempotencyKey: wake.notification.deliveryIdempotencyKey ?? null,
    executionContext,
    ...(wake.notification.externalThreadRouteAuthority
      ? {
          externalThreadRouteAuthority:
            wake.notification.externalThreadRouteAuthority,
        }
      : {}),
    firstContactPolicy: wake.notification.firstContact
      ? {
          markSeenOnDeliveryAccepted:
            wake.notification.firstContact.markSeenOnDeliveryAccepted,
        }
      : null,
    instructions: wake.notification.instructions,
    logDetails: buildHostedAssistantNotificationLogDetails(wake),
    ...(wake.notification.notificationPromptProfile
      ? {
          notificationPromptProfile:
            wake.notification.notificationPromptProfile,
        }
      : {}),
    recordLogEntry,
    responsePolicy: wake.notification.responsePolicy ?? null,
    ...(privateAssistantAskCompletion
      ? {
          answeredMailboxItemIds: [wake.eventId],
          reviewedAssistantAskCompletionExpiresAt:
            privateAssistantAskCompletion.expiresAt,
        }
      : {}),
    route: wake.notification.route,
    sourceMailboxItemId,
    turnEnvironment,
    turnTrigger: "manual-deliver",
    vault,
    wake,
  });
}

function buildAssistantNotificationInputFromRoute(input: {
  answeredMailboxItemIds?: AssistantNotificationInput["answeredMailboxItemIds"];
  assistantTurnOrdinal: string;
  deliveryDedupeToken: AssistantNotificationInput["deliveryDedupeToken"];
  deliveryDispatchMode: AssistantNotificationInput["deliveryDispatchMode"];
  deliveryIdempotencyKey: AssistantNotificationInput["deliveryIdempotencyKey"];
  executionContext: AssistantExecutionContext;
  externalThreadRouteAuthority?:
    AssistantNotificationInput["outboxExternalThreadRouteAuthority"];
  firstContactPolicy: AssistantNotificationInput["firstContactPolicy"];
  instructions: string;
  logDetails: HostedExecutionStructuredLogDetails;
  notificationPromptProfile?: AssistantNotificationInput["notificationPromptProfile"];
  recordLogEntry: (entry: HostedExecutionRedactedLogEntry) => void;
  responsePolicy: AssistantNotificationInput["responsePolicy"];
  reviewedAssistantAskCompletionExpiresAt?:
    AssistantNotificationInput["reviewedAssistantAskCompletionExpiresAt"];
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
    ...(input.answeredMailboxItemIds
      ? { answeredMailboxItemIds: input.answeredMailboxItemIds }
      : {}),
    bindingDeliveryTarget: resolveAssistantNotificationBindingDeliveryTarget({
      executionContext: input.executionContext,
      externalThreadRouteAuthority: input.externalThreadRouteAuthority ?? null,
      route,
      wake: input.wake,
    }),
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
    ...(input.notificationPromptProfile
      ? { notificationPromptProfile: input.notificationPromptProfile }
      : {}),
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
    ...(input.externalThreadRouteAuthority
      ? {
          outboxExternalThreadRouteAuthority:
            input.externalThreadRouteAuthority,
        }
      : {}),
    responsePolicy: input.responsePolicy,
    ...(input.reviewedAssistantAskCompletionExpiresAt
      ? {
          reviewedAssistantAskCompletionExpiresAt:
            input.reviewedAssistantAskCompletionExpiresAt,
        }
      : {}),
    threadId: route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnEnvironment: input.turnEnvironment,
    turnTrigger: input.turnTrigger,
    vault: input.vault,
  };
}

function requireHostedPrivateAssistantAskCompletionNotification(
  wake: HostedExecutionAssistantNotificationRequestedWake,
): void {
  const completion = wake.notification.privateAssistantAskCompletion;
  const expectedDeliveryKey =
    createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
      wake.eventId,
    );
  if (
    !completion
    || !Number.isFinite(Date.parse(completion.expiresAt))
    || wake.notification.deliveryDedupeToken !== expectedDeliveryKey
    || wake.notification.deliveryIdempotencyKey !== expectedDeliveryKey
    || wake.notification.deliveryDispatchMode !== "queue-only"
    || wake.notification.externalThreadRouteAuthority != null
    || wake.notification.firstContact != null
    || wake.notification.notificationPromptProfile != null
    || wake.notification.route.threadIsDirect !== true
    || (
      wake.notification.route.channel !== "linq"
      && wake.notification.route.channel !== "telegram"
    )
    || wake.notification.responsePolicy?.kind !== "require_send_exact_text"
  ) {
    throw new TypeError(
      "Hosted private Assistant Ask completion notification proof is invalid.",
    );
  }
}

function resolveAssistantNotificationBindingDeliveryTarget(input: {
  executionContext: AssistantExecutionContext;
  externalThreadRouteAuthority:
    AssistantNotificationInput["outboxExternalThreadRouteAuthority"] | null;
  route: HostedExecutionAssistantNotificationRoute;
  wake: HostedRuntimeEvent;
}): string | null {
  const delivery = input.route.delivery;
  if (delivery.kind !== "explicit") {
    return delivery.target;
  }

  const authority = input.externalThreadRouteAuthority;
  const hostedMemberId = input.executionContext.hosted?.memberId ?? null;
  return (
    authority
    && hostedMemberId
    && input.wake.userId === hostedMemberId
    && authority.containerMemberId === hostedMemberId
    && authority.channel === input.route.channel
    && input.route.threadIsDirect === true
    && authority.threadId === delivery.target
  )
    ? delivery.target
    : null;
}

function readLegacyHostedUsageReferralDirectLinqAuthority(input: {
  executionContext: AssistantExecutionContext;
  mailboxDedupeKey: string;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedExecutionExternalThreadRouteAuthority | null {
  if (classifyLegacyHostedUsageReferralDirectLinqAuthority(input) !== "eligible") {
    return null;
  }

  const delivery = input.wake.notification.route.delivery;
  return {
    channel: "linq",
    containerMemberId: input.wake.userId,
    threadId: delivery.target,
  };
}

export function classifyLegacyHostedUsageReferralDirectLinqAuthority(input: {
  executionContext: AssistantExecutionContext;
  mailboxDedupeKey: string;
  wake: HostedExecutionAssistantNotificationRequestedWake;
}): HostedLegacyUsageReferralAuthorityClassification {
  const { notification, userId } = input.wake;
  const route = notification.route;
  const delivery = route.delivery;
  const notificationKey = notification.deliveryDedupeToken;
  const target = delivery.target.trim();

  if (
    typeof notificationKey !== "string"
    || !notificationKey.startsWith(
      HOSTED_USAGE_REFERRAL_NOTIFICATION_KEY_PREFIX,
    )
    || notificationKey.length
      === HOSTED_USAGE_REFERRAL_NOTIFICATION_KEY_PREFIX.length
    || notificationKey !== notificationKey.trim()
  ) {
    return "not_usage_referral";
  }

  if (
    input.mailboxDedupeKey
      !== `${HOSTED_ASSISTANT_NOTIFICATION_EVENT_PREFIX}${notificationKey}`
    || input.wake.eventId !== input.mailboxDedupeKey
    || notification.deliveryIdempotencyKey !== notificationKey
  ) {
    return "identity_mismatch";
  }

  if (
    notification.deliveryDispatchMode !== "queue-only"
    || notification.externalThreadRouteAuthority != null
    || notification.firstContact != null
    || notification.notificationPromptProfile != null
    || notification.responsePolicy?.kind !== "require_send"
  ) {
    return "policy_mismatch";
  }

  if (input.executionContext.hosted?.memberId !== userId) {
    return "member_mismatch";
  }

  if (
    route.channel !== "linq"
    || route.threadIsDirect !== true
    || delivery.kind !== "explicit"
    || delivery.source != null
    || target.length === 0
    || target !== delivery.target
  ) {
    return "route_mismatch";
  }

  return "eligible";
}

function isHostedThreadRouteEgressUnauthorizedError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED"
    && "retryable" in error
    && error.retryable === false;
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
