# Dev Startup Speed Patch

## Goal

Land the supplied dev startup speed patch for the hosted-local and Cloudflare runner bundle setup path.

Success criteria:

- Patch applies without overwriting unrelated active work.
- Startup/bundle behavior remains covered by focused tests.
- Required repo checks and completion reviews pass or any unrelated blockers are documented.
- Scoped commit contains only this task's code/test files plus the archived plan. The coordination-ledger row was removed from the working copy, but the ledger file was left out of the commit because it carries unrelated concurrent churn.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not expose local account, home-directory, or direct personal identifiers in files, commits, or handoff.
- Patch touches Cloudflare runner bundle tooling and hosted-local dev startup behavior.
- Active ledger has adjacent hosted-local dev work; keep this lane narrow to the supplied patch.

## Current State

- Patch stat shows changes in Cloudflare runner bundle scripts/tests and `scripts/dev-hosted-local`.
- `git apply --check` passed before application.

## Plan

1. Register this plan and coordination-ledger row.
2. Apply the supplied patch.
3. Inspect the resulting diff for scope and privacy guardrails.
4. Run focused verification for the touched tooling/app paths.
5. Run required completion workflow audits.
6. Commit the scoped patch without absorbing unrelated ledger churn.

## Verification

- `git diff --check` for touched files: passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-bundle-workspace-artifacts.test.ts --no-coverage`: passed, 10 tests.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts --no-coverage`: passed, 33 tests.
- `MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS=1 pnpm --dir apps/cloudflare runner:bundle:hosted-local`: passed.
- `bash scripts/workspace-verify.sh test:diff <touched files>`: blocked by unrelated repo-tools Health Commons fixture state.
- `pnpm --dir apps/cloudflare typecheck`: blocked by unrelated active Cloudflare hosted-crypto/root-id edits.
- `pnpm typecheck`: blocked by unrelated active hosted-web edits.

## Working Set

- `apps/cloudflare/scripts/assemble-runner-bundle.ts`
- `apps/cloudflare/scripts/runner-bundle/workspace-artifacts.ts`
- `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts`
- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/stack.test.ts`
