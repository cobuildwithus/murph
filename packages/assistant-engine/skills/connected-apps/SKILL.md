---
name: connected-apps
description: Use when Murph needs a connected email, calendar, document, storage, note, or task account; an approved accountless service such as weather, places, provider registry, product search, or Instacart; account connection or removal; connected-app context for another action; or a verified manual export fallback for an unsupported health or fitness data source. Covers account selection, narrow discovery and reads, approved email and calendar writes, privacy, untrusted provider content, and official provider export handoffs.
---

# Connected apps

Use connected apps to get the small piece of current information a task needs,
or to run one approved service action. Keep a specific request specific and do
not scan a whole account.

Before choosing an account, searching for a tool or reading account data, read
`$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/references/reading.md`. It covers
account choice, tool discovery, narrow reads, group limits and outdoor reminder
location. This page covers everything else.

When an app is not connected, was declined, or does not help, carry on from the
vault or the browser, or ask for the one missing fact. Never hold up another
task until an account is connected.

## Built-in services that need no account

- Google Maps: finding health-relevant places such as providers, clinics, labs,
  pharmacies, gyms, grocery stores and restaurants. Mapbox stays Murph's tool
  for geocoding, distance and routing.
- NPPES/NPI lookup: a provider's registry identity, NPI number, taxonomy and
  official practice details. It says nothing about availability, insurance
  participation, quality or whether they take bookings.
- Amazon and Walmart search: finding health-relevant products. These tools
  cannot buy anything. To order, read the `computer-use` skill.
- Instacart: finding nearby retailers, or creating a shopping-list or recipe
  page for the member to open. The page does not place or pay for an order.
- OpenWeather: current weather, the five-day forecast, or current outdoor air
  quality, when it changes advice tied to a time and place. Use a known
  activity location or ask for a city or region, and never ask for an exact
  address for this. Outdoor air quality says nothing about indoor air. Leave a
  future plan as it is when the weather is not yet known, and check closer to
  the date. These readings are not official alerts, and there is no UV data.

## Send an email

When a member in a private chat asks Murph to send an email, send it through
their connected Gmail or Outlook account. Do not open the browser to sign in to
webmail or hand the sending back to the member when a connected account can do
it. Use the browser only for something the connected route cannot do.

An email reaches another person, so the member's request in this conversation
has to make three things clear: which account sends it, exactly who receives
it, and what it says. Ask one specific question when one of them is unclear.
Never add a recipient the member did not name. Never send personal email from a
group, a scheduled automation, a maintenance turn or a system notification.

Use one of these fixed routes with `murph.connected_apps_execute`. There is no
need to search for a send tool.

- `GMAIL_SEND_EMAIL` with `agentApproved: true`, `recipient_email`, `subject`,
  `body`, and optional `cc`, `bcc`, `extra_recipients` and `is_html`
- `OUTLOOK_SEND_EMAIL` with `agentApproved: true`, `to_email`, `subject`,
  `body`, and optional `to_name`, `cc_emails`, `bcc_emails` and `is_html`

These routes cannot attach files. Send plain text unless the member supplied
HTML or the formatting matters.

When the provider reports success, the email is sent. When a send fails or the
result is unclear, never send it again. The tool result explains how to check
the account's Sent mail for this exact message. If it is still unclear after
that check, tell the member the outcome is unknown and wait for their
direction.

If the member has no active account for the provider they want, call
`murph.connected_apps_manage` with `action: "connect"` for `gmail` or `outlook`
and give them the returned connection link plainly. The account counts as
connected only after a later `action: "list"` shows it as active. On the
member's next message about it, list the accounts and send the email if the
sender, recipients and content are still clear from the conversation.

## Add a calendar event

When the member asks to add a confirmed event to their calendar, use one of
these fixed routes:

- `GOOGLECALENDAR_CREATE_EVENT` with `agentApproved: true`, `summary`,
  `start_datetime`, `timezone`, `event_duration_hour`,
  `event_duration_minutes`, and optional `location` and `description`
- `OUTLOOK_CALENDAR_CREATE_EVENT` with `agentApproved: true`, `subject`,
  `start_datetime`, `end_datetime`, `time_zone`, and optional `location` and
  `body`

Events go on the primary calendar only. Add no attendees, recurrence or meeting
link, and do not add a booking that is still pending or that failed. When a
create fails or the result is unclear, search the calendar for the event before
doing anything else, and do not repeat the create call blind.

Every other connected surface is read-only.

## Connect, rename or disconnect an account

Start a connection only when the member asks for it or accepts an offer, and
give them the returned link plainly. Rename only the account they picked.
Disconnect only when they ask to remove that specific account.

## Health and fitness services Murph cannot connect to

Check the list of supported wearable connections in your standing instructions
first. When the service is on it, use that connection flow.

When it is not, and the member wants their existing data from the service, read
`$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/references/provider-data-exports.md`.
It has verified export steps for Function Health, Livongo and Teladoc Condition
Management, Strong and Hevy. Do not search connected apps for a health
integration, and do not say a service is supported because it appears in that
file.

Give the member the official link from that file and the fewest steps that get
them the file. Ask for the original download, and call the result a manual
export or one-time import, since nothing keeps syncing afterwards. The member
does the export themselves. Operate the provider's site with `computer-use`
only when they ask Murph to and that skill allows it. When the file arrives,
save it and record its facts the way Murph handles any health record. In a
group, ask the member to continue in their private chat before any account data
is shared.
