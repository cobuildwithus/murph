Goal (incl. success criteria):
- Update the root workspace consumer to `@cobuild/review-gpt@^0.4.1`.
- Keep the repo-specific verification/docs gates satisfied for this dependency bump.

Constraints/Assumptions:
- Keep the change scoped to root package metadata plus the minimum active-plan bookkeeping this repo requires.
- Do not absorb unrelated in-flight work or untracked scenario manifests into this commit.
- Preserve adjacent active lanes and leave their working sets untouched.

Key decisions:
- Treat the dependency bump as a package-metadata/process change that should carry its own active plan entry.
- Reuse the existing root workspace bump from the release sync rather than changing package topology or scripts.

State:
- in_progress

Done:
- Confirmed the root `package.json` and `pnpm-lock.yaml` now point at `@cobuild/review-gpt@^0.4.1`.
- Ran the root verification flow far enough to confirm the first failure is the docs-drift gate, not a dependency/type/runtime regression.

Now:
- Add the required active-plan bookkeeping, refresh generated doc inventory, and rerun the repo checks.

Next:
- Commit the dependency bump plus the required docs bookkeeping once verification passes.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the untracked `assistant-cron-preset-*` scenario manifests belong to another in-flight lane and should remain outside this commit.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-25-review-gpt-0-4-1-bump.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/generated/doc-inventory.md`
- `package.json`
- `pnpm-lock.yaml`
- `bash scripts/check-agent-docs-drift.sh`
- `bash scripts/doc-gardening.sh --fail-on-issues`
- `pnpm verify:repo`
