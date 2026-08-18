import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { Prisma, type HostedLinqAlert, type PrismaClient } from "@prisma/client";

import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import type { HostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
} from "../hosted-onboarding/resend-plain-text-email";
import { normalizeNullableString } from "../primitives";

export const HOSTED_OPERATIONAL_ALERT_MINIMUM_INTERVAL_MS = 10 * 60_000;

const HOSTED_OPERATIONAL_ALERT_JITTER_WINDOW_MS = 10 * 60_000;
const HOSTED_OPERATIONAL_ALERT_SEND_LEASE_MS = 4 * 60_000;
const HOSTED_OPERATIONAL_ALERT_QUIET_HOURS_END_HOUR = 7;
const HOSTED_OPERATIONAL_ALERT_QUIET_HOURS_START_HOUR = 23;

export type HostedOperationalAlertPrismaClient = Pick<
  PrismaClient,
  "hostedLinqAlert"
>;

export type HostedOperationalAlertSend = typeof sendHostedResendPlainTextEmail;

export type HostedOperationalAlertMonitorOutcome =
  | "alert_sent"
  | "coalesced"
  | "deferred_quiet_hours"
  | "deferred_rate_limit"
  | "healthy"
  | "incident_active";

interface HostedOperationalAlertHealth {
  anomalous: boolean;
}

export type HostedOperationalAlertNotificationKind = "alert" | "reminder";

export interface HostedOperationalAlertNotification {
  idempotencyKeySuffix: string;
  kind: HostedOperationalAlertNotificationKind;
}

export interface HostedOperationalAlertMonitorSpec<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
> {
  buildDetails(input: {
    health: Health;
    incidentId: string | null;
    message?: string | null;
    notification?: HostedOperationalAlertNotification | null;
    now: Date;
    phase: "alert" | "healthy";
  }): Prisma.InputJsonObject;
  buildMessage(input: {
    health: Health;
    notificationKind: HostedOperationalAlertNotificationKind;
    now: Date;
  }): string;
  error: {
    incidentInvalidCode: string;
    incidentInvalidMessage: string;
    messageInvalidCode: string;
    messageInvalidMessage: string;
    sendFailedCode: string;
    sendFailedMessage: string;
    stateInvalidCode: string;
    stateInvalidMessage: string;
    unknownSendErrorCode: string;
  };
  id: string;
  idempotencyScope: string;
  kind: string;
  readHealth(input: { now: Date; prisma: Client }): Promise<Health>;
  reminderIntervalMs?: number;
  status: {
    alertFailed: string;
    alertSending: string;
    alerting: string;
    healthy: string;
  };
  subject: string;
}

export async function runHostedOperationalEmailIncident<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  alertConfig: {
    email: HostedOperationalAlertEmailConfig;
    timeZone: string;
  };
  initialHealth: Health;
  initialNow: Date;
  now?: Date;
  prisma: Client;
  sendAlert?: HostedOperationalAlertSend;
  signal?: AbortSignal;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
}): Promise<{
  health: Health;
  outcome: HostedOperationalAlertMonitorOutcome;
}> {
  const state = await ensureHostedOperationalAlertState({
    health: input.initialHealth,
    now: input.initialNow,
    prisma: input.prisma,
    spec: input.spec,
  });
  const transition = await prepareHostedOperationalAlertTransition({
    health: input.initialHealth,
    now: input.initialNow,
    prisma: input.prisma,
    spec: input.spec,
    state,
    timeZone: input.alertConfig.timeZone,
  });

  if (!transition.candidateState) {
    return {
      health: input.initialHealth,
      outcome: transition.outcome,
    };
  }

  const admission = await claimHostedOperationalAlertSend({
    now: input.now,
    prisma: input.prisma,
    spec: input.spec,
    state: transition.candidateState,
    timeZone: input.alertConfig.timeZone,
  });
  if (!admission.action) {
    return {
      health: admission.health,
      outcome: admission.outcome,
    };
  }

  const sendAlert = input.sendAlert ?? sendHostedResendPlainTextEmail;
  const action = admission.action;
  try {
    const sent = await sendAlert({
      config: input.alertConfig.email.resend,
      idempotencyKey:
        `${input.spec.idempotencyScope}/${action.incidentId}/${action.idempotencyKeySuffix}`,
      signal: input.signal,
      subject: input.spec.subject,
      text: action.message,
      to: input.alertConfig.email.recipients,
    });
    await completeHostedOperationalAlertTransition({
      attemptedAt: action.attemptedAt,
      completedAt: input.now ?? new Date(),
      prisma: input.prisma,
      providerMessageId: sent.providerMessageId,
      spec: input.spec,
    });
  } catch (error) {
    const failure = readHostedOperationalAlertFailure({
      error,
      unknownErrorCode: input.spec.error.unknownSendErrorCode,
    });
    await failHostedOperationalAlertTransition({
      attemptedAt: action.attemptedAt,
      errorCode: failure.errorCode,
      prisma: input.prisma,
      providerStatus: failure.providerStatus,
      spec: input.spec,
    });
    throw hostedOnboardingError({
      code: input.spec.error.sendFailedCode,
      httpStatus: 502,
      message: input.spec.error.sendFailedMessage,
      retryable: true,
    });
  }

  return {
    health: admission.health,
    outcome: "alert_sent",
  };
}

