# Hosted email send write fence

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Hosted email send authorizes with the workspace-version-strict runtime write fence before performing the outbound email side effect.

## Success criteria

- `handleRunnerEmailSendRequest` validates attempt id, generation, user id, and workspace version before sending mail.
- Existing compatible runtime requests that include the hosted runtime workspace-version header still succeed.
- A stale workspace-version fence prevents hosted email delivery.
- Required focused tests, typecheck, and completion audits pass or any unrelated blocker is documented.

## Scope

- In scope: hosted runner outbound email send authorization and focused outbound tests.
- Out of scope: hosted email transport behavior, provider-effect authorization, runtime header emission, deploy flow changes.

## Constraints

- Technical constraints: keep the existing write-fence helper as the authority boundary; do not introduce new auth state or compatibility shims.
- Product/process constraints: preserve privacy guardrails and avoid exposing local identifiers in artifacts.

## Risks and mitigations

1. Risk: email sends with stale restored workspaces could continue as side effects.
   Mitigation: require `requireRunnerRuntimeWriteFenceWrite`, which includes workspace-version validation.
2. Risk: compatible active runtime sends are accidentally rejected.
   Mitigation: keep tests proving the current header shape succeeds when workspace version matches.

## Tasks

1. Replace email send read-fence authorization with write-fence authorization.
2. Update focused tests to prove matching and stale workspace-version behavior.
3. Run required verification and completion audits.
4. Close the active plan through the scoped finish path if the worktree permits it.

## Decisions

- Use the existing write-fence-write helper rather than adding email-specific validation.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts` (80 tests).
- Passed: `pnpm typecheck`.
- Failed, unrelated: `pnpm --dir apps/cloudflare test -- runner-outbound.test.ts` timed out in `apps/cloudflare/test/container-entrypoint.test.ts`.
- Failed, unrelated overlapping work: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound/results.ts apps/cloudflare/test/runner-outbound.test.ts` failed in `apps/cloudflare/test/runner-egress-intercept.test.ts` provider-egress expectations from active dirty work outside this task.
- Audits: coverage-write found coverage sufficient and made no edits; security/privacy review and final review found no code issues.
Completed: 2026-05-12
