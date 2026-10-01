# Extract runtime log parser ownership

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Make the hosted runtime diagnostic acceptance policy independently navigable while preserving every accepted payload, rejection, diagnostic bound, and public export.

## Success criteria

- Runtime log and redacted-status parsing lives in one concrete parser module.
- Workspace, invocation, runner status, and Web status still compose that exact validator.
- Existing public parser exports and deployed wire schemas remain unchanged.
- Focused parser and Web consumer tests, affected typecheck, and complexity guard pass.

## Scope

- In scope: runtime log/parser policy extraction, genuinely shared scalar checks in the existing assertions owner, focused test ownership, and module-owner documentation.
- Out of scope: new validation rules, producer sanitization, latency parsing, mailbox command parsing, persisted schemas, or product behavior.

## Evidence and ownership

The runtime-control parser currently combines product commands and checkpoint contracts with diagnostic privacy allowlists, field budgets, failure-summary normalization, and log request/response validation. Its diagnostic consumers are the public parser barrel, workspace status, and runner/Web recent-log arrays. The cluster has no mutable shared runtime state. The implementation starts from current main and preserves the subsequently added mailbox assistant-provider validation.

## Constraints

Keep canonical contract types and mailbox-lane values in runtime-control. Reuse assertions for scalar parsing and preserve the reserved-key parameter used by receipt status. Producer sanitization remains owned by observability. Use no new dependency, public subpath, pass-through module, or compatibility implementation. Keep only this lane's edits in its commit.

## Risks and mitigations

1. A missed diagnostic key or altered failure message changes the privacy contract. Move complete declarations without behavioral rewrites and run existing unsafe-value, failure-normalization, and warm-runner fixtures.
2. Moving shared helpers could create a circular import. Both parser modules depend on assertions and canonical contracts; runtime-log never imports its former parser parent.
3. Receipt status or recent-log composition could drift. Preserve workspace/status tests against the public barrel and run focused Web consumers.

## Tasks

1. Done: inspected current main, routed owner docs, callers, and test coverage.
2. Done: extracted the complete diagnostic cluster and three shared scalar assertions.
3. Done: moved the four existing diagnostic tests intact; retained receipt and status composition tests.
4. Done: focused validation passed; source-equivalence, privacy, diff, and complexity review completed.
5. Prepared: complete draft PR evidence and scoped final commit; parent owns candidate review, Ready, ReviewGPT, and exact-head CI.

## Decisions

- Public names remain exported through the existing parsers entrypoint.
- No member-visible behavior changes; changelog and rendered UX evidence are not applicable.
- No database/network operations, authority, retries, or deploy ordering changes.

## Verification

- Passed: `pnpm --dir packages/hosted-execution typecheck`.
- Passed: `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage --maxWorkers=2 test/hosted-runtime-log.test.ts test/hosted-runtime-control.test.ts test/parser-helpers.test.ts` (3 files, 51 tests).
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --maxWorkers=2 apps/web/test/hosted-runtime-log-database.test.ts apps/web/test/hosted-workspace-store.test.ts` (2 files, 42 tests).
- Passed: `pnpm complexity:diff`; the new runtime-log parser has maximum complexity 17 and zero debt. Existing group request/response/shared-projection and event/wake dispatch hotspots are unchanged and outside this extraction.
- Passed: `git diff --check` and AST comparison of all 193 original parser functions. Complete diagnostic policy declarations are identical; the sole equivalent body change replaces the former parent's mailbox-lane wrapper with the same shared enum parser and canonical lane constants.
- Frozen dependency installation completed in this worktree. No new repository friction entry was needed.
- No rendered UX, provider-input, database/network count, or deployed wire-contract change. Broad acceptance, coverage, final ReviewGPT, and exact-head CI remain with the parent PR completion owner.
Completed: 2026-09-10
