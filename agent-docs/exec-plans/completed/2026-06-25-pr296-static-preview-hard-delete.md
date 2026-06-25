Goal (incl. success criteria):
- Finish PR 296 as a real hard delete of the retired static screen-preview handoff concept.
- Success means no runtime schema, dynamic tool, prompt, service branch, page state, or active test path still accepts or emits the retired static-preview purpose or screenshot-only handoff state.

Constraints/Assumptions:
- Preserve unrelated worktree changes.
- Keep the cleanup simple: delete retired behavior instead of adding aliases or compatibility branches.
- Existing durable handoff rows with retired purposes may fail as unsupported legacy data; no new compatibility shim unless verification proves it is necessary.

Key decisions:
- Use the PR branch worktree for isolation.
- Treat the supplied patch as edit guidance because `git apply` reports it as corrupt.

State:
- Ready to commit and push to PR 296.

Done:
- Loaded repo routing, verification, security, reliability, and PR review docs.
- Created isolated PR 296 worktree.
- Inspected supplied patch and current retired-purpose references.
- Removed the retired static-preview purpose from hosted-execution contracts, dynamic tool schema, prompts, web service/page state, route aliasing, and tests.
- Verified no active-tree references remain for the retired purpose, view-only state, screenshot helper, or optional final-confirmation branch.
- Ran focused handoff tests, full diff-aware verification, root typecheck, and diff hygiene checks.

Now:
- Commit, push to PR 296, then run PR-lane review and CI checks.

Next:
- Update PR 296 and confirm review/CI status.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether remote CI will surface any environment-only failure after push.

Working set (files/ids/commands):
- PR: #296
- Branch: `remove-view-only-handoff-image`
- Local worktree branch: `pr-296-hard-delete`
- Key commands: retired-purpose `rg`, focused Vitest handoff tests, `bash scripts/workspace-verify.sh test:diff <changed files>`, `pnpm typecheck`, `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
