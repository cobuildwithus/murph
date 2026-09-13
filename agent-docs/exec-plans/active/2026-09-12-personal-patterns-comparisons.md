# Improve comparable evidence behind Personal Patterns

Status: active
Created: 2026-09-12
Updated: 2026-09-12

## Goal and invariants

Keep the existing cards, arrows, coverage bars, and drawer unchanged while making
comparisons reflect comparable, independently repeated, current evidence. Add no
drawer text. Query owns every number; canonical records remain the only source
of truth and the existing replica and notification ledger remain their owners.

## Evidence and scope

The current engine gives device factors blanket inferred absence, matches one
control solely by weekday and proximity, and allows clustered observations to
receive directional grades. Sleep quality combines separate percentage changes.
Replace those rules in the deterministic query, retain existing report consumers,
and invalidate old derived replicas through the existing generation contract.
No production mutation, source-record repair, new service, or UX redesign.

## Design

- Qualify inferred control dates from same-origin daily activity evidence and
  established session history; missing coverage remains unknown. Explicit
  absence remains usable without excluding other qualified controls.
- Select up to three unique comparable controls per exposure. Match first-control
  coverage before extra controls; enforce source, weekday, date, and available
  pre-exposure covariate compatibility without looking at target outcomes.
- Weight independent episodes equally; use literal distinct day counts, and
  derive both bars and percentage from the same weighted observations.
- Require recent repeated evidence, balanced pre-exposure context, and robustness
  to alternate matches and influential episodes before emitting a direction.
  Calibrate bounded product heuristics with synthetic null and signal histories.
- Select one sleep-quality metric by availability across the report, before
  looking at factor effects. Preserve existing UI slots and drawer.

## Product journeys and proof

Connected source with genuine recurrent signal stays useful. Missing source days,
source changes, old imports, one clustered episode, confounded activity, and
unstable comparisons cannot masquerade as current repeated findings. All paths
use existing neutral or insufficient states, no added explanatory UI.

## Tasks

1. Implement evidence qualification, bounded assignment, episode statistics,
   reliability decisions, and coherent sleep-quality selection.
2. Exercise synthetic assignment, coverage, confounding, recency, null and signal
   scenarios plus existing canonical/query/replica contracts.
3. Run focused tests and typecheck, inspect diff and complexity, update owner
   documentation and changelog, complete candidate review and scoped commit.

## Risks and limitations

Canonical query inputs do not prove provider pagination completion or permission
history. Use only available evidence; never infer full-day wear from workout
percent-recorded. Observational comparisons cannot remove unknown confounding.
Numerical screening rules are product heuristics, not clinical significance.

## Verification

Implementation and parent candidate review complete. Product UX Ready: synthetic
canonical histories preserve positive/negative signals, reject missing daytime
coverage and confounded load, isolate source changes, suppress stale/clustered
findings, select one sleep metric, and preserve episode-weighted means with
literal calendar counts. Existing Web/native report shapes remain readable;
no component, drawer text, canonical schema, or notification owner changed.

- Query: focused comparison, matcher, existing Personal Patterns, and Browser
  Vault replica suites: 76 passed. Includes 156 repeated annual-window reports
  with 90 correlated null comparisons; the bounded false-signal threshold passes
  and an injected association remains detectable among 90 comparisons.
- Query, contracts, and Web typechecks: passed.
- Existing notification-ledger eligibility suite: 21 passed.
- Changelog production archive rendering: 10 passed using root-relative Vitest
  invocation. The documented package-relative invocation misses discovery;
  existing Frog entry `20260911184822-documented-changelog-test` covers this.
- Complexity guard: passed, no changed-source hotspot above 20. Removed the
  obsolete date-only assignment implementation; its exhaustive oracle now
  exercises the generalized matcher at one control.
- Privacy scan and diff whitespace check: passed.

Candidate committed and published as PR #3391. Parent candidate review, privacy
scan and mergeability check passed. Pending required final ReviewGPT and
exact-head CI. No production mutation or deployment has been performed.

## Implementation decisions

Canonical query inputs support daily steps as the conservative daytime proxy;
there is no new provider capability registry or invented import-completion fact.
Manual unobserved comparisons retain their existing grade cap. Calendar-day
finalization excludes the latest two days from device inference. A missing
numeric profile raises the episode floor. The current notification owner keeps
its existing graded-identity policy; proactive-message-specific thresholds and
sleep-metric identity deduplication are not changed in this implementation.
The finite synthetic calibration checks product heuristics and does not claim
formal error control or validate unknown real-world confounders.

## Round 1 disposition and remediation

ReviewGPT checked `8c4e223929c6590cf0b60714f322b3c2ce2ca84c` and found that
runtime display summaries lose source provenance required by the new control
qualification. Accepted; user resumed remediation. A persisted canonical
regression also proved that the default source filter removed raw wearable
observations before both consumers could calculate coverage. Runtime and
Browser Vault now reuse the full canonical replica source loader; public summary
stripping and replica entity visibility remain intact. This adds a full local
canonical read and metric projection on a fresh runtime Patterns query, replacing
the SQLite display reads. No database/network call or new state owner is added.

Persisted Junction histories now produce equal nonzero graded reports in both
consumers, source changes stay flat, and hidden observations stay outside public
replica entities. An established notification ledger does not skip the newly
qualified identity. The demo now supplies actual daily coverage and sufficient
repeated history; sparse caffeine and short self-logged training stay neutral.

Focused remediation proof: 77 query tests, 22 notification eligibility tests,
24 hosted replica tests, 9 development persona tests, 3 generation contract tests,
and the focused Chromium goal-source hover test pass. Query, contracts,
assistant-engine and Web typechecks pass. Complexity guard passes with no changed
source above 20. The hover proof now polls the actual text-color transition;
Frog entry `20260912232006-goal-source-hover` records this stale CI assertion.
Parent review and privacy readback passed. Round 2 and exact-head CI remain pending.

## Round 2 disposition and remediation

ReviewGPT validated the original provenance correction at
`67180145784475d5fc7247087d617d722cf2f8a0`, then identified one review-induced
Journal regression. Accepted and reproduced through persisted Oura overnight
and nap records: raw nap observations displaced the selected overnight deep and
REM metrics. The correction changes one existing call argument: Journal receives
`defaultProjectedVault`, while Patterns keeps the full canonical input. No new
abstraction, state owner, filtering policy, or public field is introduced.

The new persisted regression failed before the fix and passes afterward. It
preserves selected overnight deep/REM, keeps the nap event, and excludes hidden
observation records from both Journal and replica entities. The five-observation
Junction sauna fixture now checks factor recognition with a neutral direction,
consistent with the new repetition floor; no production threshold was relaxed.

The focused query/Journal/replica/comparison suites pass 59 tests. The Junction
import/replay suite passes 2 tests. Query and vault-usecases typechecks pass.
The existing Patterns source-change and positive/negative histories still pass.
The user authorized continued remediation and review until no findings remain;
subsequent accepted findings do not need another resume pause. Product UX and
parent candidate review are Ready. Final round 3 and new-head CI remain pending.
