# Personal Patterns

Last verified: 2026-09-12

Runtime and Browser Vault derive pattern evidence from the same full canonical
source loader, including raw wearable observations. Public query summaries and
replica entities retain their visibility filters; source provenance stays inside
the calculation. Runtime Patterns rebuilds the needed metric evidence from this
local snapshot instead of reading the stripped SQLite display summaries.

## Product boundary

Personal Patterns finds links between a member's context and a later sleep,
recovery, or reported outcome. It reports an association. It does not claim a
cause, diagnose a condition, or tell a member to change treatment.

The deterministic query owns every number shown in the product. AI can extract
structured Journal notes, explain a saved result, and audit the query. AI does
not calculate the product report.

## Inputs

The query reads existing canonical events and metric points. It does not copy
source records into a Patterns store.

Eligible factors include:

- completed activity and intervention sessions;
- supported provider notes, including the existing Oura sauna rule;
- private notes with `journal-factor` or `journal-context` note types;
- explicit factor details such as time, duration, amount, intensity, or sauna
  temperature when the note contains them.

The first bounded detail tags use morning, afternoon, evening, or late timing;
low, moderate, or high amount; duration buckets; and sauna temperature buckets.
The note keeps the exact value. The query does not create a new comparison for
each exact number.

A Journal factor note uses a stable `key-*` tag. It also uses one of these
states:

- `happened` means the factor occurred;
- `did-not-happen` means the member confirmed its absence;
- `planned` means the factor is only an intention and is excluded.

Missing data stays unknown. Silence does not prove absence. A provider record
can prove that something happened, but an absent provider record does not prove
that it did not happen.

## Group-derived Journal facts

An authenticated group can propose a fact only for the sender of the selected
accepted message. The web checks that current-sender authority again before it
queues any private work. The group runtime receives only a handled or
unavailable result. It does not receive the member's consent state or private
Journal data.

The first clear fact asks for one global choice in the member's direct chat.
While that choice is pending, later group facts are not retained. The member
can state them again after enabling capture.
After consent, later clear facts save without another question. One useful
ambiguity causes one private question. Weak claims, jokes, quotes, facts about
another person, and unclear dates do not save. A member can disable capture for
one group or for all groups and can change either choice later.

The private member runtime remains the only writer. It imports the encrypted
mailbox item through the normal Journal note path. Factor and context notes get
the same stable `key-*` tag as direct Journal input, so the next deterministic
Patterns report can use them. Plans stay marked `planned` and remain excluded.

Deploy the mailbox consumer before the web producer. Recycle older warm member
runtimes before the web starts emitting the new mailbox item. Then apply the
web schema migration and deploy the web action. This order prevents an older
runtime from rejecting a new private Journal item.

Independent facts use independent notes. One message can therefore create more
than one note. A multi-day trip, illness, or holiday uses one `episode-*` tag so
the query counts it as one episode, not several independent events.

Eligible outcomes include total sleep, sleep score, sleep efficiency, deep
sleep, REM sleep, Readiness or Recovery score, HRV, resting heart rate,
respiratory rate, SpO₂, and private `journal-outcome` notes when the canonical
data exists. Subjective outcomes keep the member's wording and use a bounded
value tag for calculation. They use the same-day window. Sleep and recovery
metrics use the next-day window.

## Bounded comparisons

The default report covers 120 days. Each factor uses a small fixed set of
product-owned comparisons. The first version focuses on the same day and next
day outcome windows. It does not search every threshold, delay, combination, or
context.

Device-backed inferred absence is date- and source-specific. The candidate day
must have a directly observed daily step count from the same underlying source,
import route, and known device instance. A valid zero is observed data. Session
aggregates, sleep-only data, and workout percent-recorded are not daytime
coverage. The fallback requires 17 observed days in the trailing 21 days and
four recorded session dates spanning 14 days within 120 days of the candidate in the same source
history. It excludes the latest two calendar days. These are explicit product
assumptions about a functioning recorded-session feed, not guarantees that every
activity was detected or imported. Query inputs do not expose provider pagination
completion, permission history, or recording-mode changes.

Confirmed absence and qualified inferred absence share one control pool. The
comparison says confirmed absence only when every selected control has explicit
absence evidence. Conflicting presence and absence excludes the date. Manual
notes retain descriptive unobserved comparisons and their existing grade-D cap.
Known dated illness and travel context excludes activity comparisons; unmentioned
context is not imputed. Only the latest uninterrupted observed factor-source and
outcome-source periods participate.

Within the report window, a bounded deterministic assignment selects up to three
unique controls per exposed date. It maximizes first controls before second and
third controls, then minimizes pre-exposure covariate distance and calendar
distance. Weekday must match exactly; dates must be within 35 days. Neither side
is reused. Selection never inspects the target outcome value. Available prior-day
outcome values and preceding seven-day mean steps (at least five observed days)
provide a small comparison profile. A profile requires 70% coverage on each side;
known values cannot match missing values. Numeric calipers use 0.75 robust scale,
with fixed resolution floors. Known previous-day exposure status must agree.

