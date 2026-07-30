# Persist ambiguous top-up identity across remount

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Keep the browser-owned request identity stable across a full page remount
  until a create-capable usage top-up request returns durable purchase evidence.

## Success criteria

- Personal, Family, and group targets store one target-scoped request key before
  the initial create-capable request enters the network.
- Recovery miss, dialog dismissal, page remount, and tab restoration retain the
  key and the next explicit Add action reuses it.
- Only a durable selection response with server-owned proof that the submitted
  request key matched clears the stored key; active/return projections,
  projected-purchase retries, and different-key recovery retain it.
- Unavailable or failed browser storage cannot silently mint another key while
  an ambiguous identity may exist.
- The delayed original and remounted authorization still produce one purchase
  and at most one Stripe lifecycle, including when the winner fulfills first.

## Scope

- In scope: session-storage identity owner, initial hydration, lifecycle
  clearing, all-target remount proof, terminal ordering proof, live docs, and
  the post-cap ReviewGPT retrospective.
- Out of scope: schema changes, server tombstones, new endpoints, queues,
  payment owners, or Stripe policy changes.

## Tasks

1. [x] Reproduce request-key loss across full component remount.
2. [x] Add the smallest target-scoped session identity owner.
3. [x] Fail closed on unavailable storage and clear only with exact-key proof.
4. [x] Prove all-target remount, projection, recovery, and terminal ordering.
5. [x] Run code verification and product recheck; prepare the exact correction
   head for Round 6.

## Decisions

- The user's explicit instruction to run ReviewGPT to completion authorizes
  continuation beyond the five-round automatic cap.
- Session storage extends the existing browser owner across a tab-local remount;
  it does not become payment authority.
- The external final ReviewGPT, acceptance, and CI gates continue against the
  immutable pushed correction after this implementation plan is archived.

## Verification

- Focused dialog and purchase-service tests: 192 passed.
- Web typecheck: passed.
- Touched-file ESLint: passed.
- Agent-doc drift and `git diff --check`: passed.
- Product experience recheck after exact-key correction: `NO FINDINGS`.
- Canonical `pnpm test:diff apps/web packages/assistant-engine`: passed,
  including 7,031 Web tests, the Web production build, and 2,016 Cloudflare
  tests.
- Final ReviewGPT, acceptance, and CI: pending against the pushed exact head.
Completed: 2026-07-28
