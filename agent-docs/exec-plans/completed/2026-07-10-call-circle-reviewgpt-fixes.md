# PR 444 ReviewGPT Fixes

Date: 2026-07-10
Status: completed
Spec: `agent-docs/product-specs/call-circle.md`
Branch: `feat/call-circle-v1-f5`

## Goal

Close the three production-path findings from PR #444 ReviewGPT round 1 without
adding another state owner or weakening authorization, consent, or deploy
invariants.

Success means the hosted workspace phase forwards the existing Call Circle
port, the explicit legacy template-only join-offer shape remains functional
during the documented web-first warm-runner window using server-owned copy,
and a member can counter after their own earlier confirmation while the partner
is still pending. Focused regressions, owner verification, a clean ReviewGPT
round, and final PR CI must pass on the pushed head.

## Design

- Forward `platform.callCircle` with the adjacent hosted tool ports. Reuse the
  existing dynamic-tool availability and execution tests; add phase-boundary
  proof that the production-composed port reaches the assistant context.
- Retain the validated legacy `messageTemplate` only as a compatibility marker.
  If and only if it is present, activation is absent, and `operationId` is
  absent, send deterministic server-owned generic join-offer copy through the
  existing link and egress primitives. New requests and every activation offer
  still require the runtime-supplied operation id.
- Reuse the decline transition's existing affirmative-side/pending-partner
  predicate in the counter compare-and-set. Preserve the one-counter flag,
  exact ask snapshot, expiry guard, and active-pair authority.

## Proof

- Hosted workspace phase test for Call Circle port propagation.
- Hosted execution parser and web group-tool tests for exact legacy shape,
  server-owned copy, activation rejection, and new-path reservation behavior.
- Symmetric match-store tests for confirm-then-counter plus existing stale,
  expired, second-counter, and final-stage guards.
- Changed-owner typechecks/tests, privacy/diff checks, ReviewGPT rerun, and PR
  CI on the final pushed head.

## Progress

- ReviewGPT round 1 produced three findings; all three are locally confirmed.
- All three corrections and their focused regressions are implemented. The
  exact legacy serialized request now runs through the shared parser and web
  handler in one test.
- The final web proof passes 12 files and 244 tests, including the exact shared
  parser-to-handler legacy request, bound non-activation offer row, signed
  reaction owner, and symmetric counter guards. Hosted execution passes 2 files
  and 45 tests, assistant engine 1 file and 3 tests, and assistant runtime 1 file
  and 214 tests. All three owner typechecks, targeted web lint, docs drift,
  privacy scan, and diff checks pass.
- The required security/privacy audit lane hit model capacity twice. The parent
  fallback traced the signed callback, exact Linq route authority, fixed
  server-authored copy, activation-null bound offer payload, signed exact-message
  reaction, existing Call Circle port, active-pair/member-side counter CAS, and
  found no evidence-backed Critical, High, or Medium issue.
- Scoped finish commit, push, ReviewGPT round 2, and final PR CI remain.

Updated: 2026-07-10
Completed: 2026-07-10
