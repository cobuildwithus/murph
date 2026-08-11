export const STATUS_PAGE_URL = "https://status.withmurph.ai";

// incident.io status pages expose a public JSON summary at /proxy/<slug>; the
// slug for a custom-domain page is the domain itself.
export const STATUS_PAGE_SUMMARY_ENDPOINT = `${STATUS_PAGE_URL}/proxy/status.withmurph.ai`;

// An empty public summary means the provider lists no ongoing incident or
// affected component. Keep that source state distinct from its presentation;
// the footer maps it to the requested all-clear copy, "Murph is online".
export type StatusPageAvailability = "unknown" | "no_reported_issues" | "issues";

export function resolveStatusPageAvailability(
  payload: unknown,
): StatusPageAvailability {
  if (typeof payload !== "object" || payload === null) {
    return "unknown";
  }
  const summary = (payload as { summary?: unknown }).summary;
  if (typeof summary !== "object" || summary === null) {
    return "unknown";
  }
  const { affected_components: affected, ongoing_incidents: ongoing } =
    summary as { affected_components?: unknown; ongoing_incidents?: unknown };
  if (!Array.isArray(affected) || !Array.isArray(ongoing)) {
    return "unknown";
  }
  return affected.length === 0 && ongoing.length === 0
    ? "no_reported_issues"
    : "issues";
}