Explicit overlapping episodes merge transitively; consecutive exposed days also
form one episode. Each episode receives equal weight, its matched exposed days
receive equal weight, and each day's controls share its comparison weight.
Both displayed averages and their percentage use those same actual observations.
The drawer counts distinct contributing dates, independently of episode count.
No new drawer copy or presentation controls are added.

A directional result requires at least six episodes across 42 days and six
occupied weeks. The episode floor increases by
`ceil(log2(max(1, searchedComparisons / 12)))`, plus two when no numeric profile
is available. The computational factor cap is chosen by recency and coverage
before inspecting results; search size includes all eligible factor/outcome
combinations before that cap. At least 60% of outcome-observed exposures must
remain matched. Outcome availability must reach 70% on each otherwise eligible
side, with a gap no greater than 20 percentage points.

The mean and median episode difference must meet the metric's existing absolute
or relative relevance floor. Six or seven episodes must all agree in direction;
larger histories require 80% agreement. Both chronological halves must agree.
A signal-to-variability screen scales with searched comparisons and caps its
information index by episode count and occupied weeks on both sides. Matched
profile imbalance must stay within 0.25 robust scale; both-missing profile weight
cannot exceed 20%.

No fortnight may supply more than 35% of exposed weight. Removing any episode or
any 14-day block from either side must retain direction and half the relevance
floor. One-control and 21-day-radius alternatives must retain at least 70% of
primary exposed weight to be usable; at least one must be usable and every usable
alternative must retain direction and half the floor. Unaffected matches stay
fixed during deletion checks. Recent evidence requires an exposed date within
28 days and outcome data within seven days. Positive and negative effects use
identical rules. Failed reliability retains actual averages in the existing
neutral state; absent comparisons use the existing insufficient state.

These are bounded product screening heuristics, not significance tests, causal
estimates, or validated false-discovery guarantees. Deterministic calibration
covers repeated annual windows with 90 correlated comparisons, serial noise and
calendar drift, alongside injected signals, coverage gaps, source changes,
confounded load, stale evidence and episode concentration. The limited synthetic
family is not a guarantee for real histories or every possible confounder.

Sleep quality uses one metric across the entire report, selected before factors
are evaluated: sleep score when it covers at least 70% of available completed
sleep dates and at least 14 dates, otherwise sleep efficiency under the same
rule. Only the selected metric enters the report. Missing score nights stay
missing; a factor's effect cannot cause metric substitution. Existing consumers
therefore keep their Sleep quality slot while displaying one coherent comparison.

## Result levels and grades

After passing the directional screen above, the existing internal grades remain:

| Grade | Product name | Minimum evidence                                |
| ----- | ------------ | ----------------------------------------------- |
| E     | Observation  | Legacy sparse-report compatibility only         |
| D     | Early signal | Cap for manual unobserved comparisons           |
| C     | Pattern      | Passes the directional screen                   |
| B     | Pattern      | Eight cases across 42 days                      |
| A     | Pattern      | Twelve cases across 56 days and a larger effect |

Grades describe evidence strength, not certainty or medical importance.
Legacy `new_clue`, `seen_again`, and `worth_testing` values remain compatibility
labels only.

The query uses the larger of each outcome's existing absolute and relative
meaningful-difference threshold. Changes to grade rules need focused synthetic
history tests. These tests must keep obvious baseline cases working while the
engine also searches for personal, less obvious links.

## Identity and current state

A result identity is its factor, outcome, comparison type, outcome window, and
context. Direction, effect size, grade, and classification are current state.
They do not create a second result.

The product keeps the current report. It does not keep a full grade history.
If corrected or removed evidence changes a result, the next calculation
replaces the old state. A result can therefore weaken, change direction, or
disappear.

The Browser Vault replica ref records the stable hash of its canonical query
inputs. A refresh skips the calculation when that hash is current. It checks
the hash again before publication. If evidence changes during calculation, it
does not publish the stale report. A later refresh keeps the newer evidence
pending and publishes a report for the newer hash.

## Presentation

The `/patterns` page shows the first 15 factors. Desktop compares every
supported outcome in a matrix. Phones show one card per factor, with coverage
bars and changed comparisons together. Tapping a mobile result opens a bottom
drawer with the same comparison details and evidence dates as the desktop
hover popover, with day counts beside comparison labels and no repeated metric
eyebrow above the result headline. Use `Other` beside a day count so the
comparison label does not repeat `days`. The coverage bars open a mobile drawer with
the recorded-day count as its headline and the factor name beneath it. This count can
differ from each comparison sample. Mobile cards omit neutral comparison controls and footers.
Cards with only neutral measures use a compact header with a plain
`No clear changes` status; their coverage bars remain tappable.
Measures that still need data are omitted from mobile cards. `Show more`
reveals the remaining report factors. The report keeps at most 100 sorted
factors to bound Browser Vault size and calculation work. The page requires at
least two recorded factor days and two contributing dates on each side of a
displayed result. Directional grading separately requires repeated independent
episodes. Activities (including
mixed activity factors) must have a recorded session within three calendar months
of the report date, inclusive; month-end cutoffs clamp to the last day of the
cutoff month. This uses the factor's latest observed date, even when that session
has no matched outcome. Legacy replicas use their latest matched exposure date
as conservative evidence of recency. Filtering happens before the 15-factor
limit and Show more; hidden history remains in Journal. A factor with no eligible
comparison is omitted. Grade E remains available in the underlying report, but
one-case observations do not appear on this page. The page shows the evidence
count, comparison basis, date range, and the factor and
comparison dates needed to inspect the result.

