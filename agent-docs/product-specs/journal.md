# Journal

Last verified: 2026-08-31

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
daily summary.

An accepted plan can appear when its canonical note exists. A completed
exercise or workout appears as an activity. A suggestion, reminder, or proposed
exercise is not an event until the member accepts or completes it.

Journal shows one main sleep for each local date. Main sleep has no clock time.
Shorter sleep stays visible as a timed nap. When a provider does not label sleep
type, the longest session becomes main sleep. A long duplicate stays with main
sleep instead of becoming a nap.

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
`/journal` only reads the current projection. It does not call AI and does not
start a new analysis.

## Web experience

`/journal` shows the seven days ending on the selected day as a calm timeline.
`Today` ends the window today. Previous and next move the full window by seven
days, so Monday still includes the prior Tuesday through Sunday. Day bands
separate the days.
Main sleep uses `Night`, naps use their time, and context can span a full day.
Event text is readable without opening a detail view. Source labels stay
available as secondary hover and screen-reader detail. A record with a canonical
time zone keeps its local event time during travel.

The right rail shows a small calendar, seven-day sleep and activity statistics,
and a current Personal Pattern when one is ready. A Pattern is an insight about
the week, not a health event, so it does not appear on the daily timeline. The
page supports loading, unavailable, empty, error, and ready states.

The web does not provide edit or add controls. A member asks Murph to add,
correct, or remove an entry. Calendar, email travel, Environment, private chat,
and approved group capture all write the same canonical events that Journal
already reads. They do not infer records from page state or store facts in the
Journal projection.

## Ownership

Canonical event and metric stores own the data. `@murphai/query` owns the
derived Journal view. Browser Vault carries it to the web. Murph uses existing
event commands for note writes and corrections.

Do not add a Journal table, `journal_day` writer, daily compaction job, or
page-open analysis.
