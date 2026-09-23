# Journal

Last verified: 2026-09-08

## Product boundary

Journal is one private timeline of useful health context. It combines existing
canonical records for display. It is not a second health-data store.

A day can show sleep, workouts, meals, device metrics, tests, and private notes
as human events. Source records remain separate canonical truth. Journal groups
them at read time through existing links and small deterministic rules.

## Capture

Murph quietly saves clear facts from a private conversation. It saves one note
for each independent fact and keeps known time, amount, duration, temperature,
or intensity. It saves what the member reports. It does not guess a cause.
Exact details stay in the note. Small tags also classify timing and amount for
bounded comparisons.

Clear facts remain eligible when the member asks for advice. Missing time or
intensity does not block a save. Hypothetical questions are not events. An
explicit no-retention request prevents capture.

A member's speculative explanation is not a separate Journal fact. Save the
reported observation without that speculation. When asked whether a fact was
saved, Murph checks the relevant canonical records. It acknowledges and repairs
a missed eligible capture without inventing an explicit-logging requirement.

Canonical persistence and current page visibility are separate facts. Murph
does not diagnose a filter, stale page, or sync failure without evidence, invent
filter controls, or claim an unverified refresh. It can explain that opening
Journal requests updated data and that the member can select the relevant date.
It never creates legacy Journal days or day links to make an event appear.

Journal titles and notes use English. Chat replies use the member's language.
Titles name the event without relative-day words or dates. Notes add detail
that the title does not contain. When no detail exists, the required note
matches the title exactly, and the view hides the duplicate.

The typed note command offers `--timing` and `--icon`. These options use the
shared catalog in `@murphai/contracts` and persist through existing event tags.
Timing tags are `timing-timed`, `timing-all-day`, `timing-morning`,
`timing-afternoon`, `timing-evening`, `timing-night`, and `timing-unknown`.
Icons use `journal-icon-<id>` tags. Unrelated tags remain intact.

An exact time requires an explicit timestamp. A sustained day-level symptom
can use `all_day`. A known period retains that period. A missing time uses
`unknown`, which shows no clock time. A date-only timestamp remains a storage
anchor, never evidence of an observed time. The note retains the vault time
zone so its local date survives projection.

Murph can ask for an activity's approximate time after saving its known period.
The answer corrects the existing record. A sustained report across explicitly
reported days can create one note per day. Corrections retain the record ID
and unrelated tags. Existing untagged timestamps remain unchanged.

Murph reads the command help for supported icons and chooses a matching asset.
The catalog offers 49 icons, including 41 reused product icons. Examples include activity,
walking, meals, medication, caffeine, hydration, sauna, and recovery.
The `note` fallback keeps the existing notebook symbol when no icon fits.
Unknown or conflicting icon tags also use the fallback.

Eight Journal icons use the same Quiver SVG style: `bath`, `shower`, `headache`,
`fatigue`, `muscle-soreness`, `abdominal-pain`, `nausea`, and `congestion`.
Icons display their original vector artwork and colors. Use the default when
a fact has no matching icon.

The supported note types are:

- `journal-factor` for an action or exposure;
- `journal-context` for relevant context or an environment change;
- `journal-outcome` for a reported feeling or result;
- `journal-plan` for a future intention.

Factor and context notes use a stable `key-*` tag and explicit `happened` or
`did-not-happen` evidence. Subjective outcomes use a stable `key-*` plus a
`value-*` containing a reported 0–10 score or a supported reported level.
Numeric ratings and verbal levels use distinct outcome keys so their different
scales are never combined. Unscored symptoms and relative changes remain Journal facts without fabricated
scores; the Patterns reader cannot use them as scored outcomes. Completed
actions are factors, not subjective outcomes. Missing reports remain unknown.

Murph does not announce routine saves. It asks a private question only when an
important fact is unclear. A clear correction from the member wins. If a plan
did not happen, Murph removes the plan and can save an explicit absence for the
factor.

Automatic capture always writes to the member's private Journal. An
authenticated group can propose a clear fact about its sender after the member
accepts one private global choice. Unclear facts get one private question. A
member can exclude one group or all groups. The group never receives private
Journal or Patterns data.

Environment remains the owner of current Environment values. Each real value
change also creates one idempotent canonical `journal-context` event. Journal
therefore shows when the context changed without keeping a second Environment
history.

Active calendar and email connections are eligible for automatic context in the
first scheduled pass, regardless of connection age, missing timestamps, or legacy
baseline/notice markers. No heads-up message is sent and no extra day is required.
Global/provider/category opt-outs and source mappings survive migration. Opt-outs remove matching
upcoming context without disconnecting the account or deleting Journal history.

One managed pass runs at 08:00 local time. It reads a fourteen-day calendar window,
using exact UTC boundaries from the cron host, and reconciles known ongoing and
future plans outside that discovery window by their source identities. It retains
training, matches, races, sauna, recovery, long travel, flights, and outdoor plans,
and relevant non-sensitive life changes affecting existing support. Clear all-day
travel and races preserve date-only meaning. Medical care, dental care, therapy,
tests, procedures, ordinary work, and private social events remain excluded.

