# Dashboard contact projection

## Goal

Remove the dashboard shell's dependency on the full account Settings aggregate
and full routing projection when it only needs Murph contact options.

Success criteria:

- Authenticated dashboard contact composition performs one narrow member read.
- The read selects only the identity, routing, and email fields required to
  render email, text, Telegram, and email-client fallback options.
- Private contact fields decrypt within one hosted domain-root unwrap-cache
  scope and remain request memoized.
- Anonymous behavior and all existing contact-option fallbacks remain unchanged.

## Constraints

- Do not change the Settings page snapshot, direct voice-test path, contact UI,
  auth, or privacy behavior.
- Avoid shared Settings-owned projector files while the parallel Settings lane
  is active.
- Preserve unrelated worktree and coordination-ledger edits.
- Keep private contact data out of logs, tests, docs, and review artifacts.

## Approach

1. Add focused composition tests that encode the anonymous boundary, the
   single-query budget, the exact narrow select, and contact fallback behavior.
2. Replace the two broad loaders in `hosted-contact-context.ts` with a single
   nested Prisma select and contact-local narrow projectors.
3. Run focused tests and the routed `apps/web` diff verification.
4. Run the required coverage-write audit, finish the scoped commit, open a PR,
   and complete CI plus ReviewGPT.

## State

Active.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
