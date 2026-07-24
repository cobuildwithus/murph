# PR 890 ReviewGPT Round 1 Remediation

## Goal

Resolve the three accepted final-gate findings without reintroducing the
meal-specific scheduler, queue, route-repair, or lifecycle machinery removed
by this replacement:

1. A recently accepted automatic meal capture must count as fresh engagement
   so stale Linq activity cannot strand its import or 9pm closeout.
2. Members with a verified email must be able to use that private route for
   capture enrollment, with the current verified address re-resolved before
   every scheduled provider call.
3. The closeout must eventually drain retained automatic-capture photos older
   than the initial 31-day window.

## Constraints

- Derive engagement from the existing canonical mailbox item; add no new state.
- Extend the existing direct-route contract and signed Web-control boundary;
  add no routing table or persisted route-repair state.
- Treat retained vault photos as the work queue; add no cursor or scheduler.
- Keep unrelated inactive-member automations subject to the existing
  engagement pause.
- Preserve photo privacy, receipt-verified removal, and ordinary managed
  automation ownership.

## Working Set

- Hosted Web runtime reconciliation and direct-route resolution.
- Hosted execution direct-route contracts, builders, and parsers.
- Automatic meal-capture closeout skill and its focused tests.
- Directly affected architecture, reliability, and product documentation.

## Verification Plan

- Focused tests for stale Linq engagement with and without a recent automatic
  capture, email direct-route resolution, route-envelope parsing, and
  oldest-retained-photo draining.
- Affected package and app typechecks.
- Canonical diff verification and acceptance.
- ReviewGPT round 2 against the exact remediation head, followed by exact-head
  CI.

## Completion Evidence

- Focused Web, Cloudflare, assistant-runtime, hosted-execution, CLI, and
  assistant-engine suites passed, including current-email substitution,
  cleared-email fail-closed behavior, fresh-capture engagement, and
  retry-first/oldest-retained photo selection.
- The built CLI direct scenario selected same-occurrence retry evidence before
  the oldest retained photo and removed the selected attachment.
- The product-experience and privacy re-review returned no findings after
  current verified email became provider-entry authority.
- `pnpm verify:acceptance` passed through Crabbox in 4m48s.
- `pnpm test:diff` was attempted twice through Crabbox. Both runs passed the
  affected typechecks and changed-path tests, then stopped on pre-existing
  Health Commons generated-root failures in unrelated experiment tests; one
  run also hit the known hosted-local process timing failure.
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
