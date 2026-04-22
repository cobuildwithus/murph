import {
  experimentProtocolRefSchema,
  experimentRunPlanSchema,
  safeParseContract,
} from "@murphai/contracts";
import {
  isActiveOverviewExperimentStatus,
  selectBrowserVaultTrackedExperiments,
  type BrowserVaultEntity,
  type BrowserVaultQueryClient,
  type OverviewExperiment,
} from "@murphai/query/browser";

import type {
  ExperimentProtocol,
  ExperimentRunProjection,
  ExperimentStatus,
  TimelineEvent,
} from "@/src/types/experiments";

const FINISHED_EXPERIMENT_STATUSES = new Set([
  "complete",
  "completed",
  "concluded",
  "finished",
]);

const STOPPED_EXPERIMENT_STATUSES = new Set([
  "abandoned",
  "closed",
  "done",
]);

export interface ResolveBrowserVaultExperimentRunInput {
  client: BrowserVaultQueryClient | null;
  protocol: ExperimentProtocol;
}

export function resolveBrowserVaultExperimentRun({
  client,
  protocol,
}: ResolveBrowserVaultExperimentRunInput): ExperimentRunProjection | null {
  if (!client) {
    return null;
  }

  const trackedExperiment = findTrackedExperiment(client, protocol);
  if (!trackedExperiment) {
    return null;
  }

  const status = normalizePrivateRunStatus(trackedExperiment);
  if (!status) {
    return null;
  }

  const startedOn = extractIsoDate(
    trackedExperiment.runPlan?.baselineStart ?? trackedExperiment.startedOn,
  );
  const referenceDate = extractIsoDate(client.replica.generatedAt) ?? todayIsoDate();
  const protocolDurationDays = normalizeDayCount(protocol.durationDays, 1);
  const baselineDays = resolveTrackedBaselineDays(trackedExperiment, protocolDurationDays, protocol);
  const analysisAvailableOn = extractIsoDate(
    trackedExperiment.runPlan?.interventionEnd,
  ) ?? (startedOn
    ? addDaysToIsoDate(startedOn, protocolDurationDays - 1)
    : undefined);
  const durationDays =
    startedOn && analysisAvailableOn
      ? Math.max(1, daysBetweenInclusive(startedOn, analysisAvailableOn))
      : protocolDurationDays;
  const day = startedOn
    ? clamp(daysBetweenInclusive(startedOn, referenceDate), 1, durationDays)
    : undefined;
  const completionPercent = status === "finished"
    ? 100
    : day
      ? clamp(Math.round((day / durationDays) * 100), 1, 99)
      : undefined;

  return {
    id: trackedExperiment.id,
    source: "browser-vault",
    snapshotGeneratedAt: client.replica.generatedAt,
    slug: trackedExperiment.slug,
    status,
    statusLabel: formatStatusLabel(trackedExperiment.status, status),
    startedOn,
    tags: trackedExperiment.tags.slice(),
    title: trackedExperiment.title,
    day,
    completionPercent,
    dateRange: startedOn && analysisAvailableOn
      ? formatDateRange(startedOn, analysisAvailableOn)
      : undefined,
    analysisAvailableOn,
    signals: [],
    trends: [],
    timeline: buildPrivateRunTimeline({
      analysisAvailableOn,
      baselineDays,
      day,
      referenceDate,
      startedOn,
      status,
    }),
    nextStep: status === "active" || status === "paused"
      ? buildRunNextStep({ baselineDays, day, protocol, status })
      : undefined,
    summary: status === "finished"
      ? "Private run recorded"
      : status === "stopped"
        ? "Private run stopped"
        : undefined,
    summaryDetail: status === "finished"
      ? trackedExperiment.summary ?? "This private experiment run is present in your browser vault. A biomarker comparison has not been exported to the dashboard snapshot yet."
      : status === "stopped"
        ? trackedExperiment.summary ?? "This private experiment run is still in your browser vault, but it was stopped before a browser-vault outcome comparison was exported."
        : undefined,
    conclusions: status === "finished"
      ? [{
          title: "What we can say right now",
          variant: "insight",
          items: [{
            icon: "→",
            text: trackedExperiment.summary ?? "The private run exists, but no wearable outcome comparison has been exported yet.",
          }],
        }]
      : undefined,
  };
}

function findTrackedExperiment(
  client: BrowserVaultQueryClient,
  protocol: ExperimentProtocol,
): OverviewExperiment | null {
  const protocolKeys = buildProtocolLookupKeys(protocol);

  return selectBrowserVaultTrackedExperiments(client).map((entry) =>
    mergeTrackedExperimentMetadata(client, entry)
  ).find((entry) =>
    listTrackedExperimentLookupValues(entry).some((value) =>
      protocolKeys.has(normalizeLookupKey(value))
    )
  ) ?? null;
}

