# Prepare Linq reaction mailbox roots before transactions

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Keep authenticated Linq group reactions available while removing external
  mailbox-root unwrap work from the reaction context transaction. Prepare the
  exact active mailbox root before the transaction, then revalidate that exact
  route/root authority while locked before appending the encrypted context.

## Success criteria

- A preparation or provider/KMS failure occurs before any transaction starts.
- The transaction performs no provider/KMS root unwrap and uses only the
  prepared exact mailbox root for reaction-context encryption.
- The locked route and active mailbox root are compared with the prepared
  candidate before append; a concurrent change fails or retries safely without
  writing with stale crypto authority.
- Focused tests cover success, preparation failure, stale-root/route detection,
  and the no-provider-work-inside-transaction invariant.
- The affected hosted-web tests and typecheck pass, and the final diff is
  privacy-safe and limited to this owner boundary.

## Scope

- In scope: the Web-owned Linq reaction staging path, mailbox encryption/root
  preparation helpers needed by that path, focused tests, and live architecture
  or reliability documentation whose existing contract changes.
- Out of scope: pending-group setup payload handling, reaction semantics,
  provider webhook parsing, mailbox schema changes, new queues or durable state,
  Cloudflare/runtime behavior, and unrelated crypto refactors.

## Constraints

- Technical constraints: preserve existing chat/owner/route lock ordering and
  request cancellation; treat request-scoped prepared crypto as optimization
  material rather than authority; do not open a transaction until every
  started preparation operation has settled.
- Product/process constraints: preserve the current durable consumed-at-ingress
  mailbox append, dedupe, consumption, and post-commit signal semantics; use
  the ReviewGPT-returned patch only as untrusted implementation intent; leave
  this plan active for the parent to close after exact-head audits and PR gates.

## Risks and mitigations

1. Risk: prepared root authority becomes stale before the transaction locks the
   route.
   Mitigation: carry the exact prepared root identity and route candidate, then
   compare them with freshly locked database state before any append.
2. Risk: a helper silently unwraps a root during the transaction.
   Mitigation: separate explicit preparation from transaction-local encryption
   and add injected call-order proof that fails on provider work after BEGIN.
3. Risk: preparation failure changes durable reaction failure/retry semantics
   or begins a transaction that can block message ingress.
   Mitigation: fail through the existing provider-retry path before transaction
   entry, with focused tests proving zero transaction calls.

## Tasks

1. Trace the current reaction staging, route locking, mailbox encryption, and
   request-scoped root-cache owners; identify the narrow reusable preparation
   boundary.
2. Ask a fresh ReviewGPT implementation thread for a scoped patch and tests,
   then inspect and integrate only correct task-owned hunks.
3. Prepare the exact active mailbox root before transaction entry and carry the
   prepared candidate into a locked route/root revalidation before append.
4. Add deterministic focused tests for success and every relevant failure or
   concurrency edge, including no provider/KMS work inside the transaction.
5. Update live owner docs only if the implementation changes their documented
   contract, run focused hosted-web tests and typecheck, and inspect the final
   privacy-safe diff for scope and maintainability.

## Decisions

- Reuse the existing domain-root/request-scoped crypto preparation owners;
  introduce no new durable state, queue, retry owner, or provider abstraction.
- A root or route mismatch after preparation is not authorized to append; the
  path must abort or perform at most a bounded fresh prepare-before-transaction
  retry according to the existing owner pattern.

## Verification

- Commands to run: focused Vitest for Linq reaction/group-event staging and
  mailbox crypto preparation, the narrow hosted-web typecheck or truthful
  diff-aware lane, `git diff --check`, and a direct injected call-order test.
- Expected outcomes: all focused checks pass; preparation failure starts no
  transaction; route/root change produces no stale append; provider/KMS unwrap
  count is zero after transaction entry; the successful path preserves the
  same durable consumed-at-ingress reaction mailbox evidence as before.
Completed: 2026-08-10
