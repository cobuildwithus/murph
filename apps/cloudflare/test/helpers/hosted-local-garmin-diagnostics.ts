import type { JunctionClient, JunctionHistoricalPullSnapshot } from "@murphai/device-syncd/providers/junction-client";

const resources = ["activity", "sleep", "workouts"] as const;
const statuses = ["success", "pending", "running", "retrying", "failed", "error"] as const;

// Introspection is diagnostic only: Garmin's completed history pull is not
// evidence that data was delivered, much less imported into the vault.
export async function readLiveGarminProviderDiagnostics(input: {
  client: Pick<JunctionClient, "introspectResources" | "introspectHistoricalPull">;
  userId: string;
  signal: AbortSignal;
  window: { from: string; to: string };
}): Promise<string> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]);
  const query = { signal, sourceProviderSlug: "garmin", userId: input.userId, userLimit: 1 };
  const [availability, history] = await Promise.allSettled([
    input.client.introspectResources(query),
    input.client.introspectHistoricalPull(query),
  ]);
  return JSON.stringify({
    resourcesQuery: availability.status,
    historyQuery: history.status,
    resources: summarizeLiveGarminProviderDiagnostics({
      availability: availability.status === "fulfilled" ? availability.value : null,
      history: history.status === "fulfilled" ? history.value : null,
      userId: input.userId,
      window: input.window,
    }),
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
      latestData: classifyLatestData(available?.newest_data ?? available?.newestData, input.window),
      history: statuses.find((candidate) => candidate === status)
        ?? (history?.notPulledResources.includes(resource) ? "not_pulled" : "unknown"),
    };
  });
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
