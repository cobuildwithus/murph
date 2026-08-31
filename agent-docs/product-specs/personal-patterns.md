# Personal Patterns

Last verified: 2026-08-29

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

For a factor day, the query first uses a confirmed-absence comparison when one
exists. Otherwise, eligible device-backed factors can use the nearest unused
weekday-matched comparison day within 35 days. A manual or inferred factor that
uses this weaker baseline cannot receive a grade above D.

One comparison case supports one pair for a factor and outcome. The query
averages several matched days from one episode into one case. A result must
keep the same direction across its independent cases before it can receive a
repeated-evidence grade.

## Result levels and grades

The report uses one scale in the product:

| Grade | Product name | Minimum evidence                                |
| ----- | ------------ | ----------------------------------------------- |
| E     | Observation  | One meaningful comparison case                  |
| D     | Early signal | Two repeated comparison cases                   |
| C     | Pattern      | Five cases across 21 days                       |
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

The current `/patterns` matrix remains the main view. It shows the first 15
factors and every supported outcome present in the member's data. `Show more`
reveals the remaining report factors. The report keeps at most 100 sorted
factors to bound Browser Vault size and calculation work. A recognized factor
stays visible when it has no suitable comparison day. Its cells explain that
Murph needs more comparable data. Observations can appear with grade E. The
page shows the evidence count, comparison basis, date range, and the factor and
comparison dates needed to inspect the result.

An empty report says that Murph needs more comparable data. The page does not
start a calculation. It reads the latest Browser Vault report.

## Proactive messages

The managed Personal Patterns automation checks each day at 13:00 local time.
It sends at most one private message per run. The first report becomes a quiet
baseline. Later new results become one summary with at most three highlights.

The hosted runtime emits a privacy-safe internal email alert when this managed
run fails or when its occurrence starts too late and expires. Alert delivery
uses the existing operational email channel and does not change the member's
message. A complete platform outage requires an external uptime monitor,
because the runtime cannot report while it is offline.

Only a new grade A-D identity can trigger that daily message. Murph describes D
as an Early signal and A-C as a Pattern. Grade E Observations remain visible on
the page but stay quiet. A saved private ledger deduplicates result identities.
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
