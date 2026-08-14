import {
  HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER,
  resolveLocalDateAtNoon,
} from "@murphai/contracts";
import {
  ID_PREFIXES,
  deterministicContractId,
  findEventByExternalRef,
  loadVault,
  upsertEvent,
} from "@murphai/core";
import type {
  HostedExecutionDailyMetricReportedWake,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";

const REPORTED_DAILY_METRIC_EXTERNAL_SYSTEM = "manual";
const REPORTED_DAILY_METRIC_EXTERNAL_RESOURCE_TYPE = "daily-metric-report";
const REPORTED_DAILY_METRIC_EXTERNAL_VERSION = "v1";

export async function importHostedReportedDailyMetricMailboxItem(input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionDailyMetricReportedWake;
}): Promise<HostedMailboxItemImportOutcome> {
  if (
    input.item.route.action !== "import-reported-daily-metric"
    || input.item.item.kind !== "health.daily-metric.reported"
  ) {
    return blockedReportedDailyMetricImport("daily_metric_report.route_mismatch", false);
  }
  if (
    input.wake.kind !== "health.daily-metric.reported"
    || input.wake.userId !== input.item.item.userId
    || input.wake.eventId !== input.item.item.dedupeKey
    || input.wake.occurredAt !== input.item.item.occurredAt
  ) {
    return blockedReportedDailyMetricImport("daily_metric_report.decode_mismatch", false);
  }
  const causalSeq = readPositiveCausalSeq(input.item.item.causalSeq);
  if (!causalSeq) {
    return blockedReportedDailyMetricImport("daily_metric_report.causal_seq_invalid", false);
  }

  const eventId = deterministicContractId(
    ID_PREFIXES.event,
    `reported-daily-metric:${input.wake.eventId}`,
  );
  const externalRef = {
    resourceId: input.wake.eventId,
    resourceType: REPORTED_DAILY_METRIC_EXTERNAL_RESOURCE_TYPE,
    system: REPORTED_DAILY_METRIC_EXTERNAL_SYSTEM,
    version: REPORTED_DAILY_METRIC_EXTERNAL_VERSION,
  };

  let existing: Awaited<ReturnType<typeof findEventByExternalRef>>;
  try {
    existing = await findEventByExternalRef({
      resourceId: externalRef.resourceId,
      resourceType: externalRef.resourceType,
      system: externalRef.system,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blockedReportedDailyMetricImport(
      "daily_metric_report.idempotency_read_failed",
      true,
    );
  }

  if (existing) {
    return reportedDailyMetricMatches({
      causalSeq,
      eventId,
      existing,
      wake: input.wake,
    })
      ? importedReportedDailyMetricOutcome()
      : blockedReportedDailyMetricImport("daily_metric_report.conflict", false);
  }

  let eventTimeZone: string;
  let eventOccurredAt: string;
  try {
    const vault = await loadVault({ vaultRoot: input.vaultRoot });
    eventTimeZone = vault.metadata.timezone;
    eventOccurredAt = resolveLocalDateAtNoon(
      input.wake.dailyMetric.date,
      eventTimeZone,
    );
  } catch {
    return blockedReportedDailyMetricImport("daily_metric_report.vault_read_failed", true);
  }

  try {
    await upsertEvent({
      payload: {
        dayKey: input.wake.dailyMetric.date,
        externalRef,
        id: eventId,
        kind: "observation",
        metric: input.wake.dailyMetric.metric,
        observationGrain: "summary",
        occurredAt: eventOccurredAt,
        qualifiers: {
          [HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER]: causalSeq,
        },
        queryVisibility: "default",
        recordedAt: input.wake.occurredAt,
        source: "manual",
        timeZone: eventTimeZone,
        title: `Member-reported ${input.wake.dailyMetric.metric}`,
        unit: input.wake.dailyMetric.unit,
        value: input.wake.dailyMetric.value,
        visibility: "display",
      },
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blockedReportedDailyMetricImport(
      "daily_metric_report.canonical_import_failed",
      true,
    );
  }

  return importedReportedDailyMetricOutcome();
}

function reportedDailyMetricMatches(input: {
  causalSeq: string;
  eventId: string;
  existing: NonNullable<Awaited<ReturnType<typeof findEventByExternalRef>>>;
  wake: HostedExecutionDailyMetricReportedWake;
}): boolean {
  const { existing, wake } = input;
  if (!existing.timeZone) {
    return false;
  }
  let expectedOccurredAt: string;
  try {
    expectedOccurredAt = resolveLocalDateAtNoon(
      wake.dailyMetric.date,
      existing.timeZone,
    );
  } catch {
    return false;
  }
  return existing.id === input.eventId
    && existing.kind === "observation"
    && existing.source === "manual"
    && existing.dayKey === wake.dailyMetric.date
    && existing.occurredAt === expectedOccurredAt
    && existing.recordedAt === wake.occurredAt
    && existing.metric === wake.dailyMetric.metric
    && existing.value === wake.dailyMetric.value
    && existing.unit === wake.dailyMetric.unit
    && existing.observationGrain === "summary"
    && existing.qualifiers?.[HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER] === input.causalSeq
    && existing.queryVisibility === "default"
    && existing.visibility === "display"
    && existing.externalRef?.version === REPORTED_DAILY_METRIC_EXTERNAL_VERSION;
}

function readPositiveCausalSeq(value: string | null | undefined): string | null {
  if (!value || !/^[1-9][0-9]{0,18}$/u.test(value)) {
    return null;
  }
  return BigInt(value) <= 9_223_372_036_854_775_807n ? value : null;
}

function importedReportedDailyMetricOutcome(): HostedMailboxItemImportOutcome {
  return {
    reasonCode: "daily_metric_report.imported",
    status: "imported",
  };
}

function blockedReportedDailyMetricImport(
  reasonCode: string,
  retryable: boolean,
): HostedMailboxItemImportOutcome {
  return { reasonCode, retryable, status: "blocked" };
}
