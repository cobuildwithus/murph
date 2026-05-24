Goal (incl. success criteria):
- Fix follow-up review findings from commit 4a566112 without broadening architecture.
- CLI submitted payloads accept current singular and plural wearable residual parameter packs while rejecting mismatched family/layer pairs.
- Hosted-local Linq scheduled-reminder E2E proves Temporal scheduled wake delivery without helper nudges and asserts enough pre-due runway.
- Hosted assistant runtime checkpoints future automation wakes discovered by manual maintenance passes.
- Required focused checks and repo completion review pass, with unrelated dirty work preserved; full `test:diff` is currently blocked by unrelated hosted-onboarding fixture drift in existing `apps/web` dirty work.

Constraints/Assumptions:
- Keep changes narrow and composable; do not add speculative abstractions.
- Preserve unrelated active worktree edits and ledger rows.
- Do not expose local paths, local usernames, secrets, raw Authorization headers, or raw health payloads in docs, tests, or output.
- Preserve existing generated CLI artifact diffs from unrelated `event edit` work; the Murph Age payload parser change does not alter generated command schemas.

Key decisions:
- Use a small family-to-layer invariant at the CLI Zod boundary instead of duplicating more health-metrics internals.
- Add plural submitted pack support because the owning health-metrics calculator already accepts it.
- Make the scheduled-reminder E2E wait for the Linq send without runner nudges so the test remains proof of the scheduled wake.
- Treat non-alarm hosted assistant next-wake metadata changes as checkpoint-worthy state so scheduling state reaches Temporal.

State:
- active

Done:
- Four review subagents completed; they found CLI schema invariant issues, E2E proof-quality/runway issues, and one runtime-control continuation guard issue, all addressed in this task scope.

Now:
- Rerun hosted-local scheduled-reminder E2E and final hygiene checks after the runtime-control continuation narrowing.

Next:
- Commit the scoped task files with the active plan archived, preserving unrelated generated CLI, hosted-onboarding, core, and DeepSec dirty work.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/cli/src/commands/murph-age.ts`
- `packages/cli/test/murph-age-command.test.ts`
- `packages/query/src/murph-age.ts`
- `packages/query/test/murph-age-runtime.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts`
- `agent-docs/exec-plans/active/2026-05-24-cli-wearable-residual-schema-invariants.md`
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
