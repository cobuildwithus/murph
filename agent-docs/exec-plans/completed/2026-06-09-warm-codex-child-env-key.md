# Warm Codex Child Env Key

## Goal

Fix PR #68 so the reusable Codex App Server process key covers the actual child
environment passed to Codex, preventing stale process authority across warm
reuse.

## Constraints

- Keep the architecture simple: if Codex can see a process env value, that
  value must affect warm reuse.
- Do not reintroduce hosted-specific launch branching in the low-level runner.
- Keep per-turn facts out of process env; pass them through RPC/runtime seams.
- Preserve existing busy/stop/reuse semantics except where env changes require a
  fresh process.

## Scope

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `docs/contracts/00-invariants.md`

## Verification

- `pnpm --filter @murphai/assistant-engine test -- test/assistant-codex-runtime.test.ts` passed.
- `pnpm --filter @murphai/assistant-engine test -- test/assistant-cli-access.test.ts` passed.
- `pnpm test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts docs/contracts/00-invariants.md agent-docs/exec-plans/active/2026-06-09-warm-codex-child-env-key.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.

## Audit

- Security/privacy review: no findings.
- Coverage-write audit: added stable resolved-child-env reuse regression; no remaining gaps. The audit environment could not guarantee the repo-preferred `gpt-5.5` model.
- Deep review: no production-breaking issues found.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
