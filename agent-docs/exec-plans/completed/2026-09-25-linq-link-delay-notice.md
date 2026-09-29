# Acknowledge delayed Linq link delivery

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Goal and Product UX

Outcome: Give a direct-chat recipient one factual notice when a current reply's
text is accepted but its separate link send remains unresolved.
Entry and promise: The existing outbox owns retrying the same link under the
same provider keys. The notice explains that retry without claiming an outage,
handset delivery, or an estimated completion time.
Reaches: Current direct Linq replies with a newly persisted partial-link receipt.
Normal success, groups, old background retries, approval waits, and missing
handset receipts retain their existing behavior.
Proof: Exercise the real hosted drain and Linq adapter with synthetic provider
responses: normal completion, partial link acceptance, repeated retry, eventual
success, and notice failure. Confirm identical original send keys and no mailbox
consumption by the notice.

## Design and constraints

Use the existing partial receipt as the dedupe boundary and the existing hosted
progress send dependency for one best-effort notice. Persist retry state first.
No new queue, schema, timer, model call, or independently retried notice. A crash
between checkpoint and notice can omit the notice; link recovery stays durable.
A stable notice key also protects duplicate in-flight attempts. Existing route,
engagement, line-health and liveness checks continue to govern provider entry.

## Tasks

1. Add the scoped notice at the hosted delivery boundary after durable retry.
2. Replay synthetic delivery journeys and run runtime typecheck.
3. Update delivery contract and member changelog; inspect full diff and complexity.
4. Close the plan and make a scoped commit. No production deployment.

## Verification

- Full hosted Linq outbox regression suite: 24 tests passed.
- Final focused replay after strengthening mailbox evidence: 5 cases passed.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm --dir apps/web changelog:generate`: passed.
- `pnpm complexity:diff`: passed; existing dispatch hotspots did not increase.
- `git diff --check` and added-content path privacy scan: passed.

Product UX: Ready for local handoff. Synthetic provider-boundary proof covers a
newly delayed link, repeated retry with stable original keys, eventual success,
failed notice, ordinary success, groups and background retries. The notice uses
a distinct key, has no original intent identity or answered-mailbox set, and
cannot replace the final two-message receipt. Provider retries of a failed notice
reuse its one key; later outbox retries do not attempt another notice.

Parent review: no added state or model behavior, and no change to original
retry, approval, final confirmation or normal send handling. Existing hosted
progress transport rechecks egress authority and liveness. Failure remains
best-effort; real handset receipt is not proven by these synthetic tests.
No new prompt/tool decision changed, so no additional real-Codex journey was
needed beyond the earlier branch's verified prompt recovery work.

No PR, push or production deployment was requested or performed. Required final
ReviewGPT and exact-head CI remain PR completion gates on a stable pushed head.
Completed: 2026-09-25