async function ensureHostedOperationalAlertState<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  health: Health;
  now: Date;
  prisma: Client;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
}): Promise<HostedLinqAlert> {
  const state = await input.prisma.hostedLinqAlert.upsert({
    where: {
      id: input.spec.id,
    },
    create: {
      claimedAt: input.now,
      detailsJson: input.spec.buildDetails({
        health: input.health,
        incidentId: null,
        now: input.now,
        phase: "healthy",
      }),
      id: input.spec.id,
      kind: input.spec.kind,
      status: input.spec.status.healthy,
      subject: input.spec.subject,
    },
    update: {},
  });

  if (
    state.kind !== input.spec.kind
    || !isHostedOperationalAlertMonitorStatus({
      spec: input.spec,
      value: state.status,
    })
  ) {
    throw hostedOnboardingError({
      code: input.spec.error.stateInvalidCode,
      httpStatus: 500,
      message: input.spec.error.stateInvalidMessage,
    });
  }

  return state;
}

async function prepareHostedOperationalAlertTransition<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  health: Health;
  now: Date;
  prisma: Client;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  state: HostedLinqAlert;
  timeZone: string;
}): Promise<{
  candidateState: HostedLinqAlert | null;
  outcome: Exclude<HostedOperationalAlertMonitorOutcome, "alert_sent">;
}> {
  if (input.health.anomalous) {
    if (input.state.status === input.spec.status.alerting) {
      const reminderDueAtMs = readHostedOperationalAlertReminderDueAtMs({
        spec: input.spec,
        state: input.state,
      });
      if (
        reminderDueAtMs === null
        || input.now.getTime() < reminderDueAtMs
      ) {
        return { candidateState: null, outcome: "incident_active" };
      }
    }
    const deferred = readHostedOperationalAlertDeferral({
      now: input.now,
      spec: input.spec,
      state: input.state,
      timeZone: input.timeZone,
    });
    if (deferred) {
      return { candidateState: null, outcome: deferred };
    }

    return { candidateState: input.state, outcome: "coalesced" };
  }

  if (input.state.status === input.spec.status.healthy) {
    return { candidateState: null, outcome: "healthy" };
  }
  if (
    input.state.status === input.spec.status.alertSending
    && !isHostedOperationalAlertSendLeaseExpired(input.state, input.now)
  ) {
    return { candidateState: null, outcome: "coalesced" };
  }

  const cleared = await input.prisma.hostedLinqAlert.updateMany({
    where: buildHostedOperationalAlertStateCompare({
      spec: input.spec,
      state: input.state,
    }),
    data: {
      detailsJson: input.spec.buildDetails({
        health: input.health,
        incidentId: null,
        now: input.now,
        phase: "healthy",
      }),
      status: input.spec.status.healthy,
    },
  });
  return {
    candidateState: null,
    outcome: cleared.count === 1 ? "healthy" : "coalesced",
  };
}

