Goal (incl. success criteria):
- Move the product-experience completion audit into the preliminary
  `completion-specialists` ReviewGPT pass.
- Remove the separate local product-experience audit subagent route while
  preserving the existing admission criteria, review rubric, evidence bar, and
  finding-resolution requirements.
- Success means one exact-pushed-head specialist pass applies every relevant
  product-experience, prompt, frontend, and coverage lens, and repository tests
  mechanically reject reintroduction of the removed subagent route.

Constraints/Assumptions:
- Keep the later final ReviewGPT gate and fallback local `deep-review` route
  unchanged.
- Preserve the existing optional coverage-only patch artifact boundary.
- Product-experience findings remain review-only and cannot return a patch.
- This is repo-internal workflow/tooling work with no product runtime,
  persisted-state, auth, or deploy behavior change.

Key decisions:
- Reuse `agent-docs/prompts/product-experience-review.md` as a fourth
  conditional ReviewGPT lens instead of creating a second prompt or review
  process.
- Package the product-experience lens reference in the guarded preliminary
  ReviewGPT snapshot.
- Delete local-subagent routing and handoff requirements; keep the applicable
  product journey evidence in the PR intent and preliminary ReviewGPT packet.

State:
- Complete.

Done:
- Traced the current split across workflow docs, ReviewGPT preset/config,
  prompt references, and enforcement tests.
- Added product experience as the fourth conditional
  `completion-specialists` lens and removed its local-subagent route.
- Added the lens reference to the guarded exact-head packet and regression
  coverage for the route and ZIP contents.
- Passed shell syntax, diff hygiene, focused Vitest, CLI typecheck, and agent
  docs drift checks.
- ReviewGPT completed the exact-head preliminary pass with one accepted medium
  finding: materially journey-changing product remediation still needs a
  refreshed purpose verdict.
- Added parent-owned corrected-head product revalidation for that case, with no
  second specialist run or product-review subagent.
- Parent final review removed the last live final-gate reference to a routed
  local product-experience review and added regression coverage.
- Repeated focused Vitest and CLI typecheck successfully after remediation.

Now:
- Archive this plan and publish the final task head.

Next:
- Require green exact-head CI and prove merge readiness before handoff.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- AGENTS.md
- agent-docs/index.md
- agent-docs/operations/agent-workflow-routing.md
- agent-docs/operations/completion-workflow.md
- agent-docs/operations/pr-reviewgpt-loop.md
- agent-docs/operations/verification-and-runtime.md
- agent-docs/prompts/frontend-review.md
- agent-docs/prompts/product-experience-review.md
- scripts/chatgpt-review-presets/completion-specialists.md
- scripts/package-audit-context-full.sh
- scripts/review-gpt.config.sh
- packages/cli/test/release-script-coverage-audit.test.ts
- pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage
  packages/cli/test/release-script-coverage-audit.test.ts
- pnpm --filter @murphai/murph typecheck
- pnpm docs:drift
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
