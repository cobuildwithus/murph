# Journal Connected Context Completion

## Outcome

Finish the approved Journal plan without adding a second data owner. Environment
changes, relevant calendar plans, and narrow email travel facts become canonical
private events. Personal Patterns sends one first complete digest. Journal shows
a rolling seven-day window ending on the selected day.

## Scope

- Write one canonical `journal-context` event when an Environment value changes.
- Preserve the Environment recorder as the Environment state owner.
- Send one bounded Personal Patterns digest after the first complete import,
  while keeping partial imports quiet.
- For newly connected calendars, explain use privately before automatic capture,
  then read the next 36 hours at 08:00 and 16:00 local time.
- Create, move, or remove relevant planned Journal events and their existing
  one-shot follow-ups. Exclude medical and private categories.
- For newly connected email accounts, explain narrow travel use privately,
  import future travel from a bounded 90-day first pass, and process later
  confirmations once per day.
- Store normalized itinerary facts only. Do not store message bodies, booking
  codes, attachments, prices, or other travelers.
- Reuse connected-app reads, canonical events, managed automations, and private
  delivery. Add no scheduler, queue, service, database, or dependency.
- Change Journal navigation to a rolling seven-day window, not a calendar week.
- Do not deploy, apply migrations, create a PR, or mutate member data.

## Product UX

Feature effort. A member should see useful life context without maintaining a
second diary. Automatic connected-app use starts only after a clear private
notice. The member can opt out globally or by category through Murph.

Affected people:

- a member changing a home Environment value;
- a member finishing the first complete device import;
- a member connecting a personal or shared calendar;
- a member with a relevant activity, moved event, cancelled event, medical
  event, or all-day event;
- a member connecting email with one trip, several linked segments, a changed
  itinerary, or a cancellation;
- a member reviewing Journal on Monday or another sparse current week;
- a member with no connected calendar or email account.

## Simplicity Boundary

- Canonical events remain the only Journal truth.
- Connected apps remain read owners. Journal stores only normalized facts.
- One itinerary represents one trip. One follow-up represents one relevant
  completed event or trip.
- No inbox scan, calendar history, movement history, consent framework, or
  duplicate integration service.
- No proactive follow-up for medical calendar events.

## Proof

- Deterministic tests cover Environment event identity, managed schedules,
  connected-account completion time, and rolling date windows.
- Focused real-Codex journeys prove the notice boundary, calendar ownership and
  filtering, one-shot follow-up, travel grouping and redaction, and the bounded
  first complete Patterns digest.
- Journal production and design-study components render the same rolling window
  on desktop and mobile.

## Completion

- [x] Environment changes create one canonical Journal event.
- [x] The first complete Patterns report creates one bounded digest.
- [x] Calendar plans and check-ins follow the approved consent and privacy rules.
- [x] Email travel creates one narrow itinerary and at most one useful check-in.
- [x] Journal shows a rolling seven-day window.
- [x] Focused deterministic and live-model proof passes.
- [x] Durable docs and changelog match the shipped behavior.
Status: completed
Updated: 2026-08-31
Completed: 2026-08-31