async function claimHostedOperationalAlertSend<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  now?: Date;
  prisma: Client;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  state: HostedLinqAlert;
  timeZone: string;
}): Promise<
  | {
      action: HostedOperationalAlertClaimedAction;
      health: Health;
      outcome: null;
    }
  | {
      action: null;
      health: Health;
      outcome: "coalesced" | "deferred_quiet_hours" | "healthy";
    }
> {
  const healthCheckedAt = input.now ?? new Date();
  const health = await input.spec.readHealth({
    now: healthCheckedAt,
    prisma: input.prisma,
  });

  if (!health.anomalous) {
    const recoveryCheckedAt = input.now ?? new Date();
    const cleared = await input.prisma.hostedLinqAlert.updateMany({
      where: buildHostedOperationalAlertStateCompare({
        spec: input.spec,
        state: input.state,
      }),
      data: {
        detailsJson: input.spec.buildDetails({
          health,
          incidentId: null,
          now: recoveryCheckedAt,
          phase: "healthy",
        }),
        status: input.spec.status.healthy,
      },
    });
    return {
      action: null,
      health,
      outcome: cleared.count === 1 ? "healthy" : "coalesced",
    };
  }

  const admissionCheckedAt = input.now ?? new Date();
  if (isHostedOperationalAlertQuietTime({
    now: admissionCheckedAt,
    spec: input.spec,
    timeZone: input.timeZone,
  })) {
    return {
      action: null,
      health,
      outcome: "deferred_quiet_hours",
    };
  }

  const incidentId = input.state.status === input.spec.status.healthy
    ? randomUUID()
    : readHostedOperationalAlertIncidentId(input.state);
  if (!incidentId) {
    throw hostedOnboardingError({
      code: input.spec.error.incidentInvalidCode,
      httpStatus: 500,
      message: input.spec.error.incidentInvalidMessage,
    });
  }

  const notification = readHostedOperationalAlertNotificationForClaim({
    spec: input.spec,
    state: input.state,
  });
  const retrying = input.state.status === input.spec.status.alertSending
    || input.state.status === input.spec.status.alertFailed;
  const message = retrying
    ? readHostedOperationalAlertMessage(input.state)
    : input.spec.buildMessage({
        health,
        notificationKind: notification.kind,
        now: admissionCheckedAt,
      });
  if (!message) {
    throw hostedOnboardingError({
      code: input.spec.error.messageInvalidCode,
      httpStatus: 500,
      message: input.spec.error.messageInvalidMessage,
    });
  }

  const claimed = await input.prisma.hostedLinqAlert.updateMany({
    where: buildHostedOperationalAlertStateCompare({
      spec: input.spec,
      state: input.state,
    }),
    data: {
      attemptCount: {
        increment: 1,
      },
      claimedAt: admissionCheckedAt,
      detailsJson: input.spec.buildDetails({
        health,
        incidentId,
        message,
        notification,
        now: admissionCheckedAt,
        phase: "alert",
      }),
      lastAttemptedAt: admissionCheckedAt,
      lastErrorCode: null,
      lastProviderStatus: null,
      status: input.spec.status.alertSending,
    },
  });

  if (claimed.count !== 1) {
    return { action: null, health, outcome: "coalesced" };
  }
  return {
    action: {
      attemptedAt: admissionCheckedAt,
      idempotencyKeySuffix: notification.idempotencyKeySuffix,
      incidentId,
      message,
    },
    health,
    outcome: null,
  };
}

interface HostedOperationalAlertClaimedAction {
  attemptedAt: Date;
  idempotencyKeySuffix: string;
  incidentId: string;
  message: string;
}

async function completeHostedOperationalAlertTransition<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  attemptedAt: Date;
  completedAt: Date;
  prisma: Client;
  providerMessageId: string | null;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
}): Promise<void> {
  await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: input.spec.id,
      lastAttemptedAt: input.attemptedAt,
      status: input.spec.status.alertSending,
    },
    data: {
      lastErrorCode: null,
      lastProviderStatus: null,
      providerMessageId: input.providerMessageId,
      sentAt: input.completedAt,
      status: input.spec.status.alerting,
    },
  });
}

