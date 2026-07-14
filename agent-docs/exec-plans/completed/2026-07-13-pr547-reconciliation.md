Goal (incl. success criteria):
- Reconcile PR #547 with current `main` and ship the authenticated iMessage mini-app backend without weakening the current companion, hosted-session, consent, privacy, or device-agent authority boundaries.
- Success means the PR is conflict-free, its Messages-only derived credential remains prefix-separated and hash-only, focused and required verification pass on the reconciled head, required specialist audits have no unresolved actionable findings, ReviewGPT reaches zero accepted findings, CI is green, and the PR is merged.

Constraints/Assumptions:
- Preserve the existing feature intent: Privy tokens stay host-app-only; the extension receives only a random 24-hour Messages-scoped bearer; message URLs carry no authority or identity; every action rechecks current hosted access and launch consent.
- Reuse current owners and delete obsolete branch-era code when `main` already provides the behavior; do not add schema, persistence, compatibility, queue, or retry machinery without present production evidence.
- Preserve unrelated work and all current `main` invariants. PR #573 is out of scope.
- This is high-risk auth/session and public-route work. Required completion passes are `security-privacy-review` and `coverage-write`; the PR-lane ReviewGPT loop is the final cross-cutting gate.

State:
- Completed locally: reconciled with current `main`, verified, and cleared required local audits. Final PR gates continue on the pushed exact head.

Done:
- Reverified the isolated PR worktree is clean and exactly matches the pushed PR head.
- Read the PR intent, original completion plan, relevant security/deliverability rules, and current workflow/verification requirements.
- Fetched current `main`; the branch is one patch commit ahead and 493 commits behind.
- Merged current `origin/main` twice as it advanced, preserving both the current WHOOP relay instructions and the Messages extension proof during the only semantic conflict.
- Proved the derived credential can self-revoke after access or consent loss and corrected durable architecture/security wording that had overclaimed those gates applied to every action.
- Ran focused route/service proof: 13/13 tests passed.
- Ran the truthful scoped owner lane with `pnpm test:diff`: all hosted guards, dev smoke, 4,903 web tests, lint with zero errors, and the production Next build/type validation passed.
- Ran required `security-privacy-review`: no evidence-backed medium-or-higher findings.
- Ran required `coverage-write`: strengthened exact SHA-256 persistence and random-per-enrollment proof; focused 13/13 tests passed afterward with no unresolved coverage findings.
- Completed parent final review of enrollment, proof, revocation, prefix isolation, privacy deletion/export coverage, and durable docs with no unresolved actionable findings.

Now:
- Close the plan in the scoped final commit, push the exact head, and update the PR intent/change-shape contract.

Next:
- Start exact-head ReviewGPT concurrently with CI, resolve only locally proven findings, and stop when the PR is merge-ready without merging it.

Open questions (UNCONFIRMED if needed):
- Physical-device Keychain and installed Messages-extension acceptance remains a deployment/device proof unless the current repo now provides an automated equivalent.

Working set (files/ids/commands):
- PR #547 / `codex/imessage-mini-app`
- `apps/web/app/api/device-sync/companion/imessage-mini-app/**`
- `apps/web/src/lib/imessage-mini-app/**`
- hosted agent-session/device-sync session owners and focused tests
- `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, companion app product spec
- `pnpm test:diff <touched paths>` and focused app test commands selected after reconciliation

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
