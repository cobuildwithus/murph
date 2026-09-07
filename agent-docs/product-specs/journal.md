# Journal

Last verified: 2026-09-06

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

New calendar and email connections are eligible for automatic context only
after one private notice. Existing connections become a silent baseline and
remain unchanged. The member can stop all automatic capture or one category
without disconnecting the account.

At 08:00 and 16:00 local time, calendar capture reads only the next 36 hours.
It includes clear training, matches, races, sauna, recovery, long travel,
flights, and outdoor plans. It excludes medical care, dental care, therapy,
tests, procedures, work, and private social events. It reconciles a moved or
removed source event into the same Journal plan.

The 08:00 pass also uses narrow transport and lodging confirmation searches.
Its first pass looks back at most 90 days for future travel. It groups one trip
into one normalized itinerary and stores no message body, price, booking code,
attachment, exact address, or other traveler. Calendar events and trips get at
most one follow-up after passive evidence is checked first.

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