async function failHostedOperationalAlertTransition<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  attemptedAt: Date;
  errorCode: string;
  prisma: Client;
  providerStatus: number | null;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
}): Promise<void> {
  await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: input.spec.id,
      lastAttemptedAt: input.attemptedAt,
      status: input.spec.status.alertSending,
    },
    data: {
      lastErrorCode: input.errorCode,
      lastProviderStatus: input.providerStatus,
      status: input.spec.status.alertFailed,
    },
  });
}

function buildHostedOperationalAlertStateCompare<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  state: HostedLinqAlert;
}) {
  return {
    id: input.spec.id,
    status: input.state.status,
    updatedAt: input.state.updatedAt,
  };
}

function readHostedOperationalAlertIncidentId(
  state: HostedLinqAlert,
): string | null {
  const details = readJsonObject(state.detailsJson);
  return details
    ? normalizeNullableString(readJsonString(details.incidentId))
    : null;
}

function readHostedOperationalAlertMessage(
  state: HostedLinqAlert,
): string | null {
  const details = readJsonObject(state.detailsJson);
  return details
    ? normalizeNullableString(readJsonString(details.message))
    : null;
}

function readHostedOperationalAlertNotificationForClaim<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  state: HostedLinqAlert;
}): HostedOperationalAlertNotification {
  if (input.state.status === input.spec.status.alerting) {
    if (
      input.spec.reminderIntervalMs === undefined
      || input.state.sentAt === null
    ) {
      throw hostedOnboardingError({
        code: input.spec.error.incidentInvalidCode,
        httpStatus: 500,
        message: input.spec.error.incidentInvalidMessage,
      });
    }
    return {
      idempotencyKeySuffix: `reminder/${input.state.sentAt.getTime()}`,
      kind: "reminder",
    };
  }

  if (
    input.state.status !== input.spec.status.alertSending
    && input.state.status !== input.spec.status.alertFailed
  ) {
    return {
      idempotencyKeySuffix: "alert",
      kind: "alert",
    };
  }

  const persisted = readHostedOperationalAlertNotification(input.state);
  if (persisted === undefined) {
    return {
      idempotencyKeySuffix: "alert",
      kind: "alert",
    };
  }
  if (
    persisted === null
    || (
      persisted.kind === "reminder"
      && (
        input.spec.reminderIntervalMs === undefined
        || input.state.sentAt === null
        || persisted.idempotencyKeySuffix
          !== `reminder/${input.state.sentAt.getTime()}`
      )
    )
  ) {
    throw hostedOnboardingError({
      code: input.spec.error.stateInvalidCode,
      httpStatus: 500,
      message: input.spec.error.stateInvalidMessage,
    });
  }
  return persisted;
}

function readHostedOperationalAlertNotification(
  state: HostedLinqAlert,
): HostedOperationalAlertNotification | null | undefined {
  const details = readJsonObject(state.detailsJson);
  if (!details || details.notification === undefined) {
    return undefined;
  }
  const notification = readJsonObject(details.notification);
  if (!notification) {
    return null;
  }
  const kind = readJsonString(notification.kind);
  const idempotencyKeySuffix = normalizeNullableString(
    readJsonString(notification.idempotencyKeySuffix),
  );
  if (
    kind === "alert"
    && idempotencyKeySuffix === "alert"
  ) {
    return { idempotencyKeySuffix, kind };
  }
  if (
    kind === "reminder"
    && idempotencyKeySuffix !== null
    && /^reminder\/\d+$/u.test(idempotencyKeySuffix)
  ) {
    return { idempotencyKeySuffix, kind };
  }
  return null;
}

function readHostedOperationalAlertFailure(input: {
  error: unknown;
  unknownErrorCode: string;
}): {
  errorCode: string;
  providerStatus: number | null;
} {
  const value = input.error instanceof HostedResendPlainTextEmailError
    ? input.error.code
    : isHostedOnboardingError(input.error)
      ? input.error.code
      : input.error instanceof Error
        ? input.error.name
        : input.unknownErrorCode;
  return {
    errorCode: value.slice(0, 128),
    providerStatus: input.error instanceof HostedResendPlainTextEmailError
      ? input.error.providerStatus
      : null,
  };
}

