# Preserve durable acknowledgement during mailbox usage denial

Status: completed
Created: 2026-10-24
Updated: 2026-10-24

## Goal

Keep imported conversation work eligible for durable acknowledgement when AI usage denies a later fetch. The server's consumed floor remains the sole acknowledgement authority.

## Success criteria

- A synthetic request with imported cursor 12 and server consumed floor 11 returns consumed floor 11 on denial.
- Denial still returns no items and clamps maximum sequence to the requested import cursor.
- Existing allowed, low-usage, consent and system-work behavior passes focused route tests.
- Relevant typecheck, candidate review, independent review and exact-head CI pass before coordinated merge.

## Scope

- In scope: use the existing mailbox projection's consumed floor in the denied response; regression coverage and a narrow contract clarification.
- Out of scope: replay, runtime wake, historical snapshot recovery, allowance changes, provider behavior, typing timing and runner changes.

## Constraints

- No Claude invocation or new external model service. Preserve existing sessions and results.
- No production mutation or raw production data in this plan, source, tests or PR.
- The separately proposed hosted diagnostic remains unapproved and is not needed for this forward correction.

## Risks and mitigations

1. A false consumed floor can cause terminal input compaction before durable server acknowledgement. Return the already-read canonical floor instead of deriving one from import progress.
2. Accidentally reopening usage-denied work: preserve empty items, maximum-sequence clamp and denial bookkeeping; test these explicitly.
3. A forward fix does not repair a previously compacted snapshot. Do not claim backlog recovery or measured reply speedup.

## Tasks

1. Reproduce divergent imported/consumed cursor behavior with the real route and synthetic fixtures.
2. Change only denied-response acknowledgement authority and document the existing contract.
3. Run focused tests and relevant checks, inspect the complete diff, and publish a scoped candidate.
4. Obtain permitted independent review and exact-head CI, then coordinate merge/release ownership.

## Decisions

- Reuse the existing projection; no extra database or provider request, new state, abstraction or retry.
- Product UX effort: Patch. Denied conversation imports remain blocked while already imported terminal work retains its acknowledgement eligibility. Allowed/low-usage imports and manual system controls remain unchanged.
- Product UX status: Ready for the narrow forward correction after real-route and terminal-compaction proof. No new member action or interface; no historical recovery claim.
- The existing authorized ChatGPT GPT-6 Pro ReviewGPT route was explicitly confirmed as permitted; no Claude or newly introduced model service was used.

## Verification

- Red: focused real-route test fails for imported cursor 12 (actual consumed 12; expected 11); matching imported/consumed cursor 11 passes.
- Green: all 145 internal-route tests pass, including denial in default and imported-sequence modes; existing runtime mixed-channel terminal compaction test passes.
- Web typecheck passes on pinned Node 24.22.1. Complexity guard passes (maximum 9, zero hotspots); docs drift and gardening pass.
- Candidate review: one existing response field now derives from its canonical owner. Empty items, maximum cursor clamp, denial bookkeeping, auth and provider-input surfaces are unchanged.
- Changelog: `conversation-usage-pause-progress` records the narrow reliability outcome for PR #4348. Generation and all four archive-rendering tests pass; presentation is unchanged.
- PR #4348 head `996e71e43b07062354137e5fc082a603677bf616` passed all five required CI contexts, including aggregate Release checks, both CLI platforms, hosted billing and Temporal compatibility.
- Independent round 1: GPT-6 Pro, managed Eragon lane, exact committed turn and attachment verified; full sensitive snapshot metadata names the same head and six changed files. Completed response contains `ROUND_OUTCOME: PASS` and `REVIEW_COMPLETE`. Observed response wait exceeded 188 seconds. The review traced the corrected floor through import, compaction and checkpoint acknowledgement; no qualifying findings or complexity opportunities.
- Parent final review accepts the result: the existing canonical floor prevents false acknowledgement without making terminal input runnable; no added calls, retries or state. Zero accepted findings remain.
- Review reference: https://chatgpt.com/c/6add0c5d-e060-83ea-9a03-2bb5e8de0086. Local response and exact-turn capture remain in ignored `audit-packages/pr-4348-round-1.md` and its capture metadata.
- Release coordination: the separate Web crypto-read correction has no file or compatibility overlap. Neither that owner nor the checkpoint-removal lane holds a global Web release slot. Merge serially after each independent gate and verify normal Git-managed publication at the final combined main source; no manual deploy or runtime wake.
- This plan closes implementation and review. Its explanatory closeout changes no executable behavior or implemented contract; fresh exact-head CI and coordinated merge/publication remain completion gates for the task. Historical recovery and measured production latency are unverified.
Completed: 2026-10-24
