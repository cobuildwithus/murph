# Critical group backup recovery

Goal (incl. success criteria):
- Keep recognized-member iMessage groups working on an assigned `AT_RISK` line.
- When the incoming line is hard-blocked, send the recognized initiating member one private recovery message from a selected healthy Murph line.
- The recovery message must contain that same healthy sending number, clearly say to add it inside the existing group chat, and use one of exactly 50 reviewed copy variants.
- Success means the retry on the healthy line provisions the ordinary canonical group route without participant mutation, route transfer state, or another recovery owner.

Constraints/Assumptions:
- Preserve the existing single canonical route/account owner.
- Never send the recovery message or mutate the group roster from the hard-blocked line.
- Reuse existing health, capacity, delivery, and idempotency owners; add no schema, queue, manager, cron, or handoff state machine.
- Notify only a recognized active member whose inbound group message triggered the recovery path; unknown or unauthorized senders remain silent.
- The selected healthy sender is the backup number rendered in the copy, and retries must preserve both sender and variant.
- Treat 50 variants as a reviewed product-copy catalog, not carrier-enforcement avoidance.
- Keep private identifiers, raw phone numbers, group names, rosters, and provider free text out of logs, plans, fixtures, and public artifacts.

Key decisions:
- Separate home-line assignment eligibility from relationship-qualified inbound group admission.
- Allow exact assigned-line `AT_RISK` inbound groups to use the normal route/runtime path.
- Use a private healthy-line recovery message for hard-blocked incoming lines; do not add or remove participants automatically.
- Store variants as immutable data behind one renderer and deterministic selector rather than branching functions.
- Every variant must preserve the same action contract: add the displayed backup Murph number inside the existing group chat, then retry the introduction.

State:
- Isolated task worktree created from current `origin/main`.
- ReviewGPT planning recommendation reviewed.
- Implemented the scoped group-line recovery behavior in this task branch.
- Product-experience review found one retry handling gap; accepted and fixed.
- Product-experience focused recheck returned `NO FINDINGS`.
- Focused tests, typecheck, lint, and whitespace checks pass locally.

Next:
1. Commit and push a review candidate.
2. Open/update the PR with the required intent, verification, and change-shape contract.
3. Run the preliminary `completion-specialists` ReviewGPT pass.
4. Complete parent-final review, final verification, plan closure, final ReviewGPT, CI, and mergeability gates.

Open questions (UNCONFIRMED if needed):
- None. Prefer the smallest existing private-delivery seam that can bind the selected healthy sender and existing idempotency key.

Working set (expected):
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/hosted-onboarding-*.test.ts`
- `agent-docs/operations/imessage-deliverability.md`
- this plan
