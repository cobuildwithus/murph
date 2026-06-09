Goal (incl. success criteria):
- Land the managed automations patch as a scoped PR.
- Success means Murph-owned scheduled automation seeds are applied idempotently through the existing canonical automation path, hosted runtime wakes can install/update those seeds without blocking foreground work, and focused tests cover create/update/skip behavior.

Constraints/Assumptions:
- Treat the supplied patch as intent, not overwrite authority.
- Keep the architecture minimal: one seed list, one apply function, one hosted runtime hook.
- Do not add a backfill script, a new scheduler, or new durable state outside canonical automation records.
- Preserve unrelated working-tree and active-ledger work.

Key decisions:
- Use a clean worktree based on `origin/main` for the PR branch.
- Use repo-owned canonical automation APIs for persistence rather than writing vault files directly.

State:
- Done.

Done:
- Read required repo routing, architecture, verification, security, and reliability docs.
- Created isolated PR worktree from `origin/main`.
- Confirmed the supplied patch needs `git apply --recount` because new-file hunk counts are malformed.
- Applied the patch and reconciled it against `origin/main`, keeping the minimal seed-list/apply-function/hosted-hook shape.
- Completion review found real issues; fixed them: canonical automation id shape for the seed, explicit id-then-slug existence checks so a user-owned slug is skipped rather than adopted, lazy create-route resolution, and a hosted foreground-input skip for managed maintenance.
- Added mocked unit coverage plus a real-core regression test through actual registry writes, and a fresh-input runtime assertion for the foreground skip.
- Passed typecheck, focused suites, and diff-aware verification; fast-forwarded the branch onto current `origin/main` and re-ran assistant-engine (1177 tests), assistant-runtime (799 tests), and both package typechecks green.

Now:
- Commit through `scripts/finish-task`, push, and open the PR.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/managed-automations.ts
- packages/assistant-engine/src/index.ts
- packages/assistant-engine/test/managed-automations.test.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- `git apply --recount`
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