An empty report says that Murph needs more comparable data. The page does not
start a calculation. It reads the latest Browser Vault report.

## Native Home projection

The iOS Home screen reads the saved report through bearer-authenticated
`GET /api/device-sync/companion/patterns`. This reader checks current active
member access and launch consent before opening the Browser Vault core shard
and again before disclosing the report. It reuses Browser Vault member binding,
key unwrap, bounded decoding, and schema validation. The response contains only
`report` and `freshness`, uses `Cache-Control: no-store`, and never includes raw
source records. Missing reports return `report: null`; the reader does not wake
a runtime or start a calculation. Native retains presentation only in memory.
Deploy this additive reader before the native release. Existing Web consumers
remain unchanged; an older backend leaves the native section retryable.

## Proactive messages

The managed Personal Patterns automation checks each day at 13:00 local time.
Its model target is Luna with high reasoning, using the common Flex-first cron
policy and Standard retries after failures. Before a clean scheduled model attempt,
the exact managed recipe reads the current calculated report and the existing
notification ledger. It skips model entry when the first digest is complete, every
current factor was reviewed, and every current graded identity retains its reviewed
grade. Extra observations, effect-size changes within a grade, and the report date
do not alone require another daily model pass. New factors, identities, or grades
remain eligible. Manual runs, retries, edited instructions, and missing, legacy,
invalid, or degraded history retain ordinary model review.

The existing `personal-pattern-notifications` Knowledge page uses version 1 JSON:
`initialDigestSent`, `reviewedFactorIds`, `mutedFactorIds`, and `results`. Each result
stores `factorId`, `outcomeId`, `comparisonBasis`, `lagDays`, `lastSeenGrade`,
`firstSharedDate` (date or null), and `muted`. Identity includes the outcome's lag,
falling back to the report lag. Duplicate identities or unknown fields cannot prove
that a report is reviewed. The model converts legacy history only when all existing
history and preferences can be preserved; otherwise it retains that history and
normal model review. No second ledger, cache, or scheduler is added. First-digest
import completeness and vocabulary/alias normalization remain with the existing
model instructions; pending imports therefore retain model review.

It sends at most one private message per run. Partial initial imports stay
quiet. When source coverage proves the first report is complete, Murph sends
one first digest with at most three grade A-D highlights. If that report has no
grade A-D result, it marks the digest complete and stays quiet. Later new
results become one summary with at most three highlights.

The hosted runtime emits a privacy-safe internal email alert when this managed
run fails or when its occurrence starts too late and expires. Alert delivery
uses the existing operational email channel and does not change the member's
message. A complete platform outage requires an external uptime monitor,
because the runtime cannot report while it is offline.

Only a new grade A-D identity can trigger that daily message. Letter grades and
report classifications stay internal to selection and bookkeeping. Messages
lead with the finding in a short conversational paragraph, with a light qualifier
where evidence is limited and supporting counts in the report's actual unit.
Uncertainty belongs within the finding, without repeated caveats or a standalone
causation disclaimer. Messages preserve comparison and outcome timing without
implying cause or prescribing habit changes. Links use the full
`https://www.withmurph.ai/patterns` URL on its own final line; a bare route is
never a message link. Legacy grade E Observations stay quiet and are excluded by the page's existing evidence filter. A saved private ledger deduplicates result identities.
It also stores factor or result mutes requested in conversation. Grade changes
do not create separate messages. The weekly health insight can mention a useful
strengthening, weakening, or removed result.

## Weekly audit

The existing weekly Sol run reads the same bounded canonical evidence and the
deterministic report. It may submit one internal engine audit only when it finds
a stable, reproducible gap. The audit contains a short de-identified prompt for
Codex. It must propose a test before an engine change.

Pattern audits reuse the existing product-feedback storage with a reserved
summary prefix. The normal feedback email excludes them. The private ops page
at `/ops/pattern-audits` shows copyable prompts to authorized operators. This is
an improvement loop, not a second user-facing calculation.

## Ownership

`@murphai/query` owns factor extraction, comparisons, grades, and the Journal
read model. Browser Vault stores the derived current report and Journal view.
The web reads those projections. `vault-cli` exposes the same Patterns query to
the assistant runtime.

Do not add a Patterns database table, statistical service, or calculation in
React. Calendar follow-ups and email travel capture are later features. They do
not block Journal or Patterns.
