Goal (incl. success criteria):
- Update completion/deploy documentation so PR authors and agents call out Worker/container deploy skew when a change depends on Cloudflare Worker code and runner container state agreeing.
- Success means completion handoffs and PR descriptions have explicit guidance to mention rollout windows, safe ordering, smoke checks, and expected behavior while old warm containers may still run.

Constraints/Assumptions:
- Text-only docs/process change.
- Do not change runtime code, deploy scripts, or verification requirements beyond the wording needed for the workflow rule.
- Preserve privacy guardrails: no local paths, personal identifiers, or sensitive deploy values in docs.

Key decisions:
- Put the agent-facing requirement in `agent-docs/operations/completion-workflow.md` because that owns final handoff and PR description rules.
- Add hosted deploy context only if needed to keep the completion workflow tied to the current gradual container rollout behavior.

State:
- Ready to close.

Done:
- Read repo routing, verification, architecture, baseline invariant, product, and completion workflow docs.
- Confirmed current production runner config uses gradual container rollout with a 300-second active grace period.
- Patched `agent-docs/operations/completion-workflow.md` to require `DEPLOYMENT CONCERNS:` details for temporary deployment skew and to add PR-body guidance for Worker/container compatibility windows.
- Patched `apps/cloudflare/DEPLOY.md` to document expected Worker/container disagreement during gradual rollout and what PRs/handoffs should call out.
- Read back touched sections.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff agent-docs/operations/completion-workflow.md apps/cloudflare/DEPLOY.md agent-docs/exec-plans/active/2026-06-25-deployment-skew-notes.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed, including `apps/cloudflare verify` with 93 test files and 1576 tests passing.

Now:
- Close the active plan and create the scoped commit.

Next:
- Handoff summary with verification evidence.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/operations/completion-workflow.md`
- `apps/cloudflare/DEPLOY.md` (only if needed)
- `agent-docs/exec-plans/active/2026-06-25-deployment-skew-notes.md`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
