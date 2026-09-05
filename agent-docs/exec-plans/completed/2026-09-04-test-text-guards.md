# Remove narrative and incidental source-shape tests

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Remove assertions that freeze documentation wording or incidental source spelling while retaining executable coverage of current-sender authority and user-scoped cleanup.

## Scope and invariant

Delete only the narrative contract suite and the runner source-shape suite. Runtime code, public exports, documentation contracts, and behavioral tests remain unchanged. No new state, dependencies, or test framework is needed; retry, deployment, and persistence behavior are unaffected.

## Evidence and decisions

- The four narrative tests read Markdown and require repeated phrases; they do not execute current-sender admission or delivery.
- The runner suite rejects one exact historical comment typo and one exact wildcard-export spelling. Typechecking already rejects the malformed source, while the app's existing export map and barrel remain unchanged. Typechecking does not enforce narrow exports.
- Existing runner cleanup tests execute the deletion owner against a bucket, assert user isolation, and exercise failure/retry behavior.
- Existing current-sender service tests execute audience admission, replay, clarification, and terminal routing. The unchanged PostgreSQL suite separately covers persisted concurrency and mutually exclusive terminal effects.
- Do not introduce replacement tests for narrative wording or incidental source structure.

## Tasks

1. Inspect surviving behavioral proof and test discovery.
2. Remove the two textual suites.
3. Run focused surviving suites and both affected app typechecks; inspect the full diff and privacy.
4. Parent candidate review approved; close this plan and create the scoped PR.

## Verification

- Passed `pnpm install --frozen-lockfile`.
- Passed `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-user-data-cleanup.test.ts`: 19 tests.
- Passed `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-group-current-sender-assistant-ask.test.ts`: 30 tests.
- Passed `pnpm --dir apps/cloudflare typecheck`.
- Initial `pnpm --dir apps/web typecheck` failed with TS2307 for the unchanged `@murphai/device-syncd/service` public entrypoint because its built declarations were absent in the fresh worktree. Passed `pnpm --dir packages/device-syncd build`; the complete Web typecheck retry passed.
- Passed `pnpm complexity:diff`: no authored production JavaScript or TypeScript changes.
- Passed whitespace and deleted-file reference checks. No explicit test discovery references require edits.
- Parent reviewed the complete deletion diff and approved the six-test scope.
- The PostgreSQL suite remains unchanged and was not run locally; exact-head CI owns broader PR verification.
- Internal-only test maintenance needs no changelog or rendered product proof. Low-risk test deletions are exempt from final ReviewGPT.
- Recorded public-safe Frog entry `20260904224310-fresh-web-typecheck` for the undeclared fresh-worktree package-build prerequisite; include it in the scoped commit.
Completed: 2026-09-04
