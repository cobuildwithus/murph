import type { JunctionClient, JunctionHistoricalPullSnapshot } from "@murphai/device-syncd/providers/junction-client";

const resources = ["activity", "sleep", "workouts"] as const;
const statuses = ["success", "pending", "running", "retrying", "failed", "error"] as const;

// Introspection is diagnostic only: Garmin's completed history pull is not
// evidence that data was delivered, much less imported into the vault.
export async function readLiveGarminProviderDiagnosticsForLog(input: {
  client: Pick<JunctionClient, "introspectResources" | "introspectHistoricalPull" | "listSummary">;
  userId: string;
  signal: AbortSignal;
  window: { from: string; to: string };
}): Promise<string> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]);
  const query = { signal, sourceProviderSlug: "garmin", userId: input.userId, userLimit: 1 };
  const now = Date.now();
  const [availability, history, ...summaries] = await Promise.allSettled([
    input.client.introspectResources(query),
    input.client.introspectHistoricalPull(query),
    // Garmin's default historical range is 90 days. Include open days here:
    // these reads diagnose availability only and can never pass the oracle.
    ...resources.map((resource) => input.client.listSummary({
      collectionWorkLimit: { maxAttemptsPerPage: 1, maxPages: 3, requestTimeoutMs: 8_000 },
      maxRecords: 500,
      requireStructurallyCompleteCollection: true,
      resource,
      signal,
      sourceProviderSlug: "garmin",
      userId: input.userId,
      windowStart: new Date(now - 90 * 86_400_000).toISOString(),
      windowEnd: new Date(now).toISOString(),
    })),
  ]);
  return JSON.stringify({
    resourcesQuery: availability.status,
    historyQuery: history.status,
    resources: summarizeLiveGarminProviderDiagnostics({
      availability: availability.status === "fulfilled" ? availability.value : null,
      history: history.status === "fulfilled" ? history.value : null,
      userId: input.userId,
      window: input.window,
    }).map((resource, index) => ({
      ...resource,
      historyRangeData: classifySummary(summaries[index]),
    })),
  });
}

export function summarizeLiveGarminProviderDiagnostics(input: {
  availability: unknown;
  history: JunctionHistoricalPullSnapshot | null;
  userId: string;
  window: { from: string; to: string };
}) {
  const data = record(input.availability)?.data;
  const user = Array.isArray(data)
    ? data.map(record).find((entry) => (entry?.user_id ?? entry?.userId) === input.userId)
    : undefined;
  const provider = record(record(user?.provider)?.garmin);
  const history = input.history?.matchedUser
    ? input.history.sources.find((source) => source.sourceProviderSlug === "garmin")
    : undefined;
  // Construct every output key and value from closed categories. Never spread
  // provider objects or include IDs, dates, counts, errors, or health values.
  return resources.map((resource) => {
    const available = record(provider?.[resource]);
    const pulled = history?.pulledResources.find((entry) => entry.resource === resource);
    const status = pulled?.status;
    return {
      resource,
      inventory: !Array.isArray(data) ? "invalid_response"
        : !user ? "user_missing"
          : !provider ? "provider_missing"
            : !available ? "resource_missing" : "present",
      latestData: classifyLatestData(available?.newest_data ?? available?.newestData, input.window),
      history: statuses.find((candidate) => candidate === status)
        ?? (history?.notPulledResources.includes(resource) ? "not_pulled" : "unknown"),
      historyRequestedWindow: classifyHistoryWindow(pulled?.rangeStart, pulled?.rangeEnd, input.window),
      historyReportedData: typeof pulled?.daysWithData !== "number"
        || !Number.isSafeInteger(pulled.daysWithData) || pulled.daysWithData < 0
        ? "unknown" : pulled.daysWithData === 0 ? "empty" : "present",
    };
  });
}

function classifyHistoryWindow(start: string | null | undefined, end: string | null | undefined, window: { from: string; to: string }) {
  if (start == null || end == null) return "unknown";
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return "invalid";
  if (to < Date.parse(`${window.from}T00:00:00.000Z`)) return "before_window";
  if (from > Date.parse(`${window.to}T23:59:59.999Z`)) return "after_window";
  // Overlap describes the requested range, never actual delivery or coverage.
  return "overlaps_window";
}

function classifySummary(result: PromiseSettledResult<unknown> | undefined) {
  if (result?.status !== "fulfilled" || !Array.isArray(result.value)) return "unavailable";
  if (result.value.length === 0) return "empty";
  return result.value.some((value) => {
    const source = record(record(value)?.source);
    return (source?.provider ?? source?.slug) === "garmin";
  }) ? "present" : "provider_mismatch";
}

function classifyLatestData(value: unknown, window: { from: string; to: string }) {
  // The SDK decodes timestamps as Date; its raw-response fallback keeps ISO strings.
  const instant = value instanceof Date ? value.getTime()
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value)
      ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(instant)) return "unknown";
  const day = new Date(instant).toISOString().slice(0, 10);
  if (day < window.from) return "before_window";
  return day > window.to ? "after_window" : "in_window";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
