import { createHmac } from "node:crypto";
import { rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  findEventByExternalRef,
  initializeVault,
  upsertScheduledLog,
} from "@murphai/core";
import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from "@murphai/operator-config/assistant-cli-contracts";
import type { ScheduledLogQueryRecord } from "@murphai/query";

import {
  normalizeCanonicalScheduledLogCronRecord,
  runScheduledLogCronJob,
} from "../src/assistant/cron/scheduled-log.js";
import {
  createAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from "../src/assistant/cron/runtime-state.js";
import {
  getAssistantCronJob,
  processDueAssistantCronJobsLocal,
} from "../src/assistant-cron.js";
import { resolveAssistantStatePaths } from "../src/assistant/store/paths.js";
import {
  HOSTED_AI_USAGE_REPORTING_SECRET_ENV,
  createAssistantUsageAttribution,
  createAssistantUsageReportingUserId,
  normalizeAssistantUsageGatewayTags,
  resolveAssistantUsageEnvironment,
  resolveAssistantUsageFeatureKey,
  resolveAssistantUsageReportingSecret,
  resolveAssistantUsageSurface,
  resolveAssistantUsageTriggerKind,
} from "../src/assistant/usage-attribution.js";
import { createTempVaultContext } from "./test-helpers.ts";

function buildAssistantSession(channel: string | null): AssistantSession {
  return parseAssistantSessionRecord({
    schema: "murph.assistant-session.v1",
    sessionId: "session_usage_surface_1",
    target: {
      adapter: "codex-cli",
      approvalPolicy: null,
      codexHome: null,
      model: "gpt-5-codex",
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
    },
    resumeState: null,
    alias: null,
    binding: {
      conversationKey: null,
      channel,
      identityId: "identity-1",
      actorId: "actor-1",
      threadId: "thread-1",
      threadIsDirect: true,
      delivery: null,
    },
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:00:00.000Z",
    lastTurnAt: null,
    turnCount: 0,
  });
}

function buildScheduledLogRecord(input: {
  schedule: ScheduledLogQueryRecord["schedule"];
  status: ScheduledLogQueryRecord["status"];
  title: string;
}): ScheduledLogQueryRecord {
  return {
    schemaVersion: "murph.frontmatter.scheduled-log.v1",
    docType: "scheduled_log",
    scheduledLogId: "slog_01JX8VBQY2M5ZBV64ZP4N1DRBB",
    slug: "daily-mobility",
    title: input.title,
    status: input.status,
    summary: "Keep the routine moving.",
    schedule: input.schedule,
    action: {
      kind: "activity_session.add",
      title: "Mobility",
      activityType: "mobility",
      durationMinutes: 15,
    },
    tags: ["movement"],
    createdAt: "2026-04-22T06:00:00.000Z",
    updatedAt: "2026-04-22T06:05:00.000Z",
    body: "Mobility session body.",
    relativePath: "bank/scheduled-logs/daily-mobility.md",
    markdown: "scheduled log markdown",
  };
}

async function writeScheduledLogRetryRuntime(input: {
  activatedAt: string;
  jobId: string;
  occurrenceAt: string;
  retryAfterAt: string;
  runningAt?: string;
  updatedAt: string;
  vaultRoot: string;
}): Promise<void> {
  const record = createAssistantCronCanonicalRuntimeRecord({
    activatedAt: input.activatedAt,
    jobId: input.jobId,
    now: input.activatedAt,
  });
  record.updatedAt = input.updatedAt;
  record.state.lastRunAt = input.occurrenceAt;
  record.state.pendingOccurrenceAt = input.occurrenceAt;
  record.state.retryAfterAt = input.retryAfterAt;
  record.state.runningAt = input.runningAt ?? null;
  await writeAssistantCronCanonicalRuntimeStore(
    resolveAssistantStatePaths(input.vaultRoot),
    { version: 1, jobs: [record] },
  );
}

describe("assistant usage attribution", () => {
  it("normalizes usage attribution payloads and reporting identifiers", () => {
    const attribution = createAssistantUsageAttribution({
      credentialSource: "platform",
      environment: " Preview ",
      featureKey: " Assistant Reply ",
      memberId: "member_123",
      reportingSecret: "reporting-secret",
      surface: " Hosted Web ",
      stripeMeterSource: "murph",
      triggerKind: " Manual Ask ",
    });
    const expectedReportingUserId = `musr_${createHmac("sha256", "reporting-secret")
      .update("murph.assistant-usage.reporting-user.v1")
      .update("\0")
      .update("member_123")
      .digest("base64url")
      .slice(0, 32)}`;
    const legacyReportingUserId = `musr_${createHmac("sha256", "reporting-secret")
      .update("member_123")
      .digest("base64url")
      .slice(0, 32)}`;

    expect(attribution).toMatchObject({
      credentialSource: "platform",
      environment: "preview",
      featureKey: "assistant_reply",
      surface: "hosted_web",
      triggerKind: "manual_ask",
      gatewayTags: [
        "env:preview",
        "feature:assistant_reply",
        "surface:hosted_web",
        "trigger:manual_ask",
        "credential:platform",
      ],
      reportingUserId: expectedReportingUserId,
      stripeMeterSource: "murph",
    });
    expect(expectedReportingUserId).not.toBe(legacyReportingUserId);

    expect(createAssistantUsageReportingUserId({
      memberId: "member_123",
      reportingSecret: "reporting-secret",
    })).toEqual(expectedReportingUserId);
    expect(createAssistantUsageReportingUserId({
      memberId: "member_123",
      reportingSecret: " ",
    })).toBeNull();
    expect(createAssistantUsageReportingUserId({
      memberId: " ",
      reportingSecret: "reporting-secret",
    })).toBeNull();

    expect(normalizeAssistantUsageGatewayTags([
      " Env: Preview ",
      "feature:Assistant Reply",
      "feature:assistant_reply",
      "bad",
      "surface: Hosted Web ",
      "credential:Platform",
      "zdr:ON",
    ])).toEqual([
      "env:preview",
      "feature:assistant_reply",
      "surface:hosted_web",
      "credential:platform",
      "zdr:on",
    ]);
  });

  it("resolves feature keys, surfaces, triggers, environments, and reporting secrets", () => {
    expect(resolveAssistantUsageFeatureKey({
      promptProfile: "conversation",
    })).toBe("assistant_reply");
    expect(resolveAssistantUsageFeatureKey({
      deliverResponse: false,
      promptProfile: "conversation",
    })).toBe("assistant_internal_reply");
    expect(resolveAssistantUsageFeatureKey({
      promptProfile: "conversation",
      turnTrigger: "automation-auto-reply",
    })).toBe("assistant_auto_reply");
    expect(resolveAssistantUsageFeatureKey({
      promptProfile: "conversation",
      turnTrigger: "automation-cron",
    })).toBe("assistant_cron");
    expect(resolveAssistantUsageFeatureKey({
      promptProfile: "conversation",
      turnTrigger: "manual-deliver",
    })).toBe("assistant_manual_delivery");
    expect(resolveAssistantUsageFeatureKey({
      promptProfile: "conversation",
      turnTrigger: "manual-ask",
    })).toBe("assistant_reply");

    expect(resolveAssistantUsageSurface({
      messageInput: {
        deliverySource: {
          kind: "linq",
          fromPhoneNumber: "+15551230000",
        },
      },
      session: buildAssistantSession("email"),
    })).toBe("linq");
    expect(resolveAssistantUsageSurface({
      messageInput: {
        deliverySource: null,
      },
      session: buildAssistantSession("Hosted Web"),
    })).toBe("hosted_web");
    expect(resolveAssistantUsageSurface({
      messageInput: {
        deliverySource: null,
      },
      session: buildAssistantSession(null),
    })).toBe("assistant");

    expect(resolveAssistantUsageTriggerKind("automation-cron")).toBe("automation_cron");
    expect(resolveAssistantUsageTriggerKind(undefined)).toBe("manual_ask");

    const vercelEnv: NodeJS.ProcessEnv = {
      VERCEL_ENV: "Preview",
    };
    const nodeEnv: NodeJS.ProcessEnv = {
      NODE_ENV: "Production",
    };
    const fallbackEnv: NodeJS.ProcessEnv = {
      ENVIRONMENT: "Staging",
    };

    expect(resolveAssistantUsageEnvironment(vercelEnv)).toBe("preview");
    expect(resolveAssistantUsageEnvironment(nodeEnv)).toBe("production");
    expect(resolveAssistantUsageEnvironment(fallbackEnv)).toBe("staging");
    expect(resolveAssistantUsageEnvironment({})).toBe("development");

    const secretEnv: NodeJS.ProcessEnv = {
      [HOSTED_AI_USAGE_REPORTING_SECRET_ENV]: "  usage-secret  ",
    };
    expect(resolveAssistantUsageReportingSecret(secretEnv)).toBe("usage-secret");
    expect(resolveAssistantUsageReportingSecret({})).toBeNull();
  });
});

describe("assistant scheduled-log cron helpers", () => {
  it("normalizes canonical scheduled-log cron records", () => {
    expect(
      normalizeCanonicalScheduledLogCronRecord(
        buildScheduledLogRecord({
          schedule: {
            kind: "cron",
            expression: "0 7 * * *",
          },
          status: "active",
          title: "Morning mobility",
        }),
        "America/New_York",
      ),
    ).toMatchObject({
      kind: "scheduledLog",
      actionKind: "activity_session.add",
      schedule: {
        kind: "cron",
        expression: "0 7 * * *",
      },
      status: "active",
      timeZone: "America/New_York",
      title: "Morning mobility",
    });

    expect(
      normalizeCanonicalScheduledLogCronRecord(
        buildScheduledLogRecord({
          schedule: {
            kind: "dailyLocal",
            localTime: "18:30",
          },
          status: "paused",
          title: "Evening mobility",
        }),
        "America/Los_Angeles",
      ),
    ).toMatchObject({
      status: "paused",
      schedule: {
        kind: "dailyLocal",
        localTime: "18:30",
      },
      timeZone: "America/Los_Angeles",
      title: "Evening mobility",
    });

    expect(
      normalizeCanonicalScheduledLogCronRecord(
        buildScheduledLogRecord({
          schedule: {
            kind: "every",
            everyMs: 900_000,
          },
          status: "active",
          title: "Quarter-hour mobility",
        }),
        "UTC",
      ),
    ).toMatchObject({
      schedule: {
        kind: "every",
        everyMs: 900_000,
      },
      timeZone: null,
    });

    expect(
      normalizeCanonicalScheduledLogCronRecord(
        buildScheduledLogRecord({
          schedule: {
            kind: "at",
            at: "2026-04-22T07:00:00.000Z",
          },
          status: "archived",
          title: "Archived mobility",
        }),
        "UTC",
      ),
    ).toBeNull();
  });

  it("runs scheduled-log cron jobs against the canonical vault", async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext("murph-assistant-scheduled-log-");

    try {
      await initializeVault({ vaultRoot });

      const scheduledLog = await upsertScheduledLog({
        vaultRoot,
        scheduledLogId: "slog_01JX8VCQY2M5ZBV64ZP4N1DRBC",
        title: "Morning check-in",
        slug: "morning-check-in",
        status: "active",
        schedule: {
          kind: "dailyLocal",
          localTime: "07:30",
        },
        action: {
          kind: "measurement.add",
          measurements: [
            {
              metric: "body-weight",
              value: 180.8,
              unit: "lb",
            },
          ],
        },
        body: "Write the morning measurement event.",
      });

      const message = await runScheduledLogCronJob({
        vault: vaultRoot,
        scheduledLogId: scheduledLog.record.scheduledLogId,
        occurrenceAt: "2026-04-22T07:30:00.000Z",
      });

      expect(message).toContain('Auto-logged scheduled log "Morning check-in"');
      expect(message).toContain("measurement");
    } finally {
      await rm(parentRoot, { recursive: true, force: true });
    }
  });

  it("drops a retired scheduled-log retry after its schedule changes", async () => {
    vi.useFakeTimers();
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      "murph-assistant-scheduled-log-retry-schedule-edit-",
    );
    const scheduledLogId = "slog_01JX8VCQY2M5ZBV64ZP4N1DRBD";
    const retiredOccurrenceAt = "2026-04-22T08:00:00.000Z";

    try {
      await initializeVault({ vaultRoot, timezone: "UTC" });
      await upsertScheduledLog({
        action: {
          kind: "measurement.add",
          measurements: [{ metric: "body-weight", unit: "lb", value: 180.8 }],
        },
        body: "Write the scheduled measurement event.",
        now: new Date("2026-04-22T07:00:00.000Z"),
        schedule: { kind: "dailyLocal", localTime: "08:00" },
        scheduledLogId,
        slug: "daily-measurement-retry-edit",
        status: "active",
        title: "Daily measurement",
        vaultRoot,
      });
      await writeScheduledLogRetryRuntime({
        activatedAt: "2026-04-22T07:00:00.000Z",
        jobId: scheduledLogId,
        occurrenceAt: retiredOccurrenceAt,
        retryAfterAt: "2026-04-22T08:10:00.000Z",
        updatedAt: "2026-04-22T08:00:01.000Z",
        vaultRoot,
      });
      await upsertScheduledLog({
        action: {
          kind: "measurement.add",
          measurements: [{ metric: "body-weight", unit: "lb", value: 180.8 }],
        },
        body: "Write the scheduled measurement event.",
        now: new Date("2026-04-22T08:05:00.000Z"),
        schedule: { kind: "dailyLocal", localTime: "09:00" },
        scheduledLogId,
        slug: "daily-measurement-retry-edit",
        status: "active",
        title: "Daily measurement",
        vaultRoot,
      });

      vi.setSystemTime(new Date("2026-04-22T08:10:30.000Z"));
      await expect(processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      })).resolves.toEqual({ failed: 0, processed: 0, succeeded: 0 });
      await expect(getAssistantCronJob(vaultRoot, scheduledLogId)).resolves
        .toMatchObject({ state: { nextRunAt: "2026-04-22T09:00:00.000Z" } });
      await expect(findEventByExternalRef({
        resourceId: `${scheduledLogId}:${retiredOccurrenceAt}`,
        resourceType: "occurrence",
        system: "murph-scheduled-log",
        vaultRoot,
      })).resolves.toBeNull();

      vi.setSystemTime(new Date("2026-04-22T09:00:00.000Z"));
      await expect(processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      })).resolves.toEqual({ failed: 0, processed: 1, succeeded: 1 });
      await expect(findEventByExternalRef({
        resourceId: `${scheduledLogId}:2026-04-22T09:00:00.000Z`,
        resourceType: "occurrence",
        system: "murph-scheduled-log",
        vaultRoot,
      })).resolves.toMatchObject({ occurredAt: "2026-04-22T09:00:00.000Z" });
    } finally {
      vi.useRealTimers();
      await rm(parentRoot, { recursive: true, force: true });
    }
  });

  it("preserves a scheduled-log retry across a same-schedule edit", async () => {
    vi.useFakeTimers();
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      "murph-assistant-scheduled-log-retry-content-edit-",
    );
    const scheduledLogId = "slog_01JX8VCQY2M5ZBV64ZP4N1DRBE";
    const occurrenceAt = "2026-04-22T08:00:00.000Z";

    try {
      await initializeVault({ vaultRoot, timezone: "UTC" });
      await upsertScheduledLog({
        action: {
          kind: "measurement.add",
          measurements: [{ metric: "body-weight", unit: "lb", value: 180.8 }],
        },
        body: "Write the scheduled measurement event.",
        now: new Date("2026-04-22T07:00:00.000Z"),
        schedule: { kind: "dailyLocal", localTime: "08:00" },
        scheduledLogId,
        slug: "daily-measurement-retry-content",
        status: "active",
        summary: "Original summary.",
        title: "Daily measurement",
        vaultRoot,
      });
      await writeScheduledLogRetryRuntime({
        activatedAt: "2026-04-22T07:00:00.000Z",
        jobId: scheduledLogId,
        occurrenceAt,
        retryAfterAt: "2026-04-22T08:10:00.000Z",
        updatedAt: "2026-04-22T08:00:01.000Z",
        vaultRoot,
      });
      await upsertScheduledLog({
        action: {
          kind: "measurement.add",
          measurements: [{ metric: "body-weight", unit: "lb", value: 180.8 }],
        },
        body: "Write the scheduled measurement event.",
        now: new Date("2026-04-22T08:05:00.000Z"),
        schedule: { kind: "dailyLocal", localTime: "08:00" },
        scheduledLogId,
        slug: "daily-measurement-retry-content",
        status: "active",
        summary: "Updated summary.",
        title: "Daily measurement",
        vaultRoot,
      });

      vi.setSystemTime(new Date("2026-04-22T08:10:30.000Z"));
      await expect(processDueAssistantCronJobsLocal({
        limit: 1,
        vault: vaultRoot,
      })).resolves.toEqual({ failed: 0, processed: 1, succeeded: 1 });
      await expect(findEventByExternalRef({
        resourceId: `${scheduledLogId}:${occurrenceAt}`,
        resourceType: "occurrence",
        system: "murph-scheduled-log",
        vaultRoot,
      })).resolves.toMatchObject({ occurredAt: occurrenceAt });
    } finally {
      vi.useRealTimers();
      await rm(parentRoot, { recursive: true, force: true });
    }
  });

  it("preserves a running scheduled-log occurrence across a schedule edit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T08:05:00.000Z"));
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      "murph-assistant-scheduled-log-running-schedule-edit-",
    );
    const scheduledLogId = "slog_01JX8VCQY2M5ZBV64ZP4N1DRBF";
    const runningOccurrenceAt = "2026-04-22T08:00:00.000Z";

    try {
      await initializeVault({ vaultRoot, timezone: "UTC" });
      await upsertScheduledLog({
        action: {
          kind: "measurement.add",
          measurements: [{ metric: "body-weight", unit: "lb", value: 180.8 }],
        },
        body: "Write the scheduled measurement event.",
        now: new Date("2026-04-22T07:00:00.000Z"),
        schedule: { kind: "dailyLocal", localTime: "08:00" },
        scheduledLogId,
        slug: "daily-measurement-running-edit",
        status: "active",
        title: "Daily measurement",
        vaultRoot,
      });
      await writeScheduledLogRetryRuntime({
        activatedAt: "2026-04-22T07:00:00.000Z",
        jobId: scheduledLogId,
        occurrenceAt: runningOccurrenceAt,
        retryAfterAt: runningOccurrenceAt,
        runningAt: "2026-04-22T08:00:01.000Z",
        updatedAt: "2026-04-22T08:00:01.000Z",
        vaultRoot,
      });
      await upsertScheduledLog({
        action: {
          kind: "measurement.add",
          measurements: [{ metric: "body-weight", unit: "lb", value: 180.8 }],
        },
        body: "Write the scheduled measurement event.",
        now: new Date("2026-04-22T08:05:00.000Z"),
        schedule: { kind: "dailyLocal", localTime: "09:00" },
        scheduledLogId,
        slug: "daily-measurement-running-edit",
        status: "active",
        title: "Daily measurement",
        vaultRoot,
      });

      await expect(getAssistantCronJob(vaultRoot, scheduledLogId)).resolves
        .toMatchObject({
          state: {
            nextRunAt: runningOccurrenceAt,
            runningAt: "2026-04-22T08:00:01.000Z",
          },
        });
    } finally {
      vi.useRealTimers();
      await rm(parentRoot, { recursive: true, force: true });
    }
  });
});
