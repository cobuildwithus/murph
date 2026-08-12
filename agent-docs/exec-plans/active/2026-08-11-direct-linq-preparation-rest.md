# Finish direct Linq preparation binding

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Finish the direct-Linq inbound preparation boundary so the exact member and
  mailbox ingress root used by the planner are prepared before `BEGIN`, then
  revalidated under the transaction without provider or KMS work under locks.

## Success criteria

- Direct identity and home-chat candidate reads use narrow blind-index/core
  member projections rather than broad decrypted routing projections.
- Preparation binds the resolved direct member and mailbox ingress root.
- Member, owner, or root drift rolls back and receives at most one fresh
  prepare-before-transaction attempt; repeated drift fails closed.
- Preparation failure opens no transaction, and transaction-time crypto is a
  request-cache hit.
- Focused hosted Web tests, Web typecheck, scoped lint, privacy/no-JS guards,
  exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope: direct Linq identity/home-chat resolution, direct mailbox-root
  preparation and binding, bounded preparation retry, and focused tests.
- Out of scope: Telegram, schema or migration changes, new queues, exported
  abstractions, unbounded retries, and new durable attempt state.

## Constraints

- Technical constraints: reuse the existing request-scoped crypto cache,
  privacy blind indexes, narrow member projections, and bounded retry flow.
  Keep provider calls, decryptions, and KMS unwraps outside transactions.
- Product/process constraints: preserve direct-message semantics and recent
  Family invite/recovery behavior; use the worktree/PR lane and exact-head
  completion gates.

## Risks and mitigations

1. Risk: stale preparation encrypts a wake for the wrong member after identity
   or mailbox-root drift.
   Mitigation: bind the exact prepared member/root and revalidate them before
   any transactional mailbox write.
2. Risk: retry logic broadens into hidden state or an unbounded loop.
   Mitigation: reuse the established single retry signal and assert the second
   mismatch fails closed.
3. Risk: the core-candidate change overwrites newer Family changes.
   Mitigation: integrate against current main, inspect the base-to-head diff,
   and retain focused Family tests in the verification slice.

## Tasks

1. Collect and inspect the independent ReviewGPT core and binding patches.
2. Integrate only the smallest compatible current-main change.
3. Add or refine executable drift, zero-transaction, and cache-hit proof.
4. Run focused verification and inspect the privacy-safe diff.
5. Commit through `scripts/finish-task`, publish a draft PR, and run the
   specialist and final exact-head ReviewGPT/CI gates.
6. Resolve actionable findings and merge when every required gate is green.

## Decisions

- Keep the direct-Linq core and mailbox-root binding in one PR because the
  narrow candidate is the preparation input the binding must authenticate.
- Do not duplicate the independently landed fail-fast drain change.

## Verification

- Commands to run: focused hosted Web Vitest files selected from the final
  diff; `pnpm --dir apps/web typecheck`; scoped ESLint; `pnpm no-js`; privacy
  and architecture/diff guards; exact-head GitHub checks and ReviewGPT gates.
- Expected outcomes: the direct route is unchanged for a stable identity/root;
  drift gets one fresh pre-transaction preparation; preparation/KMS failure
  starts zero transactions; no new persisted state or privacy expansion.
