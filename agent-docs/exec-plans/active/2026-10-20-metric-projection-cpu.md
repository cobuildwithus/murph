# Attribute metric projection CPU versus wall time

Status: active
Created: 2026-10-20
Updated: 2026-10-20

## Goal and evidence

Issue #3997 contains a successful 23.4-second metric span inside a 54.3-second
rebuild. The deployed nested metric spans from #4217 partition wall time, but
cannot distinguish computation from scheduler delay. Main-process profiles
exclude CLI children. The current 72-hour aggregate has 20 metric observations;
only six carry nested timings, with extraction max 2.64 seconds. Local example
profiling and synthetic ranking/history trials do not explain the severe case.
PR #4251 independently reduces proven dataset repair work, without claiming to
resolve this metric span. User authorization now permits direct implementation.

## Scope and invariant

Add optional bounded process CPU counts/sums/maxima to the six existing
synchronous metric spans through the current CLI timing owner. Preserve every
wall sample, command outcome, original error/return value, browser boundary,
byte/span/command/report limit, transport and exit behavior. No new dependency,
monitor, scheduler, cardinality, identifier or content collection. Missing CPU
coverage is explicit; values may exceed wall time and nested spans overlap.

## Proof and release

Validate real old-reader/new-writer and new-reader/old-writer skew, independent
optional-field rejection, zero/missing coverage, overflow, copying/merging,
active/closed scopes, CPU failure and nested synchronous exceptions. Run focused
runtime timing and actual query projection checks, typecheck, complexity, and
same-fixture warm overhead measurements. No assistant-visible surface changes.

Required ReviewGPT and exact-head CI precede authorized merge and protected
release. Deploy Web normalization before runner production, verify revisions,
bindings and telemetry. Observe normal traffic at 24 and 72 hours to decide
whether CPU cost or off-CPU delay dominates; insufficient traffic is a limitation.
The user-required immediate/30-minute four-hour release checks need an app
heartbeat that is not currently exposed; no scheduled monitoring is claimed.

## Status

Implemented at the existing runtime-state timing owner; private example contents
are not part of this worktree, fixtures or review packet. Initial proof passes:
61 runtime timing tests (16 unrelated opt-in tests skipped), all four actual
subprocess/UDP tests, five actual metric projection tests, 27 hosted usage
consumer tests, runtime-state/query typecheck and complexity (no added debt).
Actual previous-reader skew uses base 45c63eaa478bc10e6b5b81287aba8555a4111da3.

Synthetic overhead experiment: the same 30-day, two-provider fixture runs through
the actual metric owner with precollected wearable data, full output equality,
20 warm iterations per version and five alternating pairs of 60 iterations.
Before/after wall medians 11.3479/10.7022 ms (ranges 10.1649–12.8921 and
10.4017–11.3131); CPU medians 12.3227/12.1264 ms (ranges 11.4224–14.4121 and
11.2099–12.7440). Variation exceeds the added sampling effect; this is not a
speedup claim. Work is bounded to two process CPU reads per eligible span, at
most twelve per complete metric projection. Existing report limits are tested
through the real UDP sender with oversized multi-command synthetic input.

Final boundary tests, parent review and docs drift pass. ReviewGPT, required
exact-head CI and protected release remain pending. No changelog is applicable:
this change adds private-safe internal measurements only.
