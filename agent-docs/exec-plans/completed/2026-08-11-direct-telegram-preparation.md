# Prepare direct Telegram routing before transactions

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Add the missing direct-Telegram pre-transaction preparation boundary so the
  exact sender and mailbox/control roots needed by the planner are warm and
  bound before `BEGIN`, with no provider or KMS work under locks.

## Success criteria

- Direct Telegram resolves sender authority through existing blind-index/core
  member projections before a transaction begins.
- Preparation warms and binds the exact control/mailbox roots consumed by the
  direct-member planner.
- Sender, route, or root drift rolls back and receives at most one fresh
  prepare-before-transaction attempt; repeated drift fails closed.
- Preparation or KMS failure opens no transaction, and transaction-time crypto
  is cache-only.
- Focused hosted Web tests, Web typecheck, scoped lint, privacy/no-JS guards,
  exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope: direct Telegram sender resolution, crypto preparation and binding,
  bounded preparation retry, and focused tests.
- Out of scope: Linq behavior, schema or migration changes, new queues,
  exported abstractions, unbounded retries, and new durable attempt state.

## Constraints

- Technical constraints: reuse existing request-scoped preparation,
  blind-index/core member authority, direct-member mailbox planning, and the
  established retry signal. Keep provider, decrypt, and KMS work outside the
  transaction.
- Product/process constraints: preserve direct Telegram delivery semantics;
  use the worktree/PR lane and exact-head completion gates.

## Risks and mitigations

1. Risk: direct Telegram keeps skipping preparation and unwraps a mailbox root
   while locks are held.
   Mitigation: prepare the exact sender/root before `BEGIN` and prove the
   transaction path uses only the request cache.
2. Risk: sender or root drift writes to the wrong mailbox.
   Mitigation: bind and revalidate the prepared values, then allow one bounded
   fresh preparation before failing closed.
3. Risk: a Telegram-specific implementation duplicates generic machinery.
   Mitigation: reuse the existing preparation result and retry contracts and
   reject unnecessary state or abstractions during patch review.

## Tasks

1. Collect and inspect the independent ReviewGPT implementation patch.
2. Integrate only the smallest compatible current-main change.
3. Add or refine executable zero-transaction, drift, and cache-hit proof.
4. Run focused verification and inspect the privacy-safe diff.
5. Commit through `scripts/finish-task`, publish a draft PR, and run the
   specialist and final exact-head ReviewGPT/CI gates.
6. Resolve actionable findings and merge when every required gate is green.

## Decisions

- Keep Telegram independent from the direct-Linq PR so each external ingress
  boundary is reviewable and revertible on its own.

## Verification

- Commands to run: focused hosted Web Vitest files selected from the final
  diff; `pnpm --dir apps/web typecheck`; scoped ESLint; `pnpm no-js`; privacy
  and architecture/diff guards; exact-head GitHub checks and ReviewGPT gates.
- Expected outcomes: stable direct messages behave unchanged; preparation/KMS
  failure starts zero transactions; drift gets one fresh preparation; no new
  persisted state or privacy expansion.
Completed: 2026-08-12
