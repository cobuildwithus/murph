# Approval link handoff

- Goal (incl. success criteria): remove the hard-coded vault-file approval SMS/iMessage copy and ISO expiry line; when a vault-file send needs approval, return the approval link/context to Murph so the normal assistant reply can phrase the request.
- Constraints/Assumptions: preserve exact file/destination binding, passkey approval flow, no file bytes in prompts, no direct sends before approval, no raw identifiers/secrets/local paths in committed artifacts.
- Key decisions: keep approval creation in the existing hosted action-approval path; delete the hard-coded approval-message helper and extra send side effect; return the link through the existing tool-result-to-final-reply path instead of adding a new abstraction.
- State: Done; ready to archive with scoped commit.
- Done: Read required routing, hosted runtime, security, reliability, and package docs; created isolated worktree/branch; located and removed the hard-coded approval message helper and extra approval-link send; added focused assistant-engine coverage and doc note; ran root typecheck and diff-aware verification.
- Now: Close plan with scoped commit.
- Next: Rebase on current `origin/main`, push branch, open draft PR.
- Open questions: None.
- Working set (files/ids/commands): `packages/assistant-engine/src/assistant/vault-file-send.ts`, `packages/assistant-engine/src/assistant/hosted-tool-context.ts`, `packages/assistant-engine/src/assistant/local-service.ts`, `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`, `packages/assistant-engine/test/assistant-vault-file-send.test.ts`, `docs/hosted-sensitive-action-approvals.md`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
