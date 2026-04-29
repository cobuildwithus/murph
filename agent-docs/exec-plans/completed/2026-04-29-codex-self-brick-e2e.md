# Codex Self-Brick E2E Guard

Goal (incl. success criteria):
- Add focused e2e-style coverage proving a bad hosted Codex edit to its writable runtime files cannot permanently brick later hosted wakes.
- Success means a first-run corrupted hosted Codex home is excluded from the workspace snapshot and a later restored invocation can regenerate valid Codex config.

Constraints/Assumptions:
- Test-only change unless coverage exposes an existing production gap.
- Preserve unrelated dirty work and active hosted-runtime/Cloudflare liveness rows.
- Do not write personal identifiers or absolute local paths into tracked files.

Key decisions:
- Cover the persisted self-brick boundary in `packages/assistant-runtime`: real filesystem roots, hosted snapshot/restore, and hosted Codex config regeneration.
- Avoid full hosted-local Cloudflare e2e because this risk is specifically snapshot persistence of writable Codex runtime files.

State:
- focused_verified_pending_close

Done:
- Read required repo workflow, verification, security, reliability, and testing docs.
- Identified hosted Codex `CODEX_HOME` as the relevant writable self-brick surface.
- Added `packages/assistant-runtime/test/hosted-runtime-codex-self-brick-e2e.test.ts`.
- Focused no-coverage Vitest passed.
- Security/privacy review, coverage-write review, and final task review completed with no test changes needed.

Now:
- Clear the active plan/ledger row.

Next:
- Handoff with focused proof and unrelated verification blockers.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/test/hosted-runtime-codex-self-brick-e2e.test.ts`
- `agent-docs/exec-plans/completed/2026-04-29-codex-self-brick-e2e.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-codex-self-brick-e2e.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime typecheck` failed on pre-existing dirty-tree errors in `packages/assistant-engine/src/assistant/active-turn-input-controller.ts` and package entrypoint resolution.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/test/hosted-runtime-codex-self-brick-e2e.test.ts` failed at the same pre-existing package typecheck step.
- Single-file `--coverage` run executed the test but failed package global coverage thresholds because only one test file was selected.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
