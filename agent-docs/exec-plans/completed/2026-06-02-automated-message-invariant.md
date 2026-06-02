Goal (incl. success criteria):
- Add a baseline invariant that prevents hard-coded messages from being automatically sent to users, except the AI usage gate, signup link, and first welcome flows.
- Success means the invariant is present in `docs/contracts/00-invariants.md`, the docs are read back, required verification passes, and the scoped change is committed.

Constraints/Assumptions:
- Text-only docs/process change; no runtime behavior changes.
- Preserve unrelated ledger and working-tree edits.
- Do not expose secrets, direct identifiers, local paths, or private payloads.

Key decisions:
- Place the rule in a dedicated user-facing message sends section so it applies across local and hosted delivery paths.

State:
- Active.

Done:
- Required routing and product docs read.
- Coordination ledger row added.
- Baseline invariant added to `docs/contracts/00-invariants.md`.
- Read back touched docs.
- Verification passed: `pnpm typecheck`; `bash scripts/workspace-verify.sh test:diff docs/contracts/00-invariants.md agent-docs/exec-plans/active/2026-06-02-automated-message-invariant.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.

Now:
- Close the plan with a scoped commit.

Next:
- Handoff.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `docs/contracts/00-invariants.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-06-02-automated-message-invariant.md`
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
