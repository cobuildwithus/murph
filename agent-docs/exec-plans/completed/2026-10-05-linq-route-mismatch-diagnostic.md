# Classify Linq route-authority rejections privately

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Distinguish the existing member-route rejection branches using the private
callback error log, while preserving delivery authority and the public response
exactly.

## Success criteria

- ReviewGPT authors the smallest telemetry-only change at the existing owner.
- Actual callback tests cover each reachable rejection branch and accepted
  routes, and rejection before provider dispatch.
- Privacy tests prove closed diagnostic values, no getter evaluation, and an
  unchanged public response; no identifiers or route values enter the log.
- Focused verification, parent review, final ReviewGPT, and exact-head CI pass.
- Any authorized telemetry deployment uses the canonical workflow, verifies the
  revision, and preserves a bounded natural-traffic query if not exercised.

## Scope

- In scope: HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH and its existing private
  HostedOnboardingError HTTP logging path, focused tests, and its owner contract.
- Out of scope: the separate resolved-route comparison error, welcome callbacks,
  contact cards, retries, production data, provider calls, and device sync.

## Constraints

- Fixed field names or flags only; no raw identifiers, hashes, bodies, or values.
- No new event, pipeline, state, dependencies, I/O, or awaited operations.
- Preserve comparisons, locks, transactions, call counts, and public JSON.
- Other active delivery corrections retain their independent ownership.

## Risks and mitigations

1. Error metadata could accidentally become public or accept arbitrary values.
   Mitigation: use the existing private diagnostic pattern and adversarial tests.
2. Instrumentation could alter rejection or evaluate new work on success.
   Mitigation: attach fixed reasons at existing rejection sites and
   prove accepted/rejected dispatch behavior with actual-route tests.

## Tasks

1. Inspect existing classification and competing work; request external authoring.
2. Review patch and run regression, privacy, type, lint, complexity, and doc checks.
3. Open a scoped telemetry PR and complete final review and required CI.
4. Evaluate canonical telemetry-only rollout authority and verify any deployment.

## Decisions

- Product UX: internal-only observation; no delivery or response behavior changes.
- Changelog: not applicable; private failure classification only.
- Fresh evidence identifies the member-route guard, not the later resolved-route
  comparison. The initial field-comparison proposal was discarded before edits.
- Existing logs cannot distinguish missing routing, stale target, or projection/
  recipient inconsistency; those competing causes require a closed branch reason.

## Verification

- ReviewGPT authored nine fixed throw-site reasons through the existing error
  owner; the parent removed one unused test parameter only.
- Actual callback tests against original source: eight failures for missing
  classification, with 87 controls passing. Corrected callback, HTTP/privacy,
  and existing auth diagnostic suites: 193 tests pass.
- Public response bytes, one existing warning, pre-provider rejection, current/
  pending/owned-thread success, separate guards, closed values, and accessor/
  coercion safety are covered. The ninth defensive target branch is unreachable
  through the current typed durable-route reader; all reason values have HTTP
  output tests, and the reachable missing-target path is tested.
- Source comparison proves all existing authority control flow is byte-identical
  after removing diagnostic arguments, and the composed callback is unchanged.
- Web typecheck, focused ESLint, whitespace, docs drift/gardening and complexity
  pass. The unchanged authority-hints function remains at complexity 45;
  diagnostics do not justify refactoring its existing authority semantics.
- Parent candidate review: telemetry-only; no identifiers, public fields, new
  event, I/O, state, provider calls, retries, or validation changes.
- Final ReviewGPT round 1 passes on
  `d63a582a149b316de605b11a16541441e81ff15d` with no findings. The reviewer
  confirms the exact error owner, closed classifications, unchanged authority
  decisions and public response, and privacy/accessor regression coverage.
- Final plan closure is explanatory only. Required CI must pass on its final
  head before the authorized telemetry-only merge. Canonical deployment and
  natural-traffic observation remain separate gates; no recovery is claimed.
Completed: 2026-10-05