function isHostedOperationalAlertSendLeaseExpired(
  state: HostedLinqAlert,
  now: Date,
): boolean {
  return state.lastAttemptedAt === null
    || state.lastAttemptedAt.getTime()
      <= now.getTime() - HOSTED_OPERATIONAL_ALERT_SEND_LEASE_MS;
}

function readHostedOperationalAlertDeferral<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  now: Date;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  state: HostedLinqAlert;
  timeZone: string;
}): "coalesced" | "deferred_quiet_hours" | "deferred_rate_limit" | null {
  if (isHostedOperationalAlertQuietTime({
    now: input.now,
    spec: input.spec,
    timeZone: input.timeZone,
  })) {
    return "deferred_quiet_hours";
  }

  const lastActivityAt = laterDate(
    input.state.lastAttemptedAt,
    input.state.sentAt,
  );
  if (lastActivityAt === null) {
    return null;
  }
  const jitterMs = stableHostedOperationalAlertJitterMs(
    `${input.spec.id}:attempt:${lastActivityAt.toISOString()}`,
  );
  const nextAttemptAtMs = lastActivityAt.getTime()
    + HOSTED_OPERATIONAL_ALERT_MINIMUM_INTERVAL_MS
    + jitterMs;
  if (input.now.getTime() >= nextAttemptAtMs) {
    return null;
  }
  return input.state.status === input.spec.status.alertSending
    ? "coalesced"
    : "deferred_rate_limit";
}

function readHostedOperationalAlertReminderDueAtMs<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  state: HostedLinqAlert;
}): number | null {
  const intervalMs = input.spec.reminderIntervalMs;
  if (intervalMs === undefined) {
    return null;
  }
  if (
    !Number.isSafeInteger(intervalMs)
    || intervalMs <= 0
    || input.state.sentAt === null
  ) {
    throw hostedOnboardingError({
      code: input.spec.error.stateInvalidCode,
      httpStatus: 500,
      message: input.spec.error.stateInvalidMessage,
    });
  }
  const jitterMs = stableHostedOperationalAlertJitterMs(
    `${input.spec.id}:reminder:${input.state.sentAt.toISOString()}`,
  );
  return input.state.sentAt.getTime() + intervalMs + jitterMs;
}

function isHostedOperationalAlertQuietTime<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  now: Date;
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  timeZone: string;
}): boolean {
  const local = formatTimeZoneDateTimeParts(input.now, input.timeZone);
  if (
    local.hour >= HOSTED_OPERATIONAL_ALERT_QUIET_HOURS_START_HOUR
    || local.hour < HOSTED_OPERATIONAL_ALERT_QUIET_HOURS_END_HOUR
  ) {
    return true;
  }
  if (local.hour > HOSTED_OPERATIONAL_ALERT_QUIET_HOURS_END_HOUR) {
    return false;
  }

  const wakeJitterMs = stableHostedOperationalAlertJitterMs(
    `${input.spec.id}:wake:${input.timeZone}:${local.dayKey}`,
  );
  const elapsedSinceWakeMs = (local.minute * 60 + local.second) * 1_000;
  return elapsedSinceWakeMs < wakeJitterMs;
}

function stableHostedOperationalAlertJitterMs(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return 1 + (
    digest.readUInt32BE(0) % HOSTED_OPERATIONAL_ALERT_JITTER_WINDOW_MS
  );
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left.getTime() >= right.getTime() ? left : right;
}

function isHostedOperationalAlertMonitorStatus<
  Health extends HostedOperationalAlertHealth,
  Client extends HostedOperationalAlertPrismaClient,
>(input: {
  spec: HostedOperationalAlertMonitorSpec<Health, Client>;
  value: string;
}): boolean {
  return Object.values(input.spec.status).some(
    (status) => status === input.value,
  );
}

function readJsonObject(value: Prisma.JsonValue): Prisma.JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function readJsonString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}
