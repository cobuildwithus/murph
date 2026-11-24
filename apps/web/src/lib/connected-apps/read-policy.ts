import * as z from "@murphai/contracts/zod-runtime";

// Outlook search has no field selector like Gmail's `include_payload: false`,
// and 25 full hits from a busy mailbox overrun the result cap. Parsing strips
// every key the engine never reads; any other shape passes through unchanged
// for the engine to report.
const outlookSearchPage = z.object({
  value: z.array(z.object({
    hitsContainers: z.array(z.object({
      hits: z.array(z.object({
        hitId: z.unknown(),
        summary: z.unknown(),
        resource: z.object({
          subject: z.unknown(),
          receivedDateTime: z.unknown(),
          sender: z.unknown(),
          from: z.unknown(),
          bodyPreview: z.unknown(),
        }),
      })),
      moreResultsAvailable: z.unknown(),
    })),
  })),
  next_page_token: z.unknown(),
});

const text = z.string().nullish();
const eventTime = z.object({ dateTime: text, date: text, timeZone: text });
const response = z.object({ response: text });
const participant = z.object({
  self: z.boolean().nullish(), email: text, emailAddress: z.object({ address: text }).nullish(),
  responseStatus: text, status: response.nullish(),
});
const calendarEvent = z.object({
  id: z.string(), start: eventTime.nullish(), end: eventTime.nullish(), summary: text, subject: text,
  description: text, body: z.object({ content: text }).nullish(), bodyPreview: text,
  location: z.union([z.string(), z.object({ displayName: text })]).nullish(),
  status: text, isCancelled: z.boolean().nullish(), isAllDay: z.boolean().nullish(),
  eventType: text, updated: text, lastModifiedDateTime: text,
  isOrganizer: z.boolean().nullish(), organizer: participant.nullish(), responseStatus: response.nullish(),
  attendees: z.array(participant.catch({})).nullish(),
});

// Engine-owned reads use the schemas captured for these versions. This lane is
// deliberately absent from all model-facing connected-app tool schemas.
const policies: Readonly<Record<string, {
  toolkit: string;
  version: string;
  forcedArguments: Readonly<Record<string, unknown>>;
  result?: z.ZodType;
}>> = {
  GOOGLECALENDAR_LIST_CALENDARS: { toolkit: "googlecalendar", version: "20261111_00", forcedArguments: {} },
  GOOGLECALENDAR_EVENTS_LIST: { toolkit: "googlecalendar", version: "20261111_00", forcedArguments: {} },
  GOOGLECALENDAR_EVENTS_GET: { toolkit: "googlecalendar", version: "20261111_00", forcedArguments: {}, result: calendarEvent },
  OUTLOOK_LIST_CALENDARS: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_GET_CALENDAR_VIEW: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_GET_EVENT: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" } },
  OUTLOOK_GET_CALENDAR_EVENT: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me" }, result: calendarEvent },
  OUTLOOK_SEARCH_MESSAGES: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me", enable_top_results: false }, result: outlookSearchPage },
  OUTLOOK_GET_MESSAGE: { toolkit: "outlook", version: "20261112_00", forcedArguments: { user_id: "me", select: ["id", "subject", "from", "receivedDateTime", "body", "bodyPreview"] } },
  GMAIL_FETCH_EMAILS: { toolkit: "gmail", version: "20261105_00", forcedArguments: { user_id: "me", include_payload: false, verbose: false, ids_only: false } },
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: { toolkit: "gmail", version: "20261105_00", forcedArguments: { user_id: "me", format: "full" } },
};

export function getHostedConnectedAppsReadPolicy(slug: string) {
  return Object.hasOwn(policies, slug) ? policies[slug] : undefined;
}

// Direct execution already unwraps the Composio success envelope. Decode only
// its data, before HTML/MIME compaction can mistake JSON text for an email body.
export function wrapHostedConnectedAppsReadResult(data: unknown, result?: z.ZodType, calendarMemberAddress?: string | null): { data: unknown } {
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { /* Engine reports shape mismatch. */ }
  }
  if (result === calendarEvent) {
    const parsed = calendarEvent.safeParse(data);
    if (!parsed.success) return { data: {} };
    const event = parsed.data;
    if (calendarMemberAddress !== undefined && event.attendees) {
      // The runner checks ownership before accepting a calendar copy's self flag.
      const member = event.attendees.find(a => (a.email ?? a.emailAddress?.address)?.toLowerCase() === calendarMemberAddress);
      const self = event.attendees.find(a => a.self);
      event.attendees = event.attendees.filter(a => a === member || a === self);
    }
    return { data: event };
  }
  const projected = result?.safeParse(data);
  return { data: projected?.success ? projected.data : data };
}
