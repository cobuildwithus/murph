# PR 511 ReviewGPT Round 6

## Goal

Close the exact-head ReviewGPT findings while reducing the revoked-access path
to one positive conversation-replay operation, preserving additive deployment
compatibility, and making concurrent roster observations retry instead of
guessing.

## Constraints

- Do not add timers, queues, durable replay state, or another source of truth.
- Branch once for `conversation_replay`: import eligible conversation work,
  combine it with bounded pending conversation inputs, run the existing
  foreground reply/delivery/checkpoint path, then return.
- Delete replay-specific negative gates from the generic runtime path.
- Keep old and new Temporal workers compatible with web during rollout without
  changing workflow or activity argument shapes.
- Let the final successful workspace checkpoint publish the replayed
  conversation floor atomically; do not restore a consume endpoint, runtime
  port, post-checkpoint retry effect, or separate acknowledgment lifecycle.
- Treat a lost roster ordinal claim as an incomparable observation and retry
  the existing webhook; do not merge snapshots or add wall-clock authority.
- Preserve current-access behavior, outbound authority, mailbox ordering,
  usage gates, idempotency, and accepted-work terminal disposition.

## Working Set

- `packages/assistant-runtime/src/**`
- `packages/assistant-runtime/test/**`
- `packages/hosted-execution/src/**`
- `packages/hosted-execution/test/**`
- `packages/hosted-orchestrator-temporal/src/**`
- `packages/hosted-orchestrator-temporal/test/**`
- `apps/web/app/api/internal/hosted-orchestration/**`
- `apps/web/app/api/internal/hosted-workspace/**`
- `apps/web/src/lib/hosted-orchestration/**`
- `apps/web/src/lib/hosted-workspace/**`
- `apps/web/src/lib/hosted-routing/linq-thread-roster.ts`
- matching web reconciliation, roster, and webhook tests
- `ARCHITECTURE.md`
- `agent-docs/references/hosted-runtime-protocol.md`

## Tasks

1. Replace distributed replay exclusions with one bounded positive replay path.
2. Add an explicit reconciliation-facts capability handshake so old Temporal
   workers receive the old shape and old inactive-user behavior.
3. Publish a safe conversation consumed floor in the same transaction as the
   final replay checkpoint, only after a clean and complete bounded pass.
4. Fail retryably when a concurrent roster snapshot loses its ordinal claim.
5. Prove focused behavior, then run full verification and required audits.
6. Commit and push through `scripts/finish-task`; repeat exact-head ReviewGPT
   and CI until both are clean.

## Verification Plan

- Assistant-runtime replay tests covering imported-but-pending work, strict
  conversation filtering, ordering/bounds, terminal delivery, and no system
  work.
- Web and Temporal compatibility tests covering both capability shapes and
  inactive-user semantics.
- Deferred concurrent roster observation plus webhook retry/idempotency tests.
- Package typechecks, root/full repo verification, required completion audits,
  exact-head ReviewGPT artifact, green GitHub checks, and mergeability proof.

## Audit Resolutions

- ReviewGPT Round 6 reported four findings: inactive imported-but-unconsumed
  work could stall after access revocation, an unversioned processing-mode
  response could break old Temporal workers, a losing roster ordinal claim
  could decide access, and replay behavior was spread across generic runtime
  exclusions. The implementation now uses an atomic consumed floor, a
  versioned capability handshake, retryable lost roster claims, and one
  positive bounded replay path.
- An independent final review found that applying the consumed floor to active
  reconciliation could create a no-progress wake loop. Active reconciliation
  now keeps the existing import-lag definition; only inactive replay uses the
  consumed-floor lag.
- The security/privacy audit found no evidence-backed critical, high, or medium
  findings.
- The coverage-write audit added one integration regression proving replay
  preserves prior redacted status while checkpointing and returning canonical
  write receipt metadata. Its focused test passed, and the audit found no
  remaining coverage gaps.
- The parent scope and architecture review found no timers, queues, replay
  lifecycle state, unsafe casts, or replay-specific negative gates remaining
  in the generic runtime path.

## Verification Results

- `pnpm test:diff` against the pre-rebase `origin/main...HEAD`: passed.
- All 10 affected package typechecks passed.
- Affected package tests passed, including assistant CLI (128), assistant
  engine (2,013; 4 skipped), assistant runtime (1,529; 2 skipped), assistantd
  (40), Cloudflare hosted control (41), hosted execution (291), hosted-local
  harness (381; 1 skipped), Temporal (79), setup CLI (124), and CLI (1,045).
- Hosted-local package-boundary verification passed (2 tests).
- Cloudflare verification passed (1,705 tests), including hosted-local E2E.
- Hosted-web verification passed: 4,260 tests (9 skipped), production build,
  lint with 10 pre-existing warnings and zero errors, and development smoke.
- After rebasing onto the latest `origin/main`, the repeated diff lane passed
  every guard, affected typecheck, package test, package-boundary check, and
  Cloudflare verification. Its hosted-web build became silent and was stopped
  after the bounded window; a fresh `pnpm --dir apps/web verify` then passed
  the same 4,260 tests, lint, smoke, TypeScript, static generation, and
  production build.
- Exact-head ReviewGPT, GitHub checks, and mergeability proof remain as the
  post-push gates.

## Deployment Order

1. Deploy Cloudflare and the hosted runner with immediate container rollout;
   verify the expected runner-bundle fingerprint.
2. Deploy Temporal. Its versioned query is harmless against old web, which
   ignores it and returns the legacy response.
3. Deploy web and the additive migration. Old Temporal workers omit the query
   and receive the exact legacy response, so they cannot select replay.

Once web emits `conversation_replay`, the matching runner and Temporal builds
are the rollback floor. Remove the temporary legacy response branch after old
Temporal workers and pre-deploy Activities are drained and the approved
rollback window is closed.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
