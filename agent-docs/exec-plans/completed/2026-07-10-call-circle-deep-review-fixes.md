# Call Circle Deep-Review Finding Fixes

Date: 2026-07-10
Status: completed
Branch: `feat/call-circle-v1-f5`
PR: #444
Spec: `agent-docs/product-specs/call-circle.md`

## Goal

Resolve the ten evidence-backed findings from the post-conflict Call Circle
deep review without adding another state owner, queue, or speculative lifecycle.
Keep web as the product and provider-effect authority, preserve private member
preferences, and make every bounded scheduler batch continue making progress.

Success means:

- account deletion and phone-provider startup serialize on one hosted-member
  lock, with a PostgreSQL barrier regression;
- connector failures, stale seed rows, concurrent preference changes, expiry
  recipients, and daytime boundaries are covered by direct regressions;
- matching is deterministic and maximum-cardinality for the bounded candidate
  set while retaining rotation preference as a secondary choice;
- private turns can resolve a same-group peer without guessing an opaque id;
- computer resume selects the current conversation anchor;
- every Temporal signal RPC has a real connection-layer deadline;
- required verification, local completion audits, CI, and mergeability are
  green on the final pushed head.

## Constraints And Decisions

- Default to deletion and existing owners. Do not add a Call Circle queue,
  bridge-session table, preference lookup store, or duplicate timeout wrapper.
- Keep phone numbers, private preferences, member identifiers, provider data,
  and message content out of logs and fixtures.
- Preserve product-critical success paths; failures isolate one work item rather
  than disabling the batch or silently dropping accepted work.
- Use PostgreSQL row locks for cross-transaction serialization and a Temporal
  connection deadline for RPC cancellation; `Promise.race` alone is not proof.
- Resolve private peer names from the private runtime's canonical profile name.
  Persist only the existing contact-privacy owner's versioned, keyed blind index
  on the participant; never persist or disclose the plaintext name or a
  same-group roster through this surface.
- Preserve unrelated coordination-ledger rows and working-tree changes.

## Finding Map

1. Account deletion can miss an uncommitted provider-start attempt.
2. One connector preflight exception can abort the bridge batch.
3. Thirty-two stale participant seeds can starve eligible members.
4. Preference changes can race proposal creation.
5. Greedy matching can miss a maximum-cardinality pairing.
6. Private cadence overrides lack a trusted peer-resolution surface.
7. Expiry notifications use a stale response snapshot.
8. Connector calls can start after either member's daytime boundary.
9. Computer resume selects the prior notification instead of the current turn.
10. Temporal signaling has no RPC deadline.

## Verification And Audits

- Add focused unit/integration regressions for every finding, including real
  PostgreSQL barrier tests for findings 1 and 4.
- Run the narrow focused loops during implementation, then the truthful
  `pnpm test:diff`/full acceptance lane required for this cross-owner app diff.
- Capture direct scenario proof for the provider-start/delete ordering and
  deadline behavior.
- Run required `security-privacy-review`, `coverage-write`, and local
  `deep-review` audit subagents after the recovery controller grants audit
  helper launches. The parent still runs the explicit local final review.
- Close with `scripts/finish-task`, push PR #444, and wait for green CI on a
  conflict-free final head. Do not launch ReviewGPT or browser review in this
  recovery lane; stop at the controller's ReviewGPT handoff gate.

## State

- Done: recovered the prior review, confirmed and mapped all ten findings,
  implemented the fixes, and retained the real PostgreSQL barriers for
  provider-start/deletion ordering and preference-write proposal invalidation.
  Merged `origin/main` at `f781d6f77069654f102199a7a249ceec003c2b2e`
  through ordinary Git history and resolved only the two proven assistant group
  tool conflicts, preserving Call Circle's server-owned offer contract while
  incorporating the current uncreated-group guidance. The merged head
  `4b839e22c2cc292b921f24bcb0124a45f9ad7c1a` passed the focused assistant group
  tool suite (22 tests), assistant-engine typecheck, prepared test-runtime build,
  and the authoritative affected cross-owner lane: repository policy guards,
  affected typechecks and package tests, hosted-local package-boundary proof,
  web lint/dev smoke/production build with 4,500 passing tests, and Cloudflare
  verification with 1,737 passing tests.
- Done: completed parent-only security/privacy, coverage, Feynman deep-review,
  final diff, and privacy passes because the recovery controller prohibited
  helper launches. No actionable finding remained. Every finding is covered by
  a direct regression, including exhaustive bounded matching cardinality,
  group-scoped keyed name lookup, both PostgreSQL barriers, current-state expiry
  recipients, provider daytime revalidation, and a native Temporal RPC deadline.
- Next: archive this plan with `scripts/finish-task`, push the final scoped head,
  and confirm exact-head CI, review-thread state, and mergeability. ReviewGPT and
  browser work remain controller-gated until PR #557 is merged and a slot is
  granted.

## Working Set

- `apps/web/src/lib/{phone-calls,hosted-privacy,call-circle,hosted-orchestration}/**`
- `apps/web/test/**`
- `packages/{hosted-execution,assistant-engine}/src/**`
- matching package tests and Call Circle/product/architecture docs when behavior
  or durable contracts materially change.
Updated: 2026-07-12
Completed: 2026-07-12
