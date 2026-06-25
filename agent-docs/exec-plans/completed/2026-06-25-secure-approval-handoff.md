# Secure Approval Handoff

## Goal

Diagnose and fix the production secure approval loop where a vault-file
iMessage send repeatedly requests approval after the user approves the request.

Success criteria:

- A file-send intent that has matching secure approval becomes dispatchable
  instead of looping into another approval request.
- Retryable and awaiting-approval outbox states remain fail-closed when approval
  is missing, stale, mismatched, or expired.
- The fix stays at the existing approval/outbox/runtime ownership boundary and
  does not add a scheduler, queue, or duplicate state owner.
- Focused regression coverage proves the broken handoff.

## Constraints

- Do not commit production member ids, message contents, vault paths, approval
  URLs, screenshots, or local machine identifiers.
- Preserve hosted runtime ownership: web owns approval authority and runtime
  owns outbox/delivery handling.
- Keep the change small and composable.

## Current Evidence

- Reported production outbox intents for the target PDF are stuck in retryable
  state with `ASSISTANT_VAULT_FILE_APPROVAL_UNAVAILABLE`.
- Newer attempts can remain `awaiting_approval` with no dispatch token.
- Local evidence says file lookup and intent payload creation are healthy; the
  failure is the approval verification handoff into vault-file delivery.
- Focused repro proved the handoff can fail when the first vault-file approval
  request is created before the outbox intent derives the concrete current
  conversation binding. A later retry resolves the same target, changes the
  approval fingerprint under the same action id, and the web approval owner
  rejects it as an identity conflict.

## Investigation Plan

1. Trace vault-file secure approval request creation, approval callback storage,
   and delivery verification.
2. Identify the durable identity used to correlate approval rows/tokens with
   pending outbox file-send intents.
3. Add or adjust focused tests to reproduce the loop. Done.
4. Implement the smallest fix at the existing owner boundary. Done: preserve
   the optional `bindingDelivery` input so normal outbox target derivation can
   bind the conversation before the approval request is created.
5. Run focused tests, typecheck, and PR-lane review. In progress.

## Notes

- Branch/worktree: `codex/secure-approval-handoff`.
- No production data should be written into repo artifacts.
- Focused regression command passed after failing before the fix:
  `pnpm --dir packages/assistant-engine test -- test/assistant-vault-file-send.test.ts --testNamePattern "keeps the approved action request stable"`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