The same pass searches narrowly for transport, lodging, relevant registration,
and change/cancellation confirmations. The first email pass looks back at most
90 days for future travel; later passes read new or changed confirmations. One
trip remains one normalized Journal itinerary, with linked calendar/email evidence,
segments, departure/arrival and return timing, timezones, status, and practical
constraints. It retains no email body, price, booking code, exact address,
attachment, or other traveler's data. Complete source evidence reconciles moved
or canceled plans and follow-ups; a failed read or window absence is not deletion.

Existing follow-ups remain: check passive evidence first, at most one per event
or trip, and calendar check-ins one hour after a timed event ends. Date-only
all-day plans never infer an overnight check-in from a midnight boundary. Routine Journal
writes and upcoming-context refreshes stay silent.

The morning pass uses `gpt-6-sol` with low reasoning effort for contextual
reconciliation of existing reminders as well as connected plans. Cron admits it
even when there is no connected-context ledger or connected account, because
member-supplied facts can still require reminder repairs. The skill checks saved
opt-outs before account selection or any connected-app call. Morning runs have
ordinary vault read/write access and the normal automation editing tool; they do
not use a separate reminder permission list. Existing member/conversation ownership
and version-checked writes remain authoritative. Ordinary managed
reconciliation archives the fixed afternoon automation without removing its
Journal records or standalone follow-ups. Existing paused/archived morning records
retain their status; active records converge to the current recipe.

Canonical `journal-plan` notes own a structured `plan` field containing end,
status, verification time, category, and optional connected account. Existing
fields retain start, timezone, source identity, title, and full normalized note.
The typed note command accepts the event timezone and plan fields. Creation with
a repeated external source identity returns the existing plan; deletion prevents
a retry from resurrecting it. Reconciliation reads the exact event and uses
revision-checked edits, preserving direct member corrections and secondary
calendar/email aliases in the existing connected-source ledger.
`event edit` exposes the same sparse plan fields plus `--expected-revision`;
rescheduling and successful re-verification update the existing record. Source
keys longer than 200 characters are hashed deterministically on typed creation.

The existing context snapshot derives upcoming entries from current canonical
revisions. There is no separately authored factual Knowledge page. Canonical
and ledger-policy write receipts invalidate the Journal section, including on
restore/replay; stale facts stay unavailable until rebuilt. The same ledger
normalizes global/account/provider/category opt-outs and supported active accounts.
Unrecognized legacy policy suppresses automatic context until the morning pass
preserves and normalizes its controls. Opt-outs require no separate cleanup write.
Historical Journal records remain intact.
The ledger's first body line contains only compact JSON controls; its source
mappings follow under `## Sources` in the same document. History growth cannot
exhaust the bounded control read. Compact legacy JSON remains readable and the
normal capture pass separates legacy mappings without discarding them. A
successful account disconnect updates this same ledger immediately using the
returned exact account ID and the Knowledge writer's revision check.

The snapshot reader performs a bounded local read (128 KiB) and injects at most
8 KiB of upcoming navigation and details. Projection work runs in the existing
background lane, bounded to 128 shards and 100,000 records with preemption; its
serialized plan section is at most 24 KiB. Incomplete source reads produce an
unavailable indication, not false absence. Navigation takes priority over verbose
logistics, with exact canonical retrieval when details or additional plans matter.
Every private conversation, resumed turn, and ordinary scheduled turn reads fresh
state; groups and maintenance retain their existing isolation. Expiry is evaluated
at read time, and verification older than 48 hours is stale. A planned departure
does not prove arrival, current location, or realized experiment context.
Navigation preserves canonical all-day/period/unknown timing independently of
optional details; legacy summaries with no precision marker remain unknown.

The current Journal page still navigates today and historical days. Upcoming
context does not add a future-date browser to that page; a saved plan appears
on its occurrence date once that date is selectable and the view is refreshed.

Before advice or reminder wording, Murph considers upcoming plans that affect
what is practical, even when the member does not mention them. Relevant plans
shape the answer and one useful preparation or adjustment; unrelated questions
do not acquire plan mentions or extra check-ins. The context
never grants permission to reschedule a fixed reminder, change the member timezone,
pause an experiment, or treat a future plan as an observed confounder. Permanent
experiment evidence continues through the existing canonical experiment owner.

## Read model

The Journal projection reads canonical events and metric points from the last
120 days. It includes notes, activities, sleep, meals, observations,
interventions, context, symptoms, and tests. It groups linked records and
related sleep metrics into one human event. It does not copy records or write a
daily summary. Observation dates, metric keys, and numeric units use the
canonical metric rules before grouping; raw values never replace normalized
minutes or other canonical units. Historical observations are filtered by date
before numeric normalization. Metric selection scans the history once, and
experiment phases expand only within the visible projection window while
retaining their original progress day numbers.

An accepted plan can appear when its canonical note exists. A completed
exercise or workout appears as an activity. A suggestion, reminder, or proposed
exercise is not an event until the member accepts or completes it.

