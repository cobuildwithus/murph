// Engine-owned reads use the schemas captured for these versions. This lane is
// deliberately absent from all model-facing connected-app tool schemas.
const policies: Readonly<Record<string, {
  toolkit: string;
  version: string;
  forcedArguments: Readonly<Record<string, unknown>>;
}>> = {
  GOOGLECALENDAR_LIST_CALENDARS: { toolkit: "googlecalendar", version: "20261111_00", forcedArguments: {} },
  GOOGLECALENDAR_EVENTS_LIST: { toolkit: "googlecalendar", version: "20261111_00", forcedArguments: {} },
  GOOGLECALENDAR_EVENTS_GET: { toolkit: "googlecalendar", version: "20261111_00", forcedArguments: {} },
  OUTLOOK_LIST_CALENDARS: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_GET_CALENDAR_VIEW: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_GET_EVENT: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_GET_CALENDAR_EVENT: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_SEARCH_MESSAGES: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me", enable_top_results: false } },
  OUTLOOK_GET_MESSAGE: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me", select: ["id", "subject", "from", "receivedDateTime", "body", "bodyPreview"] } },
  GMAIL_FETCH_EMAILS: { toolkit: "gmail", version: "20261105_00", forcedArguments: { user_id: "me", include_payload: false, verbose: false, ids_only: false } },
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: { toolkit: "gmail", version: "20261105_00", forcedArguments: { user_id: "me", format: "full" } },
};

export function getHostedConnectedAppsReadPolicy(slug: string) {
  return Object.hasOwn(policies, slug) ? policies[slug] : undefined;
}

// Direct execution already unwraps the Composio success envelope. Decode only
// its data, before HTML/MIME compaction can mistake JSON text for an email body.
export function wrapHostedConnectedAppsReadResult(data: unknown): { data: unknown } {
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { /* Engine reports shape mismatch. */ }
  }
  return { data };
}
