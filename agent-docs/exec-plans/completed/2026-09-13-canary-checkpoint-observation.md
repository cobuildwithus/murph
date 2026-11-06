# Align live canary observation with production checkpoint timing

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Make the live Linq canary observe ordinary production checkpoint publication before deciding whether its canonical save/readback succeeded.

## Success criteria

- Three canonical stages can each publish after the required 180-second quiet window.
- Missing publication still fails within a finite deadline; exact 0/1/1 counts, 20-second replies, fixed-account authority, and before/after deployment fences remain enforced.
- Focused regression proof and required review/CI pass, followed by a successful protected live journey after merge.

## Scope

- In scope: the existing canary observer deadline, derived poll count, workflow timeout, focused tests, and live-canary owner documentation.
- Out of scope: runtime checkpoint timing, member authority, provider prompts, production secrets, replica freshness, and other owners' Worker releases.

## Constraints

- Keep production's hard 180-second checkpoint quiet window and the canary's 20-second reply budget.
- Use the existing input-free fixed-account reset, read-only counts endpoint, AbortSignal deadlines, and serialized main-only production workflow.
- Keep private operational evidence out of source and review packets; synthetic timing reproduces the bug.

## Risks and mitigations

1. Longer observation can increase read load and exceed the enclosing job budget. Keep one serial request per second, each capped at ten seconds, with a five-minute total deadline and at most 300 requests per canonical stage. Give the enclosing workflow enough bounded time for reset, three observations, replies, setup, and final deployment validation.
2. A longer wait must not hide missing or duplicate writes. Preserve all readiness, cardinality, latency, and exact-deployment assertions and prove timeout failure.

## Tasks

1. Reproduce a synthetic publication after 185 seconds against the old 90-second observer.
2. Align the existing observation and enclosing workflow budgets, with a derived poll limit.
3. Run focused Web/controller tests, typecheck, complexity, and documentation checks; review the diff.
4. Commit, push, complete required ReviewGPT and exact-head CI, merge, and execute the protected live canary.

## Decisions

- The runtime and invariant owners require at least 180 seconds of quiet before routine checkpointing. The current canary waits only 90 seconds, so its deadline precedes the earliest normal publication.
- Change the proof owner's observation budget to five minutes, allowing the quiet window plus bounded checkpoint/publication time. Do not alter runtime scheduling or treat reply delivery as canonical state evidence.
- No new state, endpoint, authority, transport, dependency, or production mutation path is needed.
- Internal verification correction only; no public changelog entry is applicable.

## Verification

- Focused Web canary runner tests, controller shell tests, Web typecheck, `pnpm complexity:diff`, doc drift/gardening, and whitespace checks.
- Synthetic delayed-publication proof must fail before and pass after; no-publication, duplicate state, unavailable observer, and slow reply cases remain failures.
- Live proof remains pending until the protected main controller completes all five turns, canonical counts, and final exact-deployment validation.
- Fail-before: both new runner regressions fail against the 90-second implementation; the delayed three-stage journey stops at the baseline, and the absent-publication case exposes the premature 90-second deadline.
- Focused proof: 25 Web runner tests and five controller tests pass after the correction. Web typecheck, doc drift, doc gardening (zero issues), and whitespace pass. Complexity remains 16 with zero hotspots.
- Parent candidate review: the actual canary loop and controller timeout compose correctly. All new requests are serial fixed-account observations after replies; there are no changes to runtime authority, canonical storage, or foreground/provider work.
- Final ReviewGPT: PASS on `c211b3fff1fd719b9e0b74b6f44e8049ac62d51c`, full seven-file snapshot, verified requested/response model `gpt-6-pro`, completed marker and minimum duration accepted. The reviewer inspected the runner and independently passed all five controller tests. No findings or implementation remediation remain.
- Parent final review accepts that result and the unchanged source/tests. This plan closes the implementation record; exact-head CI, authorized merge, and the real production journey remain post-commit gates owned by the current session. No live success is claimed by this pre-merge record.
Completed: 2026-09-13
