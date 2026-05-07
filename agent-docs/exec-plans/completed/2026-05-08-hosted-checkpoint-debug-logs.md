# Hosted Checkpoint Debug Logs

## Goal

Wire hosted checkpoint walker diagnostics through the production Cloudflare deploy path and make the debug output visible from runtime logs when explicitly enabled.

## Scope

- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts`
- focused Cloudflare/assistant-runtime env tests as needed

## Constraints

- Preserve unrelated dirty worktree edits, especially active Cloudflare deploy-smoke and hosted-local lanes.
- Keep diagnostics disabled by default.
- Do not log absolute host paths, secrets, raw credentials, message bodies, prompts, transcripts, or vault contents.
- Keep debug path entries root-relative and bounded enough to avoid unbounded production log volume.

## Plan

1. Add an explicit env-gated log mode for hosted checkpoint diagnostics.
2. Forward the debug env vars through deploy-time worker vars and hosted runner env allowlists.
3. Add tests proving deploy/env propagation and bounded log behavior.
4. Run focused package/app checks plus required audits.

## Verification

- PASS: `pnpm --filter @murphai/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/hosted-bundle.test.ts` (59 tests after security hardening)
- PASS: `pnpm --filter @murphai/runtime-state typecheck`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-environment.test.ts test/hosted-runtime-codex-config.test.ts`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/checkpoint-debug-env.test.ts apps/cloudflare/test/deploy-automation.test.ts`
- PASS, then BLOCKED by unrelated dirty work on rerun: `pnpm --dir apps/cloudflare typecheck` initially passed for this lane; the latest rerun failed on unrelated `apps/cloudflare/src/user-runner.ts` TS2367.
- PASS: `pnpm logs:guard`
- PASS: `git diff --check` on touched files
- BLOCKED/FLAKY: `pnpm test:diff .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/scripts/deploy-automation/worker-optional-vars.ts apps/cloudflare/test/checkpoint-debug-env.test.ts apps/cloudflare/test/runner-env.test.ts packages/assistant-runtime/src/hosted-runtime/launch-spec.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts packages/runtime-state/src/hosted-bundle-node.ts packages/runtime-state/test/hosted-bundle.test.ts agent-docs/exec-plans/active/2026-05-08-hosted-checkpoint-debug-logs.md` failed only because `packages/cli/test/cli-expansion-document-meal.test.ts` timed out after 45s; rerunning that exact test passed.
- BLOCKED: `pnpm --dir apps/cloudflare verify` waited behind an unrelated existing `apps/web verify` workspace lock and was stopped.
- PASS: coverage-write worker added test-only proof and reran focused runtime-state and assistant-runtime tests/typechecks.
- PASS: security/privacy review finding resolved after adding hashed default entries, explicit raw-path gate, and required log limit.
- PASS: final task-finish review reported no findings.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
