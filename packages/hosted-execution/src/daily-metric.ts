import { isStrictIsoDate } from "@murphai/contracts";

import {
  HOSTED_EXECUTION_DAILY_METRIC_MAX_METRIC_LENGTH,
  HOSTED_EXECUTION_DAILY_METRIC_MAX_UNIT_LENGTH,
  type HostedExecutionDailyMetricReportedPayload,
} from "./contracts.ts";
import {
  requireNumber,
  requireObject,
  requireString,
} from "./parsers/assertions.ts";
import {
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
} from "./vault-share.ts";

const MEMBER_REPORTED_DAILY_METRIC_SPECS =
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS.filter(
    (spec) => spec.source.kind === "metric-series",
  );

export const HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS = [
  ...new Set(MEMBER_REPORTED_DAILY_METRIC_SPECS.map((spec) => spec.metricKey)),
];

export function parseHostedExecutionDailyMetricReportedPayload(
  value: unknown,
): HostedExecutionDailyMetricReportedPayload {
  const label = "Hosted execution health.daily-metric.reported payload";
  const record = requireObject(value, label);
  assertExactDailyMetricKeys(record, label);

  const date = requireString(record.date, `${label} date`);
  if (!isStrictIsoDate(date)) {
    throw new TypeError(`${label} date is invalid.`);
  }
  const metric = requireString(record.metric, `${label} metric`);
  const metricSpecs = MEMBER_REPORTED_DAILY_METRIC_SPECS.filter(
    (spec) => spec.metricKey === metric,
  );
  if (metricSpecs.length === 0) {
    throw new TypeError(`${label} metric is invalid.`);
  }
  const unit = requireString(record.unit, `${label} unit`);
  if (
    unit.length > HOSTED_EXECUTION_DAILY_METRIC_MAX_UNIT_LENGTH
    || !/^[A-Za-z0-9._/%-]+$/u.test(unit)
  ) {
    throw new TypeError(`${label} unit is invalid.`);
  }
  const metricValue = requireNumber(record.value, `${label} value`);
  if (metricSpecs.some(
    (spec) => metricValue < spec.minValue || metricValue > spec.maxValue
  )) {
    throw new TypeError(`${label} value is outside the metric's supported range.`);
  }

  return { date, metric, unit, value: metricValue };
}

function assertExactDailyMetricKeys(
  record: Record<string, unknown>,
  label: string,
): void {
  const allowed = new Set(["date", "metric", "unit", "value"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(key)}.`);
    }
  }
}