function mergeTrackedExperimentMetadata(
  client: BrowserVaultQueryClient,
  entry: OverviewExperiment,
): OverviewExperiment {
  const entity = client.entities.get(entry.id);
  if (!entity) {
    return entry;
  }

  const protocolRef = parseTrackedExperimentProtocolRef(entity) ?? entry.protocolRef;
  const runPlan = parseTrackedExperimentRunPlan(entity) ?? entry.runPlan;
  if (protocolRef === entry.protocolRef && runPlan === entry.runPlan) {
    return entry;
  }

  return {
    ...entry,
    protocolRef,
    runPlan,
  };
}

function buildProtocolLookupKeys(protocol: ExperimentProtocol): ReadonlySet<string> {
  const values = [
    protocol.id,
    ...(protocol.commons?.aliases ?? []),
    protocol.commons?.key,
    protocol.commons?.routeId,
    protocol.commons?.slug,
    protocol.commons?.key?.replace(/^protocol_variant:/u, ""),
  ];

  return new Set(values.flatMap((value) => {
    const normalized = normalizeLookupKey(value);
    if (!normalized) {
      return [];
    }

    const lastSegment = normalized.split("/").at(-1);
    return lastSegment && lastSegment !== normalized
      ? [normalized, lastSegment]
      : [normalized];
  }));
}

function listTrackedExperimentLookupValues(entry: OverviewExperiment): string[] {
  return [
    entry.id,
    entry.slug,
    entry.protocolRef?.key,
    entry.protocolRef?.key?.replace(/^protocol_variant:/u, ""),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function parseTrackedExperimentProtocolRef(
  entity: BrowserVaultEntity,
): OverviewExperiment["protocolRef"] | null {
  const result = safeParseContract(experimentProtocolRefSchema, entity.attributes.protocolRef);
  return result.success ? result.data : null;
}

function parseTrackedExperimentRunPlan(
  entity: BrowserVaultEntity,
): OverviewExperiment["runPlan"] | null {
  const result = safeParseContract(experimentRunPlanSchema, entity.attributes.runPlan);
  return result.success ? result.data : null;
}

function normalizeLookupKey(value: string | null | undefined): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/^protocol_variant:/u, "")
    : "";
}

function normalizePrivateRunStatus(
  entry: OverviewExperiment,
): Exclude<ExperimentStatus, "upcoming"> | null {
  const status = entry.status?.trim().toLowerCase() ?? "";

  if (isActiveOverviewExperimentStatus(status)) {
    return "active";
  }

  if (status === "paused") {
    return "paused";
  }

  if (FINISHED_EXPERIMENT_STATUSES.has(status)) {
    return "finished";
  }

  if (STOPPED_EXPERIMENT_STATUSES.has(status)) {
    return "stopped";
  }

  if (!status && entry.startedOn) {
    return "active";
  }

  return null;
}

function buildRunNextStep(input: {
  baselineDays: number;
  day: number | undefined;
  protocol: ExperimentProtocol;
  status: "active" | "paused";
}): ExperimentRunProjection["nextStep"] {
  const day = input.day ?? 1;
  const inBaseline = input.baselineDays > 0 && day <= input.baselineDays;

  if (input.status === "paused") {
    const activeDay = Math.max(1, day - input.baselineDays);

    return {
      title: inBaseline ? "Resume when ready" : "Resume the protocol",
      when: inBaseline
        ? `Paused during baseline day ${day} of ${input.baselineDays}`
        : `Paused on day ${activeDay}`,
      instructions: inBaseline
        ? "Resume the run when you're ready. Keeping the baseline steady makes the later comparison easier to trust."
        : input.protocol.protocol.find((step) => /session|protocol|complete/iu.test(step.detail))?.detail
          ?? input.protocol.protocol[0]?.detail
          ?? "Resume the protocol when you're ready and keep the rest of the week ordinary.",
      context: inBaseline
        ? "The run exists in your browser vault, but the active protocol window has not started yet."
        : "Murph kept the private run state, but the protocol is paused until you resume it.",
    };
  }

  if (inBaseline) {
    return {
      title: "Keep the baseline clean",
      when: `Baseline day ${day} of ${input.baselineDays}`,
      instructions: "Avoid adding a second new protocol so the before-and-after comparison stays readable.",
      context: "The protocol instructions are ready below; the private run is still gathering baseline context.",
    };
  }

  return {
    title: "Continue the protocol",
    when: `Day ${day}`,
    instructions: input.protocol.protocol.find((step) => /session|protocol|complete/iu.test(step.detail))?.detail
      ?? input.protocol.protocol[0]?.detail
      ?? "Follow the protocol steps and keep the rest of the week ordinary.",
    context: "Personal outcome analysis becomes useful after the protocol window closes and enough wearable data is available.",
  };
}

