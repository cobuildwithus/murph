---
name: connected-apps
description: Use when Murph needs a connected email, calendar, document, storage, note, or task account; an approved accountless service such as weather, places, provider registry, product search, or Instacart; account connection or removal; connected-app context for another action; or a verified manual export fallback for an unsupported health or fitness data source. Covers account selection, narrow discovery and reads, approved email and calendar writes, privacy, untrusted provider content, and official provider export handoffs.
---

# Connected Apps

Use Murph's connected-app tools to recover the smallest amount of current,
task-relevant context or to use one approved service operation. Do not turn a
specific request into a broad account scan.

Read `references/reading.md` before selecting accounts, discovering tools, reading
provider data, or resolving outdoor-reminder location. It owns the shared read,
privacy, group, and location rules. The sections below own other capabilities.

## Unsupported health and fitness sources

A request to connect, sync, or import a health or fitness service does not make
that service a connected-app provider. First use the trusted live provider list
in the current prompt to determine whether Murph has a real direct connection.
If a direct route is proven, use its device or app connection owner and do not
substitute a manual export.

When no direct connection is proven and the member wants existing data from the
service, read `references/provider-data-exports.md`. That reference owns the
verified fallback routes for Function Health, Livongo/Teladoc Condition
Management, Strong, and Hevy. Do not use `murph.connected_apps_search` to hunt
for an arbitrary health integration, and do not claim support because a provider
appears in the reference.

Give the provider's verified action link—an account or export page when one is
documented, otherwise the official instructions—plus the smallest useful steps.
Ask for the original downloaded file and describe the result as a manual export
or one-time import rather than a live sync. The member performs the export by
default. Use `computer-use` only when they explicitly ask Murph to operate the
portal and that skill permits the action. Once a file arrives, the global
health-record ingestion invariant owns preservation and canonical extraction.
In a group, ask the member to continue privately before sharing account data.

## Prefer connected email over webmail

When a current private user request calls for an email, use a connected Gmail
or Microsoft Outlook account before considering computer use. Do not send
personal email from a group, scheduled automation, maintenance turn, system
notification, or output-only continuation. List accounts when the sender is
unclear. If the requested provider has no active account, use
`murph.connected_apps_manage` with `action: "connect"` for `gmail` or `outlook`,
return the Composio connection URL plainly, and do not claim the account is
connected until a later list shows it as active. After authorization, list the
provider accounts on the next relevant user turn and continue only if the
sender, exact recipients, and substantive content remain clear in the current
conversation.

Do not open computer use merely to sign into Gmail or Outlook, operate webmail,
or hand the send back to the user when an approved connected-app route can do
it. The provider OAuth page reached from the connection URL is the expected
browser handoff; Murph should perform the actual send through connected apps
after authorization. Use computer use only when the requested email workflow
requires a web-only capability that the approved routes cannot complete.

## Use approved built-in services precisely

- Use Google Maps for health-relevant place discovery such as providers,
  clinics, labs, pharmacies, gyms, grocery stores, and restaurants. Keep Mapbox
  as Murph's geocoding, distance, and routing layer.
- Use NPPES/NPI lookup for registry identity, NPI numbers, taxonomy, and
  official practice metadata. It does not prove availability, insurance
  participation, quality, or current booking status.
- Use Amazon and Walmart search only for health-relevant product discovery.
  These tools do not purchase; read `computer-use` for ordering.
- Use Instacart to find nearby retailers or create shopping-list or recipe
  handoff pages. A handoff does not place or pay for an order.
- Use OpenWeather current weather, next-five-day weather, or current outdoor air
  quality only when it materially affects time- and location-specific advice.
  Use a known activity location or ask for city/region, never an unnecessary
  exact address. Outdoor air quality is not evidence about indoor air. Do not
  change future scheduling because weather is not yet known; check closer to
  the date and adjust if conditions change. Raw weather, AQI, and forecast reads
  do not establish an official alert. Do not claim unsupported UV data.

## Writes and account management

Treat connected surfaces as read-only except for these server-approved writes
after the current user requests the exact action.

### Send an email

Use one of these fixed routes without searching for a different send tool:

- `GMAIL_SEND_EMAIL` with `agentApproved: true`, `recipient_email`, `subject`,
  `body`, and optional `cc`, `bcc`, `extra_recipients`, and `is_html`
- `OUTLOOK_SEND_EMAIL` with `agentApproved: true`, `to_email`, `subject`, `body`,
  and optional `to_name`, `cc_emails`, `bcc_emails`, and `is_html`

The current private user request must authorize the sender account, exact
recipients, and substantive message content. Resolve those from the current
conversation when they are already clear; otherwise ask one narrow question.
Never infer or silently add recipients. Do not include attachments through
these routes. Prefer plain text unless the user supplied HTML or formatting
materially matters.

A successful provider response is completion. If a send fails or returns an
ambiguous result, do not retry it. Search the selected account's Sent mail in a
narrow window at or after this attempt for a message matching the exact primary
recipient, subject, and substantive body. Older, duplicate, or partial matches
do not prove this send completed. If the result remains uncertain, tell the user
the outcome is unknown and take no further write action without fresh direction.

### Add a confirmed calendar event

- `GOOGLECALENDAR_CREATE_EVENT` with `agentApproved: true`, `summary`,
  `start_datetime`, `timezone`, `event_duration_hour`, and
  `event_duration_minutes`
- `OUTLOOK_CALENDAR_CREATE_EVENT` with `agentApproved: true`, `subject`,
  `start_datetime`, `end_datetime`, and `time_zone`

Create on the primary calendar only. Exclude pending or failed bookings,
attendees, recurrence, and meeting links. On failure or ambiguity, do not retry
the create call; search the selected calendar for the event first.

Connect an account only when the user asks or accepts the connection flow.
Return the action URL plainly. Rename only the exact selected account.
Disconnect only when the user explicitly asks to revoke that exact account.

Do not force connection or block another task when an app is unavailable,
disconnected, declined, or unhelpful. Continue from vault and browser context or
ask for the single missing fact.
