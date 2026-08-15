# Prepared crypto and identity transaction boundary

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Keep provider calls and first-hit KMS work outside database transactions for
  hosted mailbox and identity flows through one small, explicit preparation
  boundary with transaction-safe local-only consumption.

## Success criteria

- Provider-capable preparation settles before transaction checkout, exact root
  identity is revalidated under the existing owner lock, and drift permits at
  most one full prepare-before-transaction retry.
- Generic mailbox append cannot silently reach KMS while holding dedupe or
  causal locks.
- Privy authentication/reconciliation and the selected highest-risk activation,
  verified-email, usage-credit, and meal-photo paths perform provider/root
  preparation before `BEGIN` without turning prepared state into authority.
- Focused tests defer provider/KMS work and prove no transaction begins early;
  provider failure and root drift leave no partial durable state or duplicate
  post-commit effect.

## Scope

- In scope: the smallest shared prepared-crypto primitive, mailbox append,
  Privy identity, and coherent non-overlapping high-risk callers that can be
  proven in this patch series.
- Out of scope: direct Linq and Telegram preparation paths already active in
  separate worktrees, pending-group crypto already completed independently,
  provider-under-lock work owned by other parallel tasks, schema changes, new
  queues, and broad crypto redesign.

## Constraints

- Preserve every current signup, authentication, activation, mailbox, credit,
  and enrollment product outcome.
- Prepared work is a capability hint only. Database reads and locks remain the
  sole identity, route, membership, root, and effect authority.
- Reuse request-scoped unwrap caches, prepared root candidates, transaction
  root locks, and existing typed drift handling. Add no durable preparation
  state or second retry owner.
- Treat ReviewGPT patches as untrusted input: inspect and adapt every hunk.

## Risks and mitigations

1. Risk: a root changes after preparation.
   Mitigation: compare exact root identity after the authoritative lock and
   retry the complete preparation once; a second drift fails closed.
2. Risk: one failed parallel prewarm returns while sibling provider work is
   still running.
   Mitigation: settle every started operation and preserve first-observed
   failure ordering before transaction entry.
3. Risk: a generic helper obscures authority or widens caller scope.
   Mitigation: keep provider-capable and local-only APIs distinctly typed and
   owned by the existing crypto/mailbox boundaries; generalize only proven
   repeated mechanics.
4. Risk: overlapping active branches duplicate work.
   Mitigation: exclude dirty direct-Linq/direct-Telegram worktrees and recheck
   open PR file overlap before committing.

## Tasks

1. [x] Map provider/KMS transaction call trees and existing prepared primitives;
   confirm active branch and PR overlap.
2. [x] Ask ReviewGPT for a scoped attachment-based implementation with tests and
   documentation, inspect the returned patch, and apply only verified hunks.
3. [x] Implement the foundation and the highest-risk coherent callers; record any
   residual paths explicitly rather than adding speculative machinery.
4. [x] Run focused Vitest, hosted Web typecheck, scoped lint, architecture/privacy
   checks, and direct deferred-provider/transaction-order proof.
5. [x] Review the final diff, archive this plan with the scoped local commit, and
   hand off without pushing or opening a PR.

## Decisions

- The enforceable seam is provider-capable preparation versus transaction-safe
  local consumption, not caller-specific boolean flags or a new service.
- Direct Linq and Telegram paths are excluded because separate dirty worktrees
  already own them.
- If the complete caller inventory cannot fit one safely reviewable patch, ship
  the foundation plus the highest-risk callers and name the residuals.

## Completion notes

- Added one request-local, WeakMap-backed prepared Web-root capability. Its
  public shape carries only root identity; cloned or serialized values cannot
  recover the cached key capability.
- Generic mailbox append and its prepared envelope adapter settle ingress-root
  work before transaction entry, revalidate exact root identity under the
  canonical lock, and permit one full fresh-cache retry after typed drift.
- Privy completion settles live provider authority, the exact control root,
  and existing private projections before transaction entry. Member identity,
  primary and secondary verified email, and transaction-local routing work run
  cache-only after exact root revalidation. Parallel preparation drains all
  started siblings and retains the first observed failure.
- ReviewGPT reported one High finding: secondary verified-email sync had been
  outside the prepared attempt and could reopen provider-capable crypto under a
  new transaction. The finding was accepted and fixed by keeping that sync
  under the same prepared capability and single retry owner. The same-thread
  correction review passed with no remaining findings.

## Explicit residuals

- Existing transaction-owned mailbox envelope/source/identity adapters remain
  explicit legacy provider-capable surfaces. The new prepared envelope adapter
  is available for their owners to migrate deliberately.
- Direct Linq and direct Telegram preparation remain owned by their separate
  lanes and were not edited here.
- Device-sync and meal-photo mailbox preparation, Stripe usage-credit callers,
  and Starter/activation prewarming remain owned by their separate active or
  completed lanes and were not duplicated here.
- No schema, durable preparation record, queue, retry ledger, or second crypto
  abstraction was added.

## Verification

- Passed 279 focused Web crypto, mailbox, member-store, Privy, route, and
  signup-timezone tests across 10 files.
- Passed hosted Web typecheck after the final correction and the full root
  typecheck across every workspace app/package.
- Passed scoped ESLint with zero findings.
- Passed `git diff --check`, docs drift, hosted crypto and Temporal architecture
  guards, root dependency/workspace/privacy guards, and a diff-only
  secret/direct-identifier scan.
- Passed the local ReviewGPT same-thread correction loop. The scoped commit is
  created through `scripts/finish-task`; no push or PR is performed.
Completed: 2026-08-12