Journal shows one main sleep for each local date. Main sleep has no clock time.
Shorter sleep stays visible as a timed nap. When a provider does not label sleep
type and there is no explicitly labeled main sleep, the longest session becomes
main sleep. With an explicit main sleep, a short unlabeled session stays a nap.
A long duplicate stays with main sleep instead of becoming a nap.

Repeated activities of the same kind on one day become one display event. The
event keeps all source sessions and shows their combined time. Personal
Patterns still receives the full source records. Journal hides static profile
records and total-sleep metrics already represented by a sleep session. When
two providers expose the same daily score, Journal uses the provider's product
term, such as Oura Readiness or Whoop Recovery, without showing a duplicate.

Seven-day sleep averages use main sleep only. Seven-day activity uses the
grouped source sessions once.

The old `journal_day` surface stays untouched. The new Journal view does not
depend on it.

Imported clinical records use human-readable labels and source names. Raw FHIR
objects, coding-system identifiers and source identity keys stay in canonical
evidence rather than display copy. Records explicitly dated only by retrieval
or source-update metadata do not enter dated Journal bands.

Clinical notes and tests from the same source resource, revision and clinical
day form one entry. Distinct source resources or clinical days remain separate.
When a legacy document-extraction facet was placed on the retrieval/recording
day despite an older dated source parent, without explicit date provenance,
Journal omits the ambiguous facet from dated bands and retains the original
source report on its documented date. Host-tagged document/source dates and
other historical dates remain intact. The projection never rewrites evidence.

The projection is built during the existing Browser Vault refresh. Opening
`/journal` shows the available projection and requests one runtime refresh.
The ready timeline has no Refresh control; unavailable older projections offer
a retry. Automatic refresh does not call AI or start a new analysis.

The page waits for a different replica through the existing bounded refresh
window. A busy runtime can delay publication beyond that window. Existing
content stays visible after waiting stops. Reopening the page starts another
bounded refresh. When the first device import is pending and no replica exists,
Journal observes publication through the same 60-second bounded window. The
import remains responsible for publication, without a competing runtime wake.
Repeated retry clicks do not restart an active wait. This is not continuous
polling while the page remains open.

## Web experience

`/journal` shows the seven days ending on the selected day as a calm timeline.
`Today` ends the window on the browser local date and follows date changes while
the page stays open. An explicitly selected historical window stays in place.
Previous and next move the full window by seven days, so Monday still includes the prior Tuesday through Sunday. Day bands
separate the days.
Main sleep uses `Night`, naps use their time, and context can span a full day.
Event text is readable without opening a detail view. Source labels stay
available as secondary hover and screen-reader detail. A record with a canonical
time zone keeps its local event time during travel.

Approximate periods show `Morning`, `Afternoon`, `Evening`, or `Night`.
Full-day notes show `All day`. Unknown times leave the time column empty.
Period sorting anchors order rows without displaying invented clock times.

The right rail shows a small calendar, seven-day sleep and activity statistics,
and a current Personal Pattern when one is ready. A Pattern is an insight about
the week, not a health event, so it does not appear on the daily timeline.
Historical statistics name the selected date range. Chart weekday labels keep
their calendar date in every browser time zone. The calendar marks its
selected end date separately from today, including for assistive technology. The
page supports loading, unavailable, empty, error, and ready states. Empty
timelines retain the background refresh status while showing onboarding.

The web does not provide edit or add controls. A member asks Murph to add,
correct, or remove an entry. Calendar, email travel, Environment, private chat,
and approved group capture all write the same canonical events that Journal
already reads. They do not infer records from page state or store facts in the
Journal projection.

## Native iOS experience

A single native Home card previews the current day and opens the full Journal
page, with no dedicated Journal tab. It reads the same saved projection through
`GET /api/device-sync/companion/journal`. The route derives the member from
Privy bearer authentication, enforces current Browser Vault access and consent
before and after loading the encrypted core shard, and returns only Journal
plus freshness with `no-store`. Opening the page never wakes the runtime.

The app shows newest days first, reveals earlier weeks as the member scrolls,
and stops at the projection's bounded history window. Top controls offer Today
and a native calendar drawer. Tapping an entry opens a native detail drawer
with its summary, metrics, additional details, and source records. Seven-day
summary values use main sleep and grouped activity once. Additions and
corrections remain conversational. Home and Personal Patterns keep their
separate presentation owners.

Native feed previews use at most three lines. The entry drawer retains the full
summary, and long secondary source text expands on demand. Date-only records
never display a fabricated clock time.

The response remains in session memory using ephemeral networking. Sign-out,
account changes, and consent recovery clear it; late responses cannot restore
an old session's records. Loading, unavailable, empty, stale, and retry states
remain distinct. Deploy the additive read endpoint before distributing the
native app; an older server produces a retryable unavailable page.

## Ownership

Canonical event and metric stores own the data. `@murphai/query` owns the
derived Journal view. Browser Vault carries it to the web. Murph uses existing
event commands for note writes and corrections.

Do not add a Journal table, `journal_day` writer, daily compaction job, or
page-open analysis.

## Deployment

Deploy the Web reader before the runtime writer starts producing new timing
values. Older replicas remain readable. Existing records are not rewritten by
this change. After both deploys, verify a new note, a correction, and a page
refresh through the hosted path.
