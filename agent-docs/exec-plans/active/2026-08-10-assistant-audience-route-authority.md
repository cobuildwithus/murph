# Assistant audience route authority

## Goal

Allow validated direct Linq assistant notifications to pass the existing audience guard by carrying their already-verified route authority through the runtime, while preserving exact-match, fail-closed delivery and recovering the blocked mailbox head without changing queue order.

## Proven production symptom

- A direct Linq referral notification preserved its explicit destination but lost the matching binding-authority proof at the hosted-runtime translation boundary.
- The assistant audience policy therefore classified the notification as unverified external and correctly rejected it with `ASSISTANT_AUDIENCE_UNVERIFIED`.
- Device items remain queued behind that unconsumed mailbox head.
- Inactive-member access gates and unrelated storage-restore failures are intentional or separate and remain out of scope.

## Success criteria

- The audience guard is unchanged and valid direct Linq notifications pass only when existing trusted authority exactly matches member, channel, directness, and delivery target.
- Missing, stale, mismatched, non-direct, wrong-member, and wrong-channel authority still fail closed.
- Referral producers reuse one owning helper to attach direct-route authority for supported direct channels without introducing another state owner.
- The existing encrypted mailbox head can be transactionally upgraded in place, preserving item identity, lane sequence, dedupe identity, and pointer order before re-signaling.
- Group routes, fallback prevention, and inactive-member gates retain their current behavior.

## Implementation

1. Have ReviewGPT inspect the real contracts, producer, runtime translator, mailbox transaction owner, recovery path, tests, and recent history, then return a complete patch artifact.
2. Inspect every returned hunk and accept only the smallest invariant-preserving data flow.
3. Apply the accepted patch in this isolated task worktree and refine only when focused proof exposes a defect.
4. Run focused tests, typechecks, and direct audience-policy and mailbox-ordering proof.
5. Push an exact candidate; run the preliminary specialist review and final ReviewGPT audit concurrently with required CI; resolve accepted findings.
6. Document compatible deployment order and canary the bounded existing-item recovery before broader recovery.

## Verification

- Assistant-engine coverage exercises the real audience guard for exact-match and mismatch cases.
- Assistant-runtime coverage proves explicit delivery gains binding authority only from an exact hosted-member, channel, directness, and target match.
- Web producer and recovery coverage proves direct Linq authority is attached and an existing head is atomically upgraded without appending or reordering.
- Focused tests and typechecks pass for every changed package and app surface.
- Exact pushed-head CI and required independent ReviewGPT gates are green before merge or production recovery.

## Candidate proof

- ReviewGPT returned a complete patch artifact; the parent inspected every hunk, confirmed privacy and whitespace cleanliness, and verified exact reverse-apply equivalence after application.
- The focused Web suite passed 116 tests across destination binding, both referral producers, bounded recovery, and mailbox replacement; the corrected mailbox test then passed all 71 tests in its file.
- The hosted-runtime event suite passed 45 tests, including exact authority and every fail-closed mismatch.
- The assistant-engine audience-authority integration suite passed 8 tests through the real guard.
- Web, assistant-runtime, and assistant-engine typechecks passed.
- The public changelog now describes the member-visible referral recovery without exposing incident details; its focused page, route, and contract suite passed 42 tests.
- `pnpm docs:drift` and `git diff --check` passed.
- Exact-head CI and the preliminary and final ReviewGPT PR gates remain pending on the pushed candidate.
