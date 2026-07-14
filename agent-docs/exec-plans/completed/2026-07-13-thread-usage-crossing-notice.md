# Thread Usage Crossing Notice

## Goal

Build on PR #570 so a thread-container allowance crossing sends the neutral usage-limit notice to the exact originating conversation instead of skipping with `home_route_missing` or labeling the event as a trial limit.

## Constraints

- Preserve PR #570 as the stacked base and keep its thread-container allowance classification and neutral reset-only copy.
- Deliver proactively only when the accepted input carries an exact authority-bound originating route; never fall back from a thread container to a member's personal home route.
- Keep hosted web as the owner of usage accounting and notice claims; Cloudflare and the runtime may transport only the bounded delivery target needed for the current crossing.
- Preserve once-per-period notice claiming, provider-entry fencing, retries, and current-inbound denial behavior.
- Do not add persisted state, a new scheduler, or a route lookup/index.

## Plan

1. Trace the PR #570 usage-record contract and the accepted-input route authority across runtime, Cloudflare, and web.
2. Add a bounded optional notice delivery target to the existing usage-record path.
3. Restore proactive thread-container crossing notices only for an exact originating target and keep safe no-target behavior.
4. Add focused contract, transport, accounting, and wrong-route regressions; update the hosted usage contract and deployment notes.
5. Run required verification, completion audits, local final review, commit, push, open a draft PR stacked on PR #570, and start ReviewGPT with CI.

## Verification

- Focused owner tests passed: hosted execution 28/28, assistant engine 62/62,
  Cloudflare runner platform 115/115, web usage/allowance/route 119/119, and
  the four exact assistant-runtime import, route-resolution, and deferred-flush
  proofs.
- Changed-owner typechecks passed for hosted execution, assistant engine,
  assistant runtime, Cloudflare, and web. The prepared full-workspace typecheck
  also passed.
- `pnpm verify:acceptance` advanced through the production web build and broad
  coverage/app lanes, but the saturated local run produced unrelated timeout
  failures in existing CLI, assistant-runtime, and web tests plus unavailable
  runner-image tags. Stable focused reruns for the changed paths passed.
- Required `security-privacy-review` completed with zero medium-or-higher
  findings. Required `coverage-write` added the explicit ambiguous-target
  fail-closed regression and found no remaining proof gap.
- PR-lane ReviewGPT and GitHub CI remain the pushed-head gates.

## State

Implementation and local specialist audits complete; ready for scoped commit,
push, stacked draft PR, ReviewGPT, and CI.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
