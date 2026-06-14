# Completion Workflow Slim: Remove simplify + task-finish-review Subagent Passes

Goal (incl. success criteria):
- Remove `simplify` and `task-finish-review` as required spawned audit subagent passes from the completion workflow, replacing the final review with (a) an explicit parent-local final review for all lanes and (b) the existing post-CI `review:gpt pr-review` loop as the required final review gate for PR-lane work.
- Success means: `agent-docs/operations/completion-workflow.md` and `agent-docs/operations/agent-workflow-routing.md` no longer require either pass; the two prompt files are deleted; all mechanical references (drift required-files list, cli release-bundle test, generated doc inventory, security-privacy prompt cross-reference) are updated; scoped verification is green.

Constraints/Assumptions:
- Decision driven by transcript mining of June 2026 Codex/Claude sessions plus `audit-packages/` review:gpt artifacts: `simplify` had ~0% accepted findings; `task-finish-review` produced mostly low-severity polish while `deep-review`/`security-privacy-review`/`coverage-write` caught the real local bugs and the post-CI review:gpt loop caught marginal bugs the whole local stack missed.
- Keep `coverage-write`, `security-privacy-review`, `frontend-review`, `deep-review`, `prompt-review` unchanged.
- The parent-owned scope-and-shape check absorbs the simplify responsibility; `/simplify` stays available on demand.
- Do not touch other agents' active plans that mention task-finish-review (point-in-time docs; routing will carry the new rule).

Key decisions:
- Final review is lane-dependent: parent-local explicit review everywhere; PR lane additionally gated by `agent-docs/operations/pr-deep-review-loop.md` post-CI (already a required merge-readiness gate in routing).
- The completion doc's "Tiny Repo-Internal Fast Path" section is removed because local final review is now the default for all work, not a fast-path exception.
- cli bundle test swaps `task-finish-review.md` fixture to `coverage-write.md` to preserve the same lean-vs-full bundle property.

State:
- Approved by Will in-session 2026-06-12.

Done:
- Evidence mining (3 parallel transcript/artifact analyses), reference map across repo.

Now:
- Doc edits + prompt deletions + mechanical reference updates.

Next:
- Scoped verification (`pnpm test:diff` over touched paths, docs:gardening regen), local final review, finish-task commit. Separately: review:gpt hardening (not in this plan).
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