function resolveTrackedBaselineDays(
  entry: OverviewExperiment,
  protocolDurationDays: number,
  protocol: ExperimentProtocol,
): number {
  const baselineStart = extractIsoDate(entry.runPlan?.baselineStart);
  const baselineEnd = extractIsoDate(entry.runPlan?.baselineEnd);
  if (baselineStart && baselineEnd) {
    return Math.max(0, Math.min(daysBetweenInclusive(baselineStart, baselineEnd), protocolDurationDays - 1));
  }

  return Math.min(
    normalizeDayCount(protocol.baselineDays, 0),
    Math.max(0, protocolDurationDays - 1),
  );
}

function buildPrivateRunTimeline(input: {
  analysisAvailableOn: string | undefined;
  baselineDays: number;
  day: number | undefined;
  referenceDate: string;
  startedOn: string | null;
  status: Exclude<ExperimentStatus, "upcoming">;
}): TimelineEvent[] {
  if (!input.startedOn) {
    return [];
  }

  const events: TimelineEvent[] = [{
    date: formatShortDate(input.startedOn),
    label: "Start",
    title: input.baselineDays > 0 ? "Baseline started" : "Experiment started",
    description: input.baselineDays > 0
      ? `${input.baselineDays} baseline days before the protocol window.`
      : "The private run is linked to this protocol.",
    variant: "primary",
  }];

  if (input.baselineDays > 0) {
    const protocolStart = addDaysToIsoDate(input.startedOn, input.baselineDays);
    events.push({
      date: formatShortDate(protocolStart),
      label: "Protocol",
      title: "Protocol window starts",
      description: "Begin the protocol while keeping other variables as steady as practical.",
      variant: input.day && input.day > input.baselineDays ? "primary" : "outline",
      upcoming: input.day ? input.day <= input.baselineDays : false,
    });
  }

  if (input.status === "active") {
    events.push({
      date: formatShortDate(input.referenceDate),
      label: input.day ? `Day ${input.day}` : "Now",
      title: "Private run in progress",
      description: "Murph has the run state; outcome cards update when the browser-vault snapshot includes measured comparisons.",
      variant: "default",
    });

    if (input.analysisAvailableOn) {
      events.push({
        date: formatShortDate(input.analysisAvailableOn),
        label: "Review",
        title: "Analysis window",
        description: "Compare baseline and protocol periods after the window closes.",
        upcoming: true,
        variant: "outline",
      });
    }
  } else if (input.status === "paused") {
    events.push({
      date: formatShortDate(input.referenceDate),
      label: input.day ? `Day ${input.day}` : "Paused",
      title: "Private run paused",
      description: "The run is still present in your browser vault, but the protocol is paused for now.",
      variant: "muted",
    });
  } else if (input.status === "stopped") {
    events.push({
      date: formatShortDate(input.referenceDate),
      label: "Stopped",
      title: "Private run stopped",
      description: "The run remains in your browser vault, but it was marked stopped before a dashboard comparison was exported.",
      variant: "muted",
    });
  } else if (input.analysisAvailableOn) {
    events.push({
      date: formatShortDate(input.analysisAvailableOn),
      label: "Finished",
      title: "Experiment window complete",
      description: "The private run is marked finished in the browser-vault snapshot.",
      variant: "primary",
    });
  }

  return events.map((event, index) => ({
    ...event,
    last: index === events.length - 1,
  }));
}

function formatStatusLabel(
  sourceStatus: string | null,
  normalizedStatus: Exclude<ExperimentStatus, "upcoming">,
): string {
  if (!sourceStatus) {
    if (normalizedStatus === "active") {
      return "Active";
    }

    if (normalizedStatus === "paused") {
      return "Paused";
    }

    if (normalizedStatus === "stopped") {
      return "Stopped";
    }

    return "Finished";
  }

  return sourceStatus
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (match) => match.toUpperCase());
}

function extractIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/u);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  const start = parseIsoDateAsUtcNoon(startDate);
  const end = parseIsoDateAsUtcNoon(endDate);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function addDaysToIsoDate(value: string, days: number): string {
  const date = parseIsoDateAsUtcNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseIsoDateAsUtcNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function normalizeDayCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = formatShortDate(startDate);
  const end = formatShortDate(endDate);

  return start === end ? start : `${start} – ${end}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(parseIsoDateAsUtcNoon(value));
}
