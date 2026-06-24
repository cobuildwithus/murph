Goal (incl. success criteria):
- Resolve PR #263 ReviewGPT round 4 false-connected finding.
- Legacy hosted Codex `connected` receipts must not persist or display a usable ChatGPT connection after managed auth is scrubbed.

Constraints/Assumptions:
- Keep the fix narrow and fail-closed; do not re-enable hosted ChatGPT connect.
- Preserve local-development seeded ChatGPT auth behavior.
- Preserve unrelated active ledger rows and working-tree edits.

Key decisions:
- Treat legacy post-checkpoint `connected` records as failed cleanup callbacks while hosted credential isolation is unavailable.
- Add a one-time data cleanup for any canary `connected` rows.

State:
- Complete.

Done:
- ReviewGPT round 4 response captured in `audit-packages/pr-263-round-4.md`.
- Legacy `connected` post-checkpoint records are converted to failed cleanup callbacks.
- Web store `connected` updates fail closed to `connect_error`.
- One-time data cleanup migration clears canary `connected` rows.
- Focused web/runtime tests, typecheck, docs drift, and diff checks passed.

Now:
- Ready to commit and push.

Next:
- Reconcile PR branch with current `main`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`
- `packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts`
- `apps/web/prisma/migrations/**`
- `agent-docs/references/hosted-runtime-protocol.md`
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
