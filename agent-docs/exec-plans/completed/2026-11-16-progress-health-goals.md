# Steps and Sleep goal context and shared health input

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Goal and scope

Implement the backend half of the locked BE6 plan: Steps/Sleep Change controls
without games and one health-input normalizer for Health, goals and Steps PNG.
Keep build 111/112 wire types unchanged. Native refresh ordering, composition and
rendering belong to the iOS lane. No streak or next-goal ladder changes.

## Outcome, authority and failure

The existing goals routes choose a typed games or own-health context. Health
preview loads once without freezing baselines, routes or awards. PUT uses the
existing compare-and-set state writer and returns the wearable measure from that
same input. Session and health authority cover private read completion, writes
and returned values. Missing postjoin data is retryable unavailability. Provider
failures remain explicit; no retry or fallback is added.

The common input preserves source selection and settled Steps at the companion
owner, admits retained dates and inclusive reporting ranges, and converts Sleep
minutes to seconds once. Existing awards, dates, lookup keys and sealing stay
with their owners. No new persisted fields, table, endpoint, registry or flag.

## Product UX

Effort: Product change. Result: Hold for Paper approval and the iOS lane.
Reaches: zero-game Steps/Sleep, partial/missing sync, corrected totals, completed
routes, health authority loss, game goals. Rows 01/07/09/10/11/14 inspected.
Proof: synthetic route contracts and PostgreSQL settlement, including shared
JSON/goal/PNG points, never revoke and immutable crossing dates. Native rendered
proof remains with the iOS lane; this backend task does not claim it.

## Tasks

1. Extract common health input and sum presentation; compose health goal context.
2. Prove normalization, goal controls, authority and settlement invariants.
3. Update architecture classification, record gates and exact native handoff.
4. Review, commit, push and open PR #5102 with the explicit merge hold; admit the final candidate to Ready CI.

## Verification

Focused Vitest: 208 tests across nine suites, exit 0. The final goal/context and
settled-step edits passed 107 tests across three affected suites, exit 0; the
subsequent goal test-label cleanup passed all 20 cases, exit 0. PostgreSQL:
15 tests, no skips, exit 0 through the existing receipt-validating runner against
an isolated migrated loopback database. Web typecheck, complexity and docs drift
passed, exit 0. Changelog generation and its four archive render tests passed,
exit 0. Diff selector chose apps/web and passed root syntax, guards, repository
typecheck, dependency and workspace checks, then could not acquire the exclusive
Web verifier slot for over ten minutes. Per the admission rule, the proven
session-owned waiter was stopped: test:diff exit 1 (blocked, not passed). No SSH
worker host/account is configured for fallback. Focused proof above is complete;
exact-head CI owns the remaining broad proof. The isolated test database was
removed after its successful run.

Synthetic sequential Health/Progress refresh timing (mock replica/provider I/O):
cold first-route 17.81/20.56 ms health/total; saved route 3.08/3.96 ms; route
failure 2.20/3.13 ms. Each used one replica read; route resolutions were 1/0/1.
These are fixture timings, not live provider or device measurements. The
filtered timing rerun passed three cases and intentionally skipped 17 others;
the ordinary unfiltered focused suite covers all 20.
Initial setup attempts exited 1 because package-local dependencies and generated
Prisma client were absent. Frozen install and ordinary generation restore them.
ReviewGPT is explicitly delegated to the integrator; do not run or merge here.

## Deviations

None. Existing wire/state owners cover the screens; all native edits excluded.
Verification limitation: canonical local diff check blocked at shared-host admission.
No source or workflow workaround was introduced.
Completed: 2026-11-16
