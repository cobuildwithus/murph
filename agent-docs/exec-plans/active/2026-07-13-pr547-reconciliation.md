Goal (incl. success criteria):
- Reconcile PR #547 with current `main` and ship the authenticated iMessage mini-app backend without weakening the current companion, hosted-session, consent, privacy, or device-agent authority boundaries.
- Success means the PR is conflict-free, its Messages-only derived credential remains prefix-separated and hash-only, focused and required verification pass on the reconciled head, required specialist audits have no unresolved actionable findings, ReviewGPT reaches zero accepted findings, CI is green, and the PR is merged.

Constraints/Assumptions:
- Preserve the existing feature intent: Privy tokens stay host-app-only; the extension receives only a random 24-hour Messages-scoped bearer; message URLs carry no authority or identity; every action rechecks current hosted access and launch consent.
- Reuse current owners and delete obsolete branch-era code when `main` already provides the behavior; do not add schema, persistence, compatibility, queue, or retry machinery without present production evidence.
- Preserve unrelated work and all current `main` invariants. PR #573 is out of scope.
- This is high-risk auth/session and public-route work. Required completion passes are `security-privacy-review` and `coverage-write`; the PR-lane ReviewGPT loop is the final cross-cutting gate.

State:
- Active: inspecting current owners and reconciling the stale branch with current `main`.

Done:
- Reverified the isolated PR worktree is clean and exactly matches the pushed PR head.
- Read the PR intent, original completion plan, relevant security/deliverability rules, and current workflow/verification requirements.
- Fetched current `main`; the branch is one patch commit ahead and 493 commits behind.

Now:
- Merge current `main`, resolve conflicts semantically, and inspect the complete reconciled auth/session call path.

Next:
- Run focused proof and required verification, specialist audits, scoped finish commit/push, then CI and ReviewGPT concurrently through merge.

Open questions (UNCONFIRMED if needed):
- Physical-device Keychain and installed Messages-extension acceptance remains a deployment/device proof unless the current repo now provides an automated equivalent.

Working set (files/ids/commands):
- PR #547 / `codex/imessage-mini-app`
- `apps/web/app/api/device-sync/companion/imessage-mini-app/**`
- `apps/web/src/lib/imessage-mini-app/**`
- hosted agent-session/device-sync session owners and focused tests
- `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, companion app product spec
- `pnpm test:diff <touched paths>` and focused app test commands selected after reconciliation

Status: active
Updated: 2026-07-13
