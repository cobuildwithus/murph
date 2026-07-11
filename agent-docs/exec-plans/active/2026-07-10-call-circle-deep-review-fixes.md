# Call Circle Deep-Review Finding Fixes

Date: 2026-07-10
Status: active
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
  located the clean PR worktree at reviewed head `2b8f438fe5`, loaded required
  guidance, implemented all ten fixes, passed focused regressions plus real
  PostgreSQL barriers for provider-start/deletion ordering and preference-write
  proposal invalidation, passed the truthful affected cross-owner verification
  lane including package/app typechecks, tests, lint, smoke, and production
  builds, merged the current `origin/main` through ordinary Git history, and
  proved the merged base's two assistant-style CLI tests after rebuilding its
  prepared runtime artifacts.
- Now: wait for physical unused memory to recover above the 12 GiB heavy-command
  floor, rerun the full affected lane on the merged head, and complete the
  controller-gated local security, coverage, and deep-review audits while the
  parent performs final diff and privacy review.
- Next: resolve accepted audit findings, finish and push the scoped commit, then
  confirm exact-head CI, thread resolution, and mergeability before the
  controller-gated ReviewGPT handoff.

## Working Set

- `apps/web/src/lib/{phone-calls,hosted-privacy,call-circle,hosted-orchestration}/**`
- `apps/web/test/**`
- `packages/{hosted-execution,assistant-engine}/src/**`
- matching package tests and Call Circle/product/architecture docs when behavior
  or durable contracts materially change.
